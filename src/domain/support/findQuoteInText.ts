import { normalizeText } from './normalizeText';

/**
 * Deterministic evidence lookup: is the quoted sentence really on the page?
 *
 * The comparison runs on normalised text. A quote split by an ellipsis is
 * accepted when every one of its segments is present, in order, which is the
 * only tolerance granted: it covers the usual "beginning ... end" quoting
 * without letting an approximate quote through.
 */

const MIN_SEGMENT_LENGTH = 12;
const ELLIPSIS_PATTERN = /\s*\.\.\.\s*/;
const SURROUNDING_QUOTES_PATTERN = /^["'\s]+|["'\s]+$/g;

const QuoteLookupResult = {
  FOUND: 'found',
  MISSING: 'missing',
  TOO_SHORT: 'too-short',
} as const;
type QuoteLookupResult = typeof QuoteLookupResult[keyof typeof QuoteLookupResult];

/** Splits a normalised quote into the segments that must all be present. */
const toSegments = (normalizedQuote: string): string[] => {
  return normalizedQuote
    .split(ELLIPSIS_PATTERN)
    .map((segment) => segment.replace(SURROUNDING_QUOTES_PATTERN, ''))
    .filter((segment) => segment.length > 0);
};

/**
 * Looks for a quote inside a page text.
 *
 * A quote too short to prove anything is reported as `TOO_SHORT` rather than
 * found, so that a one-word "quote" can never promote an item.
 */
const findQuoteInText = (quote: string, pageText: string): QuoteLookupResult => {
  const normalizedQuote = normalizeText(quote).replace(SURROUNDING_QUOTES_PATTERN, '');
  const segments = toSegments(normalizedQuote);
  const longestSegmentLength = segments.reduce(
    (longest, segment) => Math.max(longest, segment.length),
    0,
  );

  if (segments.length === 0 || longestSegmentLength < MIN_SEGMENT_LENGTH) {
    return QuoteLookupResult.TOO_SHORT;
  }

  const normalizedPage = normalizeText(pageText);
  let searchFrom = 0;

  for (const segment of segments) {
    const foundAt = normalizedPage.indexOf(segment, searchFrom);

    if (foundAt < 0) {
      return QuoteLookupResult.MISSING;
    }

    searchFrom = foundAt + segment.length;
  }

  return QuoteLookupResult.FOUND;
};

export { findQuoteInText, QuoteLookupResult };
