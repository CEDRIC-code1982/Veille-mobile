import type { CollectedItem } from '../entities/CollectedItem';

/**
 * Keeps only the items recent enough to be worth watching.
 *
 * Some official feeds advertise a very long backlog: without this filter the
 * first run would pay to classify years of old announcements, and the site
 * would open on stale news. An item with an unparsable date is kept, because
 * dropping it would silently lose information.
 */

const MILLISECONDS_PER_DAY = 86_400_000;

interface FilterRecentItemsInput {
  items: readonly CollectedItem[];
  now: Date;
  maxAgeDays: number;
}

interface FilterRecentItemsResult {
  recent: CollectedItem[];
  tooOld: CollectedItem[];
}

const filterRecentItems = (input: FilterRecentItemsInput): FilterRecentItemsResult => {
  const oldestAccepted = input.now.getTime() - input.maxAgeDays * MILLISECONDS_PER_DAY;
  const recent: CollectedItem[] = [];
  const tooOld: CollectedItem[] = [];

  for (const item of input.items) {
    const published = Date.parse(item.publishedAt);

    if (Number.isNaN(published) || published >= oldestAccepted) {
      recent.push(item);
      continue;
    }

    tooOld.push(item);
  }

  return { recent, tooOld };
};

export { filterRecentItems };
export type { FilterRecentItemsInput, FilterRecentItemsResult };
