/**
 * Stage 3 of 4: verify.
 *
 * Confronts every model proposal with the source itself. This stage never
 * trusts the classify output: it refetches the page and looks for the evidence
 * quote on normalised text before letting any item keep a blocking criticality.
 *
 * A failed verification is not an error. It is a downgrade, logged as a warning,
 * and the run still succeeds: the whole point is that an unproven claim gets
 * demoted rather than published as fact.
 *
 * The model is never called here, and only a first-party page with a quote is
 * refetched: a third-party source stays unverified whatever the page says, so
 * fetching it would buy nothing.
 */

import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import type { OfficialDomain } from '../domain/entities/OfficialDomain';
import { TrustLevel } from '../domain/entities/VeilleItem';
import type { VeilleItem } from '../domain/entities/VeilleItem';
import type { Clock } from '../domain/ports/Clock';
import { SourceFetchStatus } from '../domain/ports/SourceFetcher';
import type { SourceFetcher } from '../domain/ports/SourceFetcher';
import { findQuoteInText, QuoteLookupResult } from '../domain/support/findQuoteInText';
import { isOfficialSource } from '../domain/support/isOfficialSource';
import { stripHtml } from '../domain/support/stripHtml';
import { EvidenceCheck, verifyEvidence } from '../domain/useCases/verifyEvidence';
import { createHttpSourceFetcher } from '../data/feeds/httpClient';
import { loadOfficialDomains } from '../shared/config';
import { readIntegerEnv } from '../shared/env';
import { readRequiredJsonFile, writeJsonFile } from '../shared/jsonStore';
import { createLogger } from '../shared/logger';
import { buildClassificationPath, buildVerificationPath } from '../shared/paths';
import { classificationFileSchema, verificationFileSchema } from '../shared/schemas/pipeline';
import { systemClock } from '../shared/systemClock';
import { findNewestCollectedDay, resolveRequestedDay } from './pipelineDay';

const logger = createLogger(import.meta.url);

const DEFAULT_CONCURRENCY = 4;

/** French wording of each observation, for the note displayed on the site. */
const CHECK_NOTES: Record<EvidenceCheck, string> = {
  [EvidenceCheck.QUOTE_FOUND]: 'citation retrouvée dans la source officielle',
  [EvidenceCheck.QUOTE_MISSING]: 'citation introuvable dans la source refetchée',
  [EvidenceCheck.QUOTE_TOO_SHORT]: 'citation trop courte pour prouver la classification',
  [EvidenceCheck.FETCH_FAILED]: 'source impossible à refetcher',
  [EvidenceCheck.NOT_CHECKED]: 'source non refetchée',
};

interface VerificationDowngrade {
  itemId: string;
  reason: string;
}

interface VerifyDependencies {
  items: readonly VeilleItem[];
  officialDomains: readonly OfficialDomain[];
  fetcher: SourceFetcher;
  clock: Clock;
  concurrency: number;
}

interface VerificationResult {
  verifiedAt: string;
  items: VeilleItem[];
  downgrades: VerificationDowngrade[];
}

const QUOTE_LOOKUP_TO_CHECK: Record<QuoteLookupResult, EvidenceCheck> = {
  [QuoteLookupResult.FOUND]: EvidenceCheck.QUOTE_FOUND,
  [QuoteLookupResult.MISSING]: EvidenceCheck.QUOTE_MISSING,
  [QuoteLookupResult.TOO_SHORT]: EvidenceCheck.QUOTE_TOO_SHORT,
};

/**
 * Refetches the source and reports what was observed.
 *
 * Only worth doing for a first-party page carrying a quote: anything else can
 * never reach verified trust, so the request would be pure cost.
 */
const checkEvidence = async (
  item: VeilleItem,
  officialDomains: readonly OfficialDomain[],
  fetcher: SourceFetcher,
): Promise<EvidenceCheck> => {
  const quote = item.evidenceQuote?.trim();

  if (quote === undefined || quote.length === 0) {
    return EvidenceCheck.NOT_CHECKED;
  }

  if (!isOfficialSource(item.sourceUrl, officialDomains)) {
    return EvidenceCheck.NOT_CHECKED;
  }

  const fetched = await fetcher.fetchText(item.sourceUrl);

  if (fetched.outcome === SourceFetchStatus.FAILED) {
    logger.warn(`refetch failed for ${item.sourceUrl}: ${fetched.reason}`);

    return EvidenceCheck.FETCH_FAILED;
  }

  return QUOTE_LOOKUP_TO_CHECK[findQuoteInText(quote, stripHtml(fetched.text))];
};

const verifyOne = async (
  item: VeilleItem,
  officialDomains: readonly OfficialDomain[],
  fetcher: SourceFetcher,
): Promise<{ item: VeilleItem; downgrade?: VerificationDowngrade }> => {
  const evidenceCheck = await checkEvidence(item, officialDomains, fetcher);
  const verdict = verifyEvidence({
    proposedCriticality: item.criticality,
    sourceUrl: item.sourceUrl,
    officialDomains,
    evidenceCheck,
    ...(item.evidenceQuote !== undefined ? { evidenceQuote: item.evidenceQuote } : {}),
  });

  const shouldExplain = verdict.downgraded || verdict.trustLevel !== TrustLevel.VERIFIED;
  const note = verdict.downgraded
    ? `rétrogradé : ${CHECK_NOTES[evidenceCheck]}`
    : CHECK_NOTES[evidenceCheck];

  const verified: VeilleItem = {
    ...item,
    criticality: verdict.criticality,
    trustLevel: verdict.trustLevel,
    ...(shouldExplain ? { verificationNote: item.verificationNote ?? note } : {}),
  };

  if (!verdict.downgraded) {
    return { item: verified };
  }

  logger.warn(`${item.id} downgraded to ${verdict.criticality}: ${verdict.reason}`);

  return { item: verified, downgrade: { itemId: item.id, reason: verdict.reason } };
};

/** Runs the verification, a few items at a time to stay polite with the sources. */
const runVerify = async (dependencies: VerifyDependencies): Promise<VerificationResult> => {
  const { items, officialDomains, fetcher, clock } = dependencies;
  const concurrency = Math.max(1, dependencies.concurrency);
  const verifiedItems: VeilleItem[] = [];
  const downgrades: VerificationDowngrade[] = [];

  for (let start = 0; start < items.length; start += concurrency) {
    const slice = items.slice(start, start + concurrency);
    const settled = await Promise.all(
      slice.map((item) => verifyOne(item, officialDomains, fetcher)),
    );

    for (const outcome of settled) {
      verifiedItems.push(outcome.item);

      if (outcome.downgrade !== undefined) {
        downgrades.push(outcome.downgrade);
      }
    }
  }

  const verifiedCount = verifiedItems.filter(
    (item) => item.trustLevel === TrustLevel.VERIFIED,
  ).length;

  logger.info(
    `verified ${verifiedItems.length} item(s): ${verifiedCount} with trust verified, ` +
      `${downgrades.length} downgraded`,
  );

  return { verifiedAt: clock.now().toISOString(), items: verifiedItems, downgrades };
};

const main = async (): Promise<void> => {
  const requestedDay = resolveRequestedDay(process.argv, systemClock);
  const dayLabel = existsSync(buildClassificationPath(requestedDay))
    ? requestedDay
    : findNewestCollectedDay();

  if (dayLabel === undefined || !existsSync(buildClassificationPath(dayLabel))) {
    logger.error(
      'no classify output to verify',
      new Error(`no classified file found for ${requestedDay} nor any earlier day`),
    );
    process.exitCode = 1;

    return;
  }

  const classification = readRequiredJsonFile(
    buildClassificationPath(dayLabel),
    classificationFileSchema,
  );

  logger.info(`verifying ${classification.items.length} item(s) from ${dayLabel}`);

  const result = await runVerify({
    items: classification.items,
    officialDomains: loadOfficialDomains(),
    fetcher: createHttpSourceFetcher(),
    clock: systemClock,
    concurrency: readIntegerEnv('VEILLE_VERIFY_CONCURRENCY', DEFAULT_CONCURRENCY),
  });

  const validated = verificationFileSchema.safeParse(result);

  if (!validated.success) {
    logger.error('verified data does not match its schema', validated.error);
    process.exitCode = 1;

    return;
  }

  const outputPath = buildVerificationPath(dayLabel);
  writeJsonFile(outputPath, validated.data);
  logger.info(`wrote ${result.items.length} verified item(s) to ${outputPath}`);
};

const entryPoint = process.argv[1];
const isDirectRun = entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href;

if (isDirectRun) {
  await main();
}

export { runVerify };
export type { VerificationResult, VerifyDependencies };
