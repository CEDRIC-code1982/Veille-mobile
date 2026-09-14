import type { Feed, FeedEntry } from '../../domain/entities/Feed';
import { FeedType } from '../../domain/entities/Feed';
import type { FeedReader } from '../../domain/ports/FeedReader';
import { SourceFetchStatus } from '../../domain/ports/SourceFetcher';
import type { SourceFetcher } from '../../domain/ports/SourceFetcher';
import { normalizeText, truncateText } from '../../domain/support/normalizeText';
import { stripHtml } from '../../domain/support/stripHtml';
import { computeStableHash } from '../../shared/hash';
import { createLogger } from '../../shared/logger';
import { MAX_EXCERPT_LENGTH } from './parseFeedXml';

/**
 * Reads a documentation page that publishes no feed.
 *
 * Such a page carries no publication date, so its identity is the hash of its
 * own main text: a new item appears when, and only when, the content actually
 * changes. Hashing the main region rather than the whole document keeps
 * navigation and footer churn from producing false positives.
 */

const logger = createLogger(import.meta.url);

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

const HREF_PATTERN = /href="([^"]+)"/gi;
const TEMPLATE_KEY = '{key}';

/**
 * Reads an index page and returns the highest version keys it links to.
 *
 * Keys are compared numerically, so `17` wins over `9`, which a plain string
 * sort would get backwards. A key that is not a number is ignored rather than
 * guessed at.
 */
const discoverKeys = (html: string, linkPattern: string, limit: number): string[] => {
  const matcher = new RegExp(linkPattern);
  const keys = new Set<string>();

  for (const match of html.matchAll(HREF_PATTERN)) {
    const href = match[1];

    if (href === undefined) {
      continue;
    }

    const captured = matcher.exec(href)?.[1];

    if (captured === undefined || !/^\d+$/.test(captured)) {
      continue;
    }

    keys.add(captured);
  }

  return [...keys]
    .sort((left, right) => Number(right) - Number(left))
    .slice(0, Math.max(1, limit));
};

/** Builds one entry from an already fetched page. */
const toEntry = (html: string, url: string, fallbackTitle: string, suffix?: string): FeedEntry => {
  const mainText = stripHtml(extractMainRegion(html));

  if (mainText.length === 0) {
    throw new Error(`no readable content found at ${url}`);
  }

  const flattened = mainText.replace(/\s+/g, ' ').trim();
  const title = extractTitle(html, fallbackTitle);

  return {
    // The suffix is the URL segment itself, never an interpretation of it: two
    // followed pages must be tellable apart without asserting a product name.
    title: suffix === undefined ? title : `${title} — ${suffix}`,
    url,
    excerpt: truncateText(flattened, MAX_EXCERPT_LENGTH),
    contentHash: computeStableHash(normalizeText(mainText), CONTENT_HASH_LENGTH),
  };
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

      if (feed.follow === undefined) {
        try {
          return [toEntry(result.text, feed.url, feed.name)];
        } catch (error) {
          throw new Error(
            `cannot scrape ${feed.name}: ${error instanceof Error ? error.message : 'unreadable'}`,
            { cause: error },
          );
        }
      }

      const keys = discoverKeys(result.text, feed.follow.linkPattern, feed.follow.limit);

      if (keys.length === 0) {
        throw new Error(`cannot scrape ${feed.name}: the index exposed no usable link`);
      }

      const entries: FeedEntry[] = [];

      for (const key of keys) {
        const followedUrl = new URL(
          feed.follow.urlTemplate.split(TEMPLATE_KEY).join(key),
          feed.url,
        ).toString();
        const followed = await fetcher.fetchText(followedUrl);

        if (followed.outcome === SourceFetchStatus.FAILED) {
          // One unreachable version must not lose the others.
          logger.warn(`${feed.name}: ${followedUrl} could not be read, ${followed.reason}`);
          continue;
        }

        try {
          entries.push(toEntry(followed.text, followedUrl, feed.name, key));
        } catch (error) {
          logger.warn(
            `${feed.name}: ${error instanceof Error ? error.message : 'unreadable page'}`,
          );
        }
      }

      if (entries.length === 0) {
        throw new Error(`cannot scrape ${feed.name}: no followed page was readable`);
      }

      return entries;
    },
  };
};

export { createScrapeFeedReader, discoverKeys, extractMainRegion, extractTitle };
