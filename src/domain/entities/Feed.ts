import type { Category } from './Category';

const FeedType = {
  RSS: 'rss',
  ATOM: 'atom',
  SCRAPE: 'scrape',
} as const;
type FeedType = typeof FeedType[keyof typeof FeedType];

/**
 * One configured source, as declared in `config/feeds.yaml`.
 *
 * `maxAgeDays` is the silence threshold: past that, `detectStaleFeeds`
 * considers the feed mute and the pipeline opens an issue.
 */
/**
 * Turns one index page into several scraped pages.
 *
 * Documentation sites bury the interesting page behind a version number, and
 * hard-coding that number would make the watch silently track an obsolete
 * release. Instead the index is read, the version keys are discovered from the
 * links it exposes, the highest ones are kept, and their pages are scraped.
 *
 * Keeping two of them is what produces the comparison: the current release and
 * the one it replaces, side by side, without either being declared by hand.
 */
interface FeedFollow {
  linkPattern: string;
  urlTemplate: string;
  limit: number;
}

interface Feed {
  name: string;
  url: string;
  type: FeedType;
  domain: string;
  categories: Category[];
  official: boolean;
  maxAgeDays: number;
  follow?: FeedFollow;
  titlePattern?: string;
}

/**
 * One entry as read from a feed or a scraped page, before any normalisation.
 *
 * `contentHash` is only set by the scraper: a documentation page carries no
 * publication date, so its identity is the hash of its own text. That is what
 * makes a new item appear when, and only when, the page actually changes.
 */
interface FeedEntry {
  title: string;
  url: string;
  excerpt: string;
  publishedAt?: string;
  contentHash?: string;
}

export { FeedType };
export type { Feed, FeedEntry, FeedFollow };
