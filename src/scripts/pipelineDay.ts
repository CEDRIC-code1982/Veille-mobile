import { basename } from 'node:path';

import type { Clock } from '../domain/ports/Clock';
import { toIsoDayLabel } from '../domain/support/isoWeek';
import { listDirectory } from '../shared/jsonStore';
import { PATHS } from '../shared/paths';

/**
 * Day resolution shared by the pipeline stages.
 *
 * Every stage works on one day label. It defaults to today, can be forced with
 * `--day=YYYY-MM-DD` for a replay, and falls back to the newest file already on
 * disk so a rerun after midnight still finds its input.
 */

const DAY_FLAG_PATTERN = /^--day=(\d{4}-\d{2}-\d{2})$/;
const DAY_FILE_PATTERN = /^(\d{4}-\d{2}-\d{2})\.json$/;

const resolveRequestedDay = (argv: readonly string[], clock: Clock): string => {
  for (const argument of argv) {
    const match = DAY_FLAG_PATTERN.exec(argument);
    const day = match?.[1];

    if (day !== undefined) {
      return day;
    }
  }

  return toIsoDayLabel(clock.now());
};

/** Day labels of the collect outputs present on disk, oldest first. */
const listCollectedDays = (): string[] => {
  const days: string[] = [];

  for (const fileName of listDirectory(PATHS.rawDirectory)) {
    const match = DAY_FILE_PATTERN.exec(basename(fileName));
    const day = match?.[1];

    if (day !== undefined) {
      days.push(day);
    }
  }

  return days.sort();
};

const findNewestCollectedDay = (): string | undefined => {
  const days = listCollectedDays();

  return days[days.length - 1];
};

export { findNewestCollectedDay, listCollectedDays, resolveRequestedDay };
