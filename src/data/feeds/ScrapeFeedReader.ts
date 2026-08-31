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

const HEADING_PATTERN = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i;
const DOCUMENT_TITLE_PATTERN = /<title\b[^>]*>([\s\S]*?)<\/title>/i;
const SITE_NAME_SEPARATOR_PATTERN = /\s+[|\u00b7\u2013\u2014]\s+/;
const MAX_TITLE_LENGTH = 160;

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

/**
 * First non-empty line of a heading.
 *
 * Documentation sites bury widgets inside the heading itself, on their own
 * block: keeping only the first line drops them, where collapsing all the
 * whitespace would have glued them to the real title.
 */
const readFirstLine = (html: string): string | undefined => {
  for (const line of stripHtml(html).split('\n')) {
    const trimmed = line.trim();

    if (trimmed.length > 0) {
      return truncateText(trimmed, MAX_TITLE_LENGTH);
    }
  }

  return undefined;
};

const extractTitle = (html: string, fallback: string): string => {
  const headingMatch = HEADING_PATTERN.exec(html);
  const heading = headingMatch?.[1] === undefined ? undefined : readFirstLine(headingMatch[1]);

  if (heading !== undefined) {
    return heading;
  }

  const titleMatch = DOCUMENT_TITLE_PATTERN.exec(html);
  const documentTitle = titleMatch?.[1] === undefined ? undefined : readFirstLine(titleMatch[1]);

  if (documentTitle === undefined) {
    return fallback;
  }

  // A document title is conventionally "Page | Site": keep the page part only.
  const pagePart = documentTitle.split(SITE_NAME_SEPARATOR_PATTERN)[0]?.trim();

  return pagePart !== undefined && pagePart.length > 0 ? pagePart : documentTitle;
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
