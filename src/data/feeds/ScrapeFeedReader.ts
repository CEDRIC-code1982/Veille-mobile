import type { Feed, FeedEntry } from '../../domain/entities/Feed';
import { FeedType } from '../../domain/entities/Feed';
import type { FeedReader } from '../../domain/ports/FeedReader';
import { SourceFetchStatus } from '../../domain/ports/SourceFetcher';
import type { SourceFetcher } from '../../domain/ports/SourceFetcher';
import { normalizeText, truncateText } from '../../domain/support/normalizeText';
import { stripHtml } from '../../domain/support/stripHtml';
import { computeStableHash } from '../../shared/hash';
import { MAX_EXCERPT_LENGTH } from './parseFeedXml';

/**
 * Reads a documentation page that publishes no feed.
 *
 * Such a page carries no publication date, so its identity is the hash of its
 * own main text: a new item appears when, and only when, the content actually
 * changes. Hashing the main region rather than the whole document keeps
 * navigation and footer churn from producing false positives.
 */

const CONTENT_HASH_LENGTH = 24;

const MAIN_REGION_PATTERNS = [
  /<main\b[^>]*>([\s\S]*?)<\/main>/i,
  /<article\b[^>]*>([\s\S]*?)<\/article>/i,
  /<body\b[^>]*>([\s\S]*?)<\/body>/i,
];

const TITLE_PATTERNS = [/<h1\b[^>]*>([\s\S]*?)<\/h1>/i, /<title\b[^>]*>([\s\S]*?)<\/title>/i];

/** Narrows a page down to its main region, falling back to the whole document. */
const extractMainRegion = (html: string): string => {
  for (const pattern of MAIN_REGION_PATTERNS) {
    const match = pattern.exec(html);
    const region = match?.[1];

    if (region !== undefined && region.trim().length > 0) {
      return region;
    }
  }

  return html;
};

const extractTitle = (html: string, fallback: string): string => {
  for (const pattern of TITLE_PATTERNS) {
    const match = pattern.exec(html);
    const rawTitle = match?.[1];

    if (rawTitle === undefined) {
      continue;
    }

    const title = stripHtml(rawTitle).replace(/\s+/g, ' ').trim();

    if (title.length > 0) {
      return title;
    }
  }

  return fallback;
};

const createScrapeFeedReader = (fetcher: SourceFetcher): FeedReader => {
  return {
    supports: (feed: Feed): boolean => {
      return feed.type === FeedType.SCRAPE;
    },
    read: async (feed: Feed): Promise<FeedEntry[]> => {
      const result = await fetcher.fetchText(feed.url);

      if (result.outcome === SourceFetchStatus.FAILED) {
        throw new Error(`cannot scrape ${feed.name}: ${result.reason}`);
      }

      const mainText = stripHtml(extractMainRegion(result.text));

      if (mainText.length === 0) {
        throw new Error(`cannot scrape ${feed.name}: no readable content found`);
      }

      const flattened = mainText.replace(/\s+/g, ' ').trim();

      return [
        {
          title: extractTitle(result.text, feed.name),
          url: feed.url,
          excerpt: truncateText(flattened, MAX_EXCERPT_LENGTH),
          contentHash: computeStableHash(normalizeText(mainText), CONTENT_HASH_LENGTH),
        },
      ];
    },
  };
};

export { createScrapeFeedReader, extractMainRegion, extractTitle };
