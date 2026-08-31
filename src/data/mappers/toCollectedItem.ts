import type { CollectedItem } from '../../domain/entities/CollectedItem';
import type { Feed, FeedEntry } from '../../domain/entities/Feed';
import { canonicalizeUrl } from '../../domain/support/canonicalizeUrl';
import {
  buildContentFingerprintSource,
  buildContentIdSource,
  buildFingerprintSource,
  buildIdSource,
} from '../../domain/support/identifiers';
import { truncateText } from '../../domain/support/normalizeText';
import { computeStableHash } from '../../shared/hash';
import { MAX_EXCERPT_LENGTH } from '../feeds/parseFeedXml';

/**
 * Turns a raw feed entry into a normalised collected item.
 *
 * An entry the mapper cannot make sense of yields `undefined` rather than a
 * half-invented item: a missing date becomes the collection time, but a missing
 * or unusable URL is fatal for that entry alone.
 */

/** Resolves a possibly relative entry URL against its feed. */
const resolveUrl = (rawUrl: string, feedUrl: string): string | undefined => {
  try {
    const resolved = new URL(rawUrl.trim(), feedUrl);

    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      return undefined;
    }

    return canonicalizeUrl(resolved.toString());
  } catch {
    return undefined;
  }
};

/** Parses any feed date into an ISO timestamp, or nothing when unusable. */
const toIsoTimestamp = (rawDate: string | undefined): string | undefined => {
  if (rawDate === undefined) {
    return undefined;
  }

  const parsed = new Date(rawDate);

  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed.toISOString();
};

const toCollectedItem = (
  feed: Feed,
  entry: FeedEntry,
  collectedAt: string,
): CollectedItem | undefined => {
  const title = entry.title.replace(/\s+/g, ' ').trim();
  const sourceUrl = resolveUrl(entry.url, feed.url);

  if (title.length === 0 || sourceUrl === undefined) {
    return undefined;
  }

  const publishedAt = toIsoTimestamp(entry.publishedAt) ?? collectedAt;
  const contentHash = entry.contentHash;

  const idSource =
    contentHash !== undefined
      ? buildContentIdSource(sourceUrl, contentHash)
      : buildIdSource(sourceUrl);
  const fingerprintSource =
    contentHash !== undefined
      ? buildContentFingerprintSource(title, contentHash)
      : buildFingerprintSource(title, publishedAt);

  return {
    id: computeStableHash(idSource),
    title,
    sourceUrl,
    sourceName: feed.name,
    sourceDomain: new URL(sourceUrl).hostname,
    official: feed.official,
    categories: [...feed.categories],
    publishedAt,
    collectedAt,
    excerpt: truncateText(entry.excerpt.replace(/\s+/g, ' ').trim(), MAX_EXCERPT_LENGTH),
    fingerprint: computeStableHash(fingerprintSource),
  };
};

export { resolveUrl, toCollectedItem, toIsoTimestamp };
