import type { Feed, FeedEntry } from '../../domain/entities/Feed';
import { FeedType } from '../../domain/entities/Feed';
import type { FeedReader } from '../../domain/ports/FeedReader';
import { SourceFetchStatus } from '../../domain/ports/SourceFetcher';
import type { SourceFetcher } from '../../domain/ports/SourceFetcher';
import { parseFeedXml } from './parseFeedXml';

/**
 * Reads RSS and Atom sources. The document shape is detected from its root
 * element, so a mislabelled feed still parses.
 */

const createRssFeedReader = (fetcher: SourceFetcher): FeedReader => {
  return {
    supports: (feed: Feed): boolean => {
      return feed.type === FeedType.RSS || feed.type === FeedType.ATOM;
    },
    read: async (feed: Feed): Promise<FeedEntry[]> => {
      const result = await fetcher.fetchText(feed.url);

      if (result.outcome === SourceFetchStatus.FAILED) {
        throw new Error(`cannot read feed ${feed.name}: ${result.reason}`);
      }

      return parseFeedXml(result.text);
    },
  };
};

export { createRssFeedReader };
