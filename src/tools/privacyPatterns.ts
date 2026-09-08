/**
 * Pure helpers behind the privacy scan.
 *
 * The scan looks for terms that must never appear in this public repository.
 * Matching is deliberately loose: case-insensitive and blind to the usual
 * separators, so `AcmeCorp`, `acme-corp`, `acme_corp` and `Acme Corp` are all
 * caught by a single term.
 *
 * Nothing here ever echoes a term or the matched text: a violation is reported
 * by term index only, because this scan also runs in a public CI log.
 */

const SEPARATOR_PATTERN = '[-_\\s.]*';
const COMMENT_PREFIX = '#';

/**
 * A term this short is anchored instead of being matched as a substring.
 *
 * A three-letter company acronym is exactly the kind of term worth blocking,
 * but unanchored it also matches inside integrity hashes and English words, and
 * would block every commit for nothing. Anchoring keeps it usable.
 */
const SHORT_TERM_MAX_LENGTH = 4;

interface PrivacyViolation {
  location: string;
  patternIndex: number;
}

/**
 * Reads a raw terms file or environment variable: one term per line, blank
 * lines and `#` comments ignored.
 */
const parseForbiddenTerms = (raw: string): string[] => {
  const terms: string[] = [];

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (line.length === 0 || line.startsWith(COMMENT_PREFIX)) {
      continue;
    }

    terms.push(line);
  }

  return terms;
};

/**
 * Splits a term into alphanumeric chunks, treating both punctuation and
 * lowerUpper transitions as boundaries, so `AcmeCorp` and `Acme Corp` yield the
 * same chunks.
 */
const splitTermIntoChunks = (term: string): string[] => {
  const withCamelCaseBoundaries = term.replace(/([a-z0-9])([A-Z])/g, '$1 $2');

  return withCamelCaseBoundaries
    .split(/[^a-zA-Z0-9]+/)
    .filter((chunk) => chunk.length > 0);
};

/**
 * Builds the separator-tolerant, case-insensitive pattern for one term.
 * Returns `undefined` for a term holding no alphanumeric character at all.
 */
const buildTermPattern = (term: string): RegExp | undefined => {
  const chunks = splitTermIntoChunks(term);

  if (chunks.length === 0) {
    return undefined;
  }

  const body = chunks.join(SEPARATOR_PATTERN);

  if (chunks.join('').length > SHORT_TERM_MAX_LENGTH) {
    return new RegExp(body, 'i');
  }

  // Letters and digits break the match, but hyphens, underscores, dots and
  // spaces do not: "ZQL" still catches "ZQL Access" and "my_zql_thing".
  return new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`, 'i');
};

/** Compiles every usable term into a pattern, keeping the term order. */
const buildTermPatterns = (terms: string[]): RegExp[] => {
  const patterns: RegExp[] = [];

  for (const term of terms) {
    const pattern = buildTermPattern(term);

    if (pattern === undefined) {
      continue;
    }

    patterns.push(pattern);
  }

  return patterns;
};

/**
 * Scans a text line by line and reports every match as `location:line` plus the
 * 1-based index of the offending term.
 */
const findViolationsInText = (
  text: string,
  patterns: RegExp[],
  location: string,
): PrivacyViolation[] => {
  const violations: PrivacyViolation[] = [];
  const lines = text.split(/\r?\n/);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? '';

    for (let patternIndex = 0; patternIndex < patterns.length; patternIndex += 1) {
      const pattern = patterns[patternIndex];

      if (pattern === undefined || !pattern.test(line)) {
        continue;
      }

      violations.push({
        location: `${location}:${lineIndex + 1}`,
        patternIndex: patternIndex + 1,
      });
    }
  }

  return violations;
};

export {
  buildTermPattern,
  buildTermPatterns,
  findViolationsInText,
  parseForbiddenTerms,
  SHORT_TERM_MAX_LENGTH,
};
export type { PrivacyViolation };
