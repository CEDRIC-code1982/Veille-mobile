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

/**
 * Builds the identifier sets used to reject an item that is already online.
 *
 * An item published without a summary was never really classified: the model
 * failed, the run had no model at all, or it was skipped for budget. Such an
 * item is deliberately left out of the known set, so it is collected again and
 * gets another chance; the publish stage then replaces the stored version. That
 * is what keeps a degraded item from staying degraded forever.
 */
const buildKnownItems = (items: readonly VeilleItem[]): KnownItems => {
  const ids = new Set<string>();
  const fingerprints = new Set<string>();

  for (const item of items) {
    if (item.summary.trim().length === 0) {
      continue;
    }

    ids.add(item.id);
    fingerprints.add(item.fingerprint);
  }

  return { ids, fingerprints };
};

const readKnownItems = (): KnownItems => {
  return buildKnownItems(readAllPublishedItems());
};

export {
  buildKnownItems,
  listPublishedMonths,
  readAllPublishedItems,
  readKnownItems,
  readMonthItems,
};
