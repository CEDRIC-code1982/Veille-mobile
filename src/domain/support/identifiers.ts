import { canonicalizeUrl } from './canonicalizeUrl';
import { normalizeText } from './normalizeText';

/**
 * Sources of the two stable identifiers carried by every item.
 *
 * The domain only builds the strings to hash; hashing itself lives in
 * `src/shared/hash.ts`, so that this layer keeps no dependency at all, not even
 * on `node:crypto`.
 *
 * - `id` identifies one URL: the same article collected twice keeps one entry.
 * - `fingerprint` identifies one story: the same announcement relayed by two
 *   feeds collapses, while a recurring title (release notes, for instance)
 *   stays distinct from one publication date to the next.
 */

/** Keeps the calendar day of an ISO 8601 timestamp, or an empty string. */
const toDayStamp = (isoDate: string): string => {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(isoDate.trim());

  return match?.[1] ?? '';
};

const buildIdSource = (sourceUrl: string): string => {
  return canonicalizeUrl(sourceUrl);
};

const buildFingerprintSource = (title: string, publishedAt: string): string => {
  return `${normalizeText(title)}|${toDayStamp(publishedAt)}`;
};

export { buildFingerprintSource, buildIdSource, toDayStamp };
