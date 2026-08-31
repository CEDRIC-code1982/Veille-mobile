/**
 * Stage 4 of 4: publish.
 *
 * Writes the monthly item files the site reads, the weekly markdown digest, the
 * site index, and opens the only two notifications allowed to interrupt: a
 * verified blocking item, and a source that has gone mute.
 *
 * No model is called here. The plan is computed by `runPublish`, which takes
 * everything it needs as arguments and returns what should be written, so the
 * whole stage is testable without touching the disk or the network.
 */

import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import type { Feed } from '../domain/entities/Feed';
import { Criticality, TrustLevel } from '../domain/entities/VeilleItem';
import type { VeilleItem } from '../domain/entities/VeilleItem';
import type { Clock } from '../domain/ports/Clock';
import { IssueOutcome } from '../domain/ports/IssueNotifier';
import type { IssueDraft, IssueNotifier } from '../domain/ports/IssueNotifier';
import { toIsoMonthLabel, toIsoWeekLabel } from '../domain/support/isoWeek';
import { buildDigest } from '../domain/useCases/buildDigest';
import { buildNotifications } from '../domain/useCases/buildNotifications';
import { detectStaleFeeds } from '../domain/useCases/detectStaleFeeds';
import type { FeedActivity } from '../domain/useCases/detectStaleFeeds';
import {
  createGitHubIssueNotifier,
  createNoopIssueNotifier,
} from '../data/github/GitHubIssueNotifier';
import { readAllPublishedItems } from '../data/publishedItems';
import { BASE_LABEL } from '../domain/useCases/buildNotifications';
import { loadFeeds } from '../shared/config';
import { readIntegerEnv, readOptionalEnv } from '../shared/env';
import { readOptionalJsonFile, readRequiredJsonFile, writeJsonFile, writeTextFile } from '../shared/jsonStore';
import { createLogger } from '../shared/logger';
import {
  buildDigestPath,
  buildMonthItemsPath,
  buildRawCollectionPath,
  buildVerificationPath,
  PATHS,
} from '../shared/paths';
import { rawCollectionSchema, verificationFileSchema } from '../shared/schemas/pipeline';
import { monthFileSchema, siteIndexSchema } from '../shared/schemas/publication';
import { systemClock } from '../shared/systemClock';
import { findNewestCollectedDay, resolveRequestedDay } from './pipelineDay';

const logger = createLogger(import.meta.url);

const DEFAULT_PIPELINE_SILENCE_DAYS = 14;

interface MonthFilePlan {
  month: string;
  updatedAt: string;
  items: VeilleItem[];
}

interface MonthSummary {
  month: string;
  itemCount: number;
  blockingCount: number;
}

interface SiteIndex {
  generatedAt: string;
  months: MonthSummary[];
  counts: {
    total: number;
    blocking: number;
    impacting: number;
    background: number;
    unverified: number;
  };
  feedCount: number;
  lastCollectedAt?: string;
}

interface PublishDependencies {
  verifiedItems: readonly VeilleItem[];
  existingItems: readonly VeilleItem[];
  feeds: readonly Feed[];
  activities: readonly FeedActivity[];
  clock: Clock;
  pipelineSilenceDays: number;
}

interface PublishPlan {
  months: MonthFilePlan[];
  digest: { weekLabel: string; content: string };
  index: SiteIndex;
  notifications: IssueDraft[];
  addedCount: number;
}

/** Month an item belongs to, from its publication date, then its collection. */
const resolveMonth = (item: VeilleItem): string => {
  const published = new Date(item.publishedAt);

  if (!Number.isNaN(published.getTime())) {
    return toIsoMonthLabel(published);
  }

  const collected = new Date(item.collectedAt);

  return Number.isNaN(collected.getTime()) ? 'unknown' : toIsoMonthLabel(collected);
};

/** Most recent first, identifier as tie-breaker, so a rerun rewrites nothing. */
const compareItems = (left: VeilleItem, right: VeilleItem): number => {
  const byPublication = right.publishedAt.localeCompare(left.publishedAt);

  return byPublication !== 0 ? byPublication : left.id.localeCompare(right.id);
};

const groupByMonth = (items: readonly VeilleItem[]): Map<string, VeilleItem[]> => {
  const grouped = new Map<string, VeilleItem[]>();

  for (const item of items) {
    const month = resolveMonth(item);
    const bucket = grouped.get(month);

    if (bucket === undefined) {
      grouped.set(month, [item]);
      continue;
    }

    bucket.push(item);
  }

  return grouped;
};

const countByCriticality = (
  items: readonly VeilleItem[],
  criticality: Criticality,
): number => {
  return items.filter((item) => item.criticality === criticality).length;
};

const findLatestCollectedAt = (items: readonly VeilleItem[]): string | undefined => {
  let latest: string | undefined;

  for (const item of items) {
    if (latest === undefined || item.collectedAt > latest) {
      latest = item.collectedAt;
    }
  }

  return latest;
};

const runPublish = (dependencies: PublishDependencies): PublishPlan => {
  const { verifiedItems, existingItems, feeds, activities, clock, pipelineSilenceDays } =
    dependencies;
  const now = clock.now();
  const updatedAt = now.toISOString();
  const weekLabel = toIsoWeekLabel(now);

  // The freshly verified version of an item always wins over a stored one.
  const mergedById = new Map<string, VeilleItem>();

  for (const item of existingItems) {
    mergedById.set(item.id, item);
  }

  let addedCount = 0;

  for (const item of verifiedItems) {
    if (!mergedById.has(item.id)) {
      addedCount += 1;
    }

    mergedById.set(item.id, item);
  }

  const allItems = [...mergedById.values()].sort(compareItems);
  const groupedAll = groupByMonth(allItems);
  const touchedMonths = new Set(verifiedItems.map(resolveMonth));

  const months: MonthFilePlan[] = [];

  for (const month of [...touchedMonths].sort()) {
    const items = groupedAll.get(month) ?? [];
    months.push({ month, updatedAt, items: [...items].sort(compareItems) });
  }

  const monthSummaries: MonthSummary[] = [];

  for (const month of [...groupedAll.keys()].sort()) {
    const items = groupedAll.get(month) ?? [];
    monthSummaries.push({
      month,
      itemCount: items.length,
      blockingCount: countByCriticality(items, Criticality.BLOCKING),
    });
  }

  const weekItems = allItems.filter((item) => {
    const published = new Date(item.publishedAt);

    return !Number.isNaN(published.getTime()) && toIsoWeekLabel(published) === weekLabel;
  });

  const lastCollectedAt = findLatestCollectedAt(allItems);

  const staleReport = detectStaleFeeds({
    feeds,
    activities,
    now,
    pipelineSilenceDays,
    ...(lastCollectedAt !== undefined ? { lastPipelineItemAt: lastCollectedAt } : {}),
  });

  const notifications = buildNotifications({
    items: verifiedItems,
    staleFeeds: staleReport.staleFeeds,
    isPipelineSilent: staleReport.isPipelineSilent,
    weekLabel,
    ...(staleReport.daysSinceLastPipelineItem !== undefined
      ? { daysSinceLastPipelineItem: staleReport.daysSinceLastPipelineItem }
      : {}),
  });

  logger.info(
    `${addedCount} new item(s) published, ${allItems.length} in total, ` +
      `${months.length} month file(s) to write, ${notifications.length} notification(s)`,
  );

  if (staleReport.staleFeeds.length > 0) {
    logger.warn(
      `${staleReport.staleFeeds.length} mute source(s): ` +
        staleReport.staleFeeds.map((finding) => finding.feedName).join(', '),
    );
  }

  return {
    months,
    digest: {
      weekLabel,
      content: buildDigest({ items: weekItems, weekLabel, generatedAt: updatedAt }),
    },
    index: {
      generatedAt: updatedAt,
      months: monthSummaries,
      counts: {
        total: allItems.length,
        blocking: countByCriticality(allItems, Criticality.BLOCKING),
        impacting: countByCriticality(allItems, Criticality.IMPACTING),
        background: countByCriticality(allItems, Criticality.BACKGROUND),
        unverified: allItems.filter((item) => item.trustLevel === TrustLevel.UNVERIFIED).length,
      },
      feedCount: feeds.length,
      ...(lastCollectedAt !== undefined ? { lastCollectedAt } : {}),
    },
    notifications,
    addedCount,
  };
};

/** Builds the notifier, inert when the run has no repository credentials. */
const buildNotifier = (): IssueNotifier => {
  const token = readOptionalEnv('GITHUB_TOKEN');
  const repository = readOptionalEnv('GITHUB_REPOSITORY');

  if (token === undefined || repository === undefined) {
    logger.info('no GITHUB_TOKEN or GITHUB_REPOSITORY, issue notifications are disabled');

    return createNoopIssueNotifier();
  }

  const [owner, name] = repository.split('/');

  if (owner === undefined || name === undefined) {
    logger.warn(`unusable GITHUB_REPOSITORY value, issue notifications are disabled`);

    return createNoopIssueNotifier();
  }

  return createGitHubIssueNotifier({ token, owner, repository: name, baseLabel: BASE_LABEL });
};

const main = async (): Promise<void> => {
  const requestedDay = resolveRequestedDay(process.argv, systemClock);
  const dayLabel = existsSync(buildVerificationPath(requestedDay))
    ? requestedDay
    : findNewestCollectedDay();

  if (dayLabel === undefined || !existsSync(buildVerificationPath(dayLabel))) {
    logger.error(
      'no verify output to publish',
      new Error(`no verified file found for ${requestedDay} nor any earlier day`),
    );
    process.exitCode = 1;

    return;
  }

  const verification = readRequiredJsonFile(buildVerificationPath(dayLabel), verificationFileSchema);
  const collection = readOptionalJsonFile(buildRawCollectionPath(dayLabel), rawCollectionSchema);

  if (collection === undefined) {
    logger.warn(`no collect output for ${dayLabel}, mute source detection will be partial`);
  }

  const plan = runPublish({
    verifiedItems: verification.items,
    existingItems: readAllPublishedItems(),
    feeds: loadFeeds(),
    activities: collection?.activities ?? [],
    clock: systemClock,
    pipelineSilenceDays: readIntegerEnv(
      'VEILLE_PIPELINE_SILENCE_DAYS',
      DEFAULT_PIPELINE_SILENCE_DAYS,
    ),
  });

  for (const month of plan.months) {
    const validated = monthFileSchema.safeParse(month);

    if (!validated.success) {
      logger.error(`month file ${month.month} does not match its schema`, validated.error);
      process.exitCode = 1;

      return;
    }

    writeJsonFile(buildMonthItemsPath(month.month), validated.data);
    logger.info(`wrote ${month.items.length} item(s) to ${buildMonthItemsPath(month.month)}`);
  }

  const validatedIndex = siteIndexSchema.safeParse(plan.index);

  if (!validatedIndex.success) {
    logger.error('site index does not match its schema', validatedIndex.error);
    process.exitCode = 1;

    return;
  }

  writeJsonFile(PATHS.siteIndex, validatedIndex.data);
  writeTextFile(buildDigestPath(plan.digest.weekLabel), plan.digest.content);
  logger.info(`wrote the digest for ${plan.digest.weekLabel}`);

  const notifier = buildNotifier();

  for (const draft of plan.notifications) {
    const outcome = await notifier.ensureIssue(draft);

    if (outcome === IssueOutcome.FAILED) {
      logger.warn(`notification not delivered: ${draft.title}`);
    }
  }

  logger.info('publish stage finished');
};

const entryPoint = process.argv[1];
const isDirectRun = entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href;

if (isDirectRun) {
  await main();
}

export { resolveMonth, runPublish };
export type { PublishDependencies, PublishPlan, SiteIndex };
