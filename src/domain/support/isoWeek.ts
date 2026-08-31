/**
 * ISO 8601 week helpers, used to name the weekly digest files.
 *
 * Everything is computed in UTC so that a run near midnight cannot land in two
 * different weeks depending on the runner's time zone.
 */

const MILLISECONDS_PER_DAY = 86_400_000;
const THURSDAY_INDEX = 4;

/** Returns the ISO week number and its ISO week-numbering year. */
const toIsoWeek = (date: Date): { year: number; week: number } => {
  const utcDate = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const dayIndex = utcDate.getUTCDay() === 0 ? 7 : utcDate.getUTCDay();

  // Move to the Thursday of the same ISO week, which always sits in the
  // week-numbering year.
  utcDate.setUTCDate(utcDate.getUTCDate() + THURSDAY_INDEX - dayIndex);

  const year = utcDate.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const firstThursdayDayIndex = firstThursday.getUTCDay() === 0 ? 7 : firstThursday.getUTCDay();
  firstThursday.setUTCDate(firstThursday.getUTCDate() + THURSDAY_INDEX - firstThursdayDayIndex);

  const week =
    1 + Math.round((utcDate.getTime() - firstThursday.getTime()) / (MILLISECONDS_PER_DAY * 7));

  return { year, week };
};

/** Formats a date as the `YYYY-Wnn` label used by the digest file names. */
const toIsoWeekLabel = (date: Date): string => {
  const { year, week } = toIsoWeek(date);

  return `${year}-W${String(week).padStart(2, '0')}`;
};

/** Formats a date as `YYYY-MM-DD` in UTC. */
const toIsoDayLabel = (date: Date): string => {
  return date.toISOString().slice(0, 10);
};

/** Formats a date as `YYYY-MM` in UTC, used by the monthly item files. */
const toIsoMonthLabel = (date: Date): string => {
  return date.toISOString().slice(0, 7);
};

export { toIsoDayLabel, toIsoMonthLabel, toIsoWeek, toIsoWeekLabel };
