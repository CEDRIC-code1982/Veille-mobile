import type { CollectedItem } from '../entities/CollectedItem';

/**
 * Collapses duplicates inside one collection run, then removes what has already
 * been published.
 *
 * Two levels of duplication are handled:
 *
 * - same `id`, meaning the very same URL seen twice,
 * - same `fingerprint`, meaning the same story relayed by several feeds.
 *
 * When two candidates collide, the first-party one wins; failing that the
 * earliest publication, then the shortest URL, then the identifier. That order
 * makes the outcome fully deterministic, which matters for a pipeline whose
 * output is committed.
 */

interface DeduplicateItemsResult {
  kept: CollectedItem[];
  dropped: CollectedItem[];
}

interface KnownItems {
  ids: ReadonlySet<string>;
  fingerprints: ReadonlySet<string>;
}

interface RejectKnownItemsResult {
  fresh: CollectedItem[];
  known: CollectedItem[];
}

/** Negative when `left` should be preferred over `right`. */
const compareCandidates = (left: CollectedItem, right: CollectedItem): number => {
  if (left.official !== right.official) {
    return left.official ? -1 : 1;
  }

  const byPublication = left.publishedAt.localeCompare(right.publishedAt);

  if (byPublication !== 0) {
    return byPublication;
  }

  if (left.sourceUrl.length !== right.sourceUrl.length) {
    return left.sourceUrl.length - right.sourceUrl.length;
  }

  return left.id.localeCompare(right.id);
};

/** Most recent first, identifier as tie-breaker. */
const compareForOutput = (left: CollectedItem, right: CollectedItem): number => {
  const byPublication = right.publishedAt.localeCompare(left.publishedAt);

  return byPublication !== 0 ? byPublication : left.id.localeCompare(right.id);
};

const pickWinners = (
  items: readonly CollectedItem[],
  toKey: (item: CollectedItem) => string,
): { winners: CollectedItem[]; losers: CollectedItem[] } => {
  const bestByKey = new Map<string, CollectedItem>();
  const losers: CollectedItem[] = [];

  for (const item of items) {
    const key = toKey(item);
    const incumbent = bestByKey.get(key);

    if (incumbent === undefined) {
      bestByKey.set(key, item);
      continue;
    }

    if (compareCandidates(item, incumbent) < 0) {
      bestByKey.set(key, item);
      losers.push(incumbent);
      continue;
    }

    losers.push(item);
  }

  return { winners: [...bestByKey.values()], losers };
};

const deduplicateItems = (items: readonly CollectedItem[]): DeduplicateItemsResult => {
  const byId = pickWinners(items, (item) => item.id);
  const byFingerprint = pickWinners(byId.winners, (item) => item.fingerprint);

  return {
    kept: byFingerprint.winners.sort(compareForOutput),
    dropped: [...byId.losers, ...byFingerprint.losers].sort(compareForOutput),
  };
};

/** Splits a collection between never-seen items and already-published ones. */
const rejectKnownItems = (
  items: readonly CollectedItem[],
  known: KnownItems,
): RejectKnownItemsResult => {
  const fresh: CollectedItem[] = [];
  const alreadyKnown: CollectedItem[] = [];

  for (const item of items) {
    if (known.ids.has(item.id) || known.fingerprints.has(item.fingerprint)) {
      alreadyKnown.push(item);
      continue;
    }

    fresh.push(item);
  }

  return { fresh, known: alreadyKnown };
};

export { deduplicateItems, rejectKnownItems };
export type { DeduplicateItemsResult, KnownItems, RejectKnownItemsResult };
