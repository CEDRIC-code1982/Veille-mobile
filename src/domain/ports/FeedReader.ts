import type { Feed, FeedEntry } from '../entities/Feed';

/**
 * Reads one configured source. Implementations must never throw for a remote
 * failure: they reject, and the caller turns that into a `FeedError`.
 */
interface FeedReader {
  supports: (feed: Feed) => boolean;
  read: (feed: Feed) => Promise<FeedEntry[]>;
}

export type { FeedReader };
