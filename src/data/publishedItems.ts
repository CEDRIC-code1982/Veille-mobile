import { basename } from 'node:path';

import type { VeilleItem } from '../domain/entities/VeilleItem';
import type { KnownItems } from '../domain/useCases/deduplicateItems';
import { listDirectory, readOptionalJsonFile } from '../shared/jsonStore';
import { buildMonthItemsPath, PATHS } from '../shared/paths';
import { monthFileSchema } from '../shared/schemas/publication';

/**
 * Access to what has already been published, under `data/items/`.
 *
 * One file per month, so the site can fetch only the months it needs and the
 * history never becomes a single growing blob.
 */

const MONTH_FILE_PATTERN = /^(\d{4}-\d{2})\.json$/;

/** Lists the month labels that already have a file, oldest first. */
const listPublishedMonths = (): string[] => {
  const months: string[] = [];

  for (const fileName of listDirectory(PATHS.itemsDirectory)) {
    const match = MONTH_FILE_PATTERN.exec(basename(fileName));
    const month = match?.[1];

    if (month !== undefined) {
      months.push(month);
    }
  }

  return months.sort();
};

const readMonthItems = (monthLabel: string): VeilleItem[] => {
  return readOptionalJsonFile(buildMonthItemsPath(monthLabel), monthFileSchema)?.items ?? [];
};

const readAllPublishedItems = (): VeilleItem[] => {
  const items: VeilleItem[] = [];

  for (const month of listPublishedMonths()) {
    items.push(...readMonthItems(month));
  }

  return items;
};

/** Builds the identifier sets used to reject an item that is already online. */
const readKnownItems = (): KnownItems => {
  const ids = new Set<string>();
  const fingerprints = new Set<string>();

  for (const item of readAllPublishedItems()) {
    ids.add(item.id);
    fingerprints.add(item.fingerprint);
  }

  return { ids, fingerprints };
};

export { listPublishedMonths, readAllPublishedItems, readKnownItems, readMonthItems };
