import { createHash } from 'node:crypto';

/**
 * Stable hashing, kept out of the domain so that the domain layer depends on
 * nothing at all, not even a Node built-in.
 */

const DEFAULT_HASH_LENGTH = 16;

/**
 * Hashes a source string built by the domain into a short, stable, URL-safe
 * identifier. Same input, same output, forever: identifiers end up committed.
 */
const computeStableHash = (source: string, length: number = DEFAULT_HASH_LENGTH): string => {
  return createHash('sha256').update(source, 'utf8').digest('hex').slice(0, length);
};

export { computeStableHash, DEFAULT_HASH_LENGTH };
