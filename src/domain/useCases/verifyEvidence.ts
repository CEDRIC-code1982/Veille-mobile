import type { OfficialDomain } from '../entities/OfficialDomain';
import { Criticality, TrustLevel } from '../entities/VeilleItem';
import { isOfficialSource } from '../support/isOfficialSource';

/**
 * The trust rule of the whole system.
 *
 * An item may only carry `blocking` when the three conditions hold together:
 *
 * 1. its source URL belongs to a first-party domain of the whitelist,
 * 2. the model provided a non-empty evidence quote,
 * 3. the verify stage refetched the source and found that quote again in the
 *    page, on normalised text.
 *
 * Any failing condition downgrades the item to `impacting` at most, with
 * `unverified` trust. A failed verification is not an error: it is the normal
 * outcome, logged as a warning by the caller, and it never fails the run.
 */

/** What the verify stage observed after refetching the source. */
const EvidenceCheck = {
  QUOTE_FOUND: 'quote-found',
  QUOTE_MISSING: 'quote-missing',
  QUOTE_TOO_SHORT: 'quote-too-short',
  FETCH_FAILED: 'fetch-failed',
  NOT_CHECKED: 'not-checked',
} as const;
type EvidenceCheck = typeof EvidenceCheck[keyof typeof EvidenceCheck];

interface VerifyEvidenceInput {
  proposedCriticality: Criticality;
  sourceUrl: string;
  officialDomains: readonly OfficialDomain[];
  evidenceCheck: EvidenceCheck;
  evidenceQuote?: string;
}

interface VerifyEvidenceResult {
  criticality: Criticality;
  trustLevel: TrustLevel;
  downgraded: boolean;
  reason: string;
}

const CHECK_REASONS: Record<EvidenceCheck, string> = {
  [EvidenceCheck.QUOTE_FOUND]: 'evidence quote found again in the first-party source',
  [EvidenceCheck.QUOTE_MISSING]: 'evidence quote not found in the refetched source',
  [EvidenceCheck.QUOTE_TOO_SHORT]: 'evidence quote too short to prove anything',
  [EvidenceCheck.FETCH_FAILED]: 'source could not be refetched',
  [EvidenceCheck.NOT_CHECKED]: 'source was never refetched',
};

const buildDowngrade = (reason: string): VerifyEvidenceResult => {
  return {
    criticality: Criticality.IMPACTING,
    trustLevel: TrustLevel.UNVERIFIED,
    downgraded: true,
    reason,
  };
};

/**
 * Resolves the criticality and the trust level an item is actually entitled to.
 */
const verifyEvidence = (input: VerifyEvidenceInput): VerifyEvidenceResult => {
  const isOfficial = isOfficialSource(input.sourceUrl, input.officialDomains);
  const hasQuote = input.evidenceQuote !== undefined && input.evidenceQuote.trim().length > 0;

  if (input.proposedCriticality === Criticality.BLOCKING) {
    if (!isOfficial) {
      return buildDowngrade('blocking refused: source domain is not first-party');
    }

    if (!hasQuote) {
      return buildDowngrade('blocking refused: no evidence quote provided');
    }

    if (input.evidenceCheck !== EvidenceCheck.QUOTE_FOUND) {
      return buildDowngrade(
        `blocking refused: ${CHECK_REASONS[input.evidenceCheck]}`,
      );
    }

    return {
      criticality: Criticality.BLOCKING,
      trustLevel: TrustLevel.VERIFIED,
      downgraded: false,
      reason: CHECK_REASONS[EvidenceCheck.QUOTE_FOUND],
    };
  }

  if (isOfficial && input.evidenceCheck === EvidenceCheck.QUOTE_FOUND) {
    return {
      criticality: input.proposedCriticality,
      trustLevel: TrustLevel.VERIFIED,
      downgraded: false,
      reason: CHECK_REASONS[EvidenceCheck.QUOTE_FOUND],
    };
  }

  if (isOfficial) {
    return {
      criticality: input.proposedCriticality,
      trustLevel: TrustLevel.REPORTED,
      downgraded: false,
      reason: `first-party source, but ${CHECK_REASONS[input.evidenceCheck]}`,
    };
  }

  return {
    criticality: input.proposedCriticality,
    trustLevel: TrustLevel.UNVERIFIED,
    downgraded: false,
    reason: 'source domain is not first-party',
  };
};

export { EvidenceCheck, verifyEvidence };
export type { VerifyEvidenceInput, VerifyEvidenceResult };
