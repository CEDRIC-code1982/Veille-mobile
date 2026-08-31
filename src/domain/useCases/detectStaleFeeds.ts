import type { Feed } from '../entities/Feed';

/**
 * Silent failure detection.
 *
 * A watch system that stops collecting without saying anything is worse than no
 * watch system at all: it produces the feeling of being informed. Two symptoms
 * are tracked here, and they are the only notification allowed to interrupt
 * besides a verified blocking item.
 *
 * - a single feed that has published nothing for longer than its own
 *   `maxAgeDays`,
 * - the whole pipeline collecting nothing at all for `pipelineSilenceDays`.
 */

const MILLISECONDS_PER_DAY = 86_400_000;

interface FeedActivity {
  feedName: string;
  lastItemAt?: string;
}

interface DetectStaleFeedsInput {
  feeds: readonly Feed[];
  activities: readonly FeedActivity[];
  now: Date;
  pipelineSilenceDays: number;
  lastPipelineItemAt?: string;
}

interface StaleFeedFinding {
  feedName: string;
  maxAgeDays: number;
  daysSinceLastItem?: number;
}

interface DetectStaleFeedsResult {
  staleFeeds: StaleFeedFinding[];
  isPipelineSilent: boolean;
  daysSinceLastPipelineItem?: number;
}

/** Whole days elapsed since an ISO timestamp, or `undefined` if unusable. */
const daysSince = (isoDate: string | undefined, now: Date): number | undefined => {
  if (isoDate === undefined || isoDate.trim().length === 0) {
    return undefined;
  }

  const parsed = new Date(isoDate);

  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return Math.floor((now.getTime() - parsed.getTime()) / MILLISECONDS_PER_DAY);
};

const detectStaleFeeds = (input: DetectStaleFeedsInput): DetectStaleFeedsResult => {
  const activityByName = new Map<string, FeedActivity>();

  for (const activity of input.activities) {
    activityByName.set(activity.feedName, activity);
  }

  const staleFeeds: StaleFeedFinding[] = [];

  for (const feed of input.feeds) {
    const elapsed = daysSince(activityByName.get(feed.name)?.lastItemAt, input.now);

    if (elapsed === undefined) {
      staleFeeds.push({ feedName: feed.name, maxAgeDays: feed.maxAgeDays });
      continue;
    }

    if (elapsed > feed.maxAgeDays) {
      staleFeeds.push({
        feedName: feed.name,
        maxAgeDays: feed.maxAgeDays,
        daysSinceLastItem: elapsed,
      });
    }
  }

  const pipelineElapsed = daysSince(input.lastPipelineItemAt, input.now);
  const isPipelineSilent =
    pipelineElapsed === undefined || pipelineElapsed > input.pipelineSilenceDays;

  return {
    staleFeeds,
    isPipelineSilent,
    ...(pipelineElapsed !== undefined ? { daysSinceLastPipelineItem: pipelineElapsed } : {}),
  };
};

export { detectStaleFeeds };
export type { DetectStaleFeedsInput, DetectStaleFeedsResult, FeedActivity, StaleFeedFinding };
