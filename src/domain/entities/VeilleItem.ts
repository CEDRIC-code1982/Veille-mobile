import type { Category } from './Category';

/**
 * How much a piece of news constrains the work.
 *
 * `BLOCKING` is the only level that may wake somebody up, and it can never be
 * granted by the language model alone: see `verifyEvidence`.
 */
const Criticality = {
  BLOCKING: 'blocking',
  IMPACTING: 'impacting',
  BACKGROUND: 'background',
} as const;
type Criticality = typeof Criticality[keyof typeof Criticality];

/**
 * How much the pipeline trusts the classification.
 *
 * `VERIFIED` means the evidence quote was found again in the official source,
 * `REPORTED` means the source is official but the quote could not be located,
 * `UNVERIFIED` means nothing beyond the model's proposal backs the item.
 */
const TrustLevel = {
  VERIFIED: 'verified',
  REPORTED: 'reported',
  UNVERIFIED: 'unverified',
} as const;
type TrustLevel = typeof TrustLevel[keyof typeof TrustLevel];

/**
 * A published watch item.
 *
 * Copyright: no article content is ever stored. Only the URL, a rewritten
 * summary, and the single sentence that justifies the classification.
 */
interface VeilleItem {
  id: string;
  title: string;
  summary: string;
  sourceUrl: string;
  sourceName: string;
  publishedAt: string;
  collectedAt: string;
  criticality: Criticality;
  trustLevel: TrustLevel;
  categories: Category[];
  tags: string[];
  impactedProjects: string[];
  fingerprint: string;
  evidenceQuote?: string;
  deadline?: string;
  verificationNote?: string;
}

const CRITICALITY_ORDER: Record<Criticality, number> = {
  [Criticality.BLOCKING]: 0,
  [Criticality.IMPACTING]: 1,
  [Criticality.BACKGROUND]: 2,
};

export { Criticality, CRITICALITY_ORDER, TrustLevel };
export type { VeilleItem };
