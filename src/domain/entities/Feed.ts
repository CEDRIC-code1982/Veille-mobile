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
interface Feed {
  name: string;
  url: string;
  type: FeedType;
  domain: string;
  categories: Category[];
  official: boolean;
  maxAgeDays: number;
}

/** One entry as read from a feed or a scraped page, before any normalisation. */
interface FeedEntry {
  title: string;
  url: string;
  excerpt: string;
  publishedAt?: string;
}

export { FeedType };
export type { Feed, FeedEntry };
