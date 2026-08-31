import type { Category } from './Category';

/**
 * A normalised entry produced by the collect stage, before the language model
 * sees it.
 *
 * `excerpt` exists only to feed the classifier and is written to
 * `data/raw/`, which is never versioned: keeping third-party text out of the
 * repository is deliberate.
 */
interface CollectedItem {
  id: string;
  title: string;
  sourceUrl: string;
  sourceName: string;
  sourceDomain: string;
  official: boolean;
  categories: Category[];
  publishedAt: string;
  collectedAt: string;
  excerpt: string;
  fingerprint: string;
}

export type { CollectedItem };
