/**
 * Stage 1 of 4: collect.
 *
 * Fetches every configured source, normalises the entries, drops the duplicates
 * and whatever is already published, then writes the result to `data/raw/`.
 *
 * This stage never calls the language model, and a dead source never fails the
 * run: each feed is settled independently and a failure becomes a feed error
 * carried along with the data.
 *
 * The work lives in `runCollect`, which takes its dependencies as arguments so
 * the whole stage can be exercised on local fixtures with no network at all.
 */

import { pathToFileURL } from 'node:url';

import type { CollectedItem } from '../domain/entities/CollectedItem';
import type { Feed } from '../domain/entities/Feed';
import { FeedType } from '../domain/entities/Feed';
import type { FeedError } from '../domain/entities/FeedError';
import type { Clock } from '../domain/ports/Clock';
import type { FeedReader } from '../domain/ports/FeedReader';
import { deduplicateItems, rejectKnownItems } from '../domain/useCases/deduplicateItems';
import type { KnownItems } from '../domain/useCases/deduplicateItems';
import type { FeedActivity } from '../domain/useCases/detectStaleFeeds';
import { filterRecentItems } from '../domain/useCases/filterRecentItems';
import { toIsoDayLabel } from '../domain/support/isoWeek';
import { createRssFeedReader } from '../data/feeds/RssFeedReader';
import { createScrapeFeedReader } from '../data/feeds/ScrapeFeedReader';
import { createHttpSourceFetcher } from '../data/feeds/httpClient';
import { toCollectedItem, toIsoTimestamp } from '../data/mappers/toCollectedItem';
import { readKnownItems } from '../data/publishedItems';
import { loadFeeds } from '../shared/config';
import { readIntegerEnv } from '../shared/env';
import { writeJsonFile } from '../shared/jsonStore';
import { createLogger } from '../shared/logger';
import { buildRawCollectionPath } from '../shared/paths';
import { rawCollectionSchema } from '../shared/schemas/pipeline';
import { systemClock } from '../shared/systemClock';

const logger = createLogger(import.meta.url);

const DEFAULT_MAX_ITEM_AGE_DAYS = 30;

interface CollectDependencies {
  feeds: readonly Feed[];
  readers: readonly FeedReader[];
  clock: Clock;
  known: KnownItems;
  maxItemAgeDays: number;
}

interface RawCollection {
  collectedAt: string;
  items: CollectedItem[];
  feedErrors: FeedError[];
  activities: FeedActivity[];
}

interface FeedOutcome {
  items: CollectedItem[];
  activity?: FeedActivity;
  error?: FeedError;
}

const pickReader = (readers: readonly FeedReader[], feed: Feed): FeedReader | undefined => {
  return readers.find((reader) => reader.supports(feed));
};

const describeUnknownError = (error: unknown): string => {
  return error instanceof Error ? error.message : 'unknown failure';
};

/**
 * Activity of a source, used later by the mute-feed detection.
 *
 * For a feed, it is the newest entry it advertises: a feed that answers but is
 * frozen must still be detected. For a scraped page, it is the successful read
 * itself, because a documentation page that does not change is normal.
 */
const resolveActivity = (
  feed: Feed,
  items: readonly CollectedItem[],
  collectedAt: string,
): FeedActivity => {
  if (feed.type === FeedType.SCRAPE) {
    return { feedName: feed.name, lastItemAt: collectedAt };
  }

  let newest: string | undefined;

  for (const item of items) {
    const published = toIsoTimestamp(item.publishedAt);

    if (published !== undefined && (newest === undefined || published > newest)) {
      newest = published;
    }
  }

  if (newest === undefined) {
    return { feedName: feed.name };
  }

  return { feedName: feed.name, lastItemAt: newest };
};

const collectFeed = async (
  readers: readonly FeedReader[],
  feed: Feed,
  collectedAt: string,
): Promise<FeedOutcome> => {
  const reader = pickReader(readers, feed);

  if (reader === undefined) {
    return {
      items: [],
      error: {
        feedName: feed.name,
        feedUrl: feed.url,
        reason: `no reader supports type ${feed.type}`,
        occurredAt: collectedAt,
      },
    };
  }

  try {
    const entries = await reader.read(feed);
    const items: CollectedItem[] = [];

    for (const entry of entries) {
      const item = toCollectedItem(feed, entry, collectedAt);

      if (item === undefined) {
        logger.debug(`dropped an unusable entry from ${feed.name}`);
        continue;
      }

      items.push(item);
    }

    logger.info(`${feed.name}: ${entries.length} entry(ies) read, ${items.length} usable`);

    if (entries.length === 0) {
      logger.warn(`${feed.name} answered but advertised no entry at all`);
    }

    return { items, activity: resolveActivity(feed, items, collectedAt) };
  } catch (error) {
    logger.warn(`${feed.name} could not be read: ${describeUnknownError(error)}`);

    return {
      items: [],
      error: {
        feedName: feed.name,
        feedUrl: feed.url,
        reason: describeUnknownError(error),
        occurredAt: collectedAt,
      },
    };
  }
};

/** Runs the whole collect stage and returns what should be written to disk. */
const runCollect = async (dependencies: CollectDependencies): Promise<RawCollection> => {
  const { feeds, readers, clock, known, maxItemAgeDays } = dependencies;
  const now = clock.now();
  const collectedAt = now.toISOString();

  const settled = await Promise.allSettled(
    feeds.map((feed) => collectFeed(readers, feed, collectedAt)),
  );

  const allItems: CollectedItem[] = [];
  const feedErrors: FeedError[] = [];
  const activities: FeedActivity[] = [];

  for (let index = 0; index < settled.length; index += 1) {
    const result = settled[index];
    const feed = feeds[index];

    if (result === undefined || feed === undefined) {
      continue;
    }

    if (result.status === 'rejected') {
      // collectFeed turns failures into values, so this branch only catches a
      // programming error. It must still not fail the run.
      logger.error(`unexpected rejection while collecting ${feed.name}`, result.reason);
      feedErrors.push({
        feedName: feed.name,
        feedUrl: feed.url,
        reason: 'unexpected rejection',
        occurredAt: collectedAt,
      });
      continue;
    }

    allItems.push(...result.value.items);

    if (result.value.activity !== undefined) {
      activities.push(result.value.activity);
    }

    if (result.value.error !== undefined) {
      feedErrors.push(result.value.error);
    }
  }

  const recent = filterRecentItems({ items: allItems, now, maxAgeDays: maxItemAgeDays });
  const deduplicated = deduplicateItems(recent.recent);
  const split = rejectKnownItems(deduplicated.kept, known);

  logger.info(
    `${allItems.length} collected, ${recent.tooOld.length} older than ${maxItemAgeDays} day(s), ` +
      `${deduplicated.dropped.length} duplicate(s), ${split.known.length} already published, ` +
      `${split.fresh.length} new`,
  );

  if (feedErrors.length > 0) {
    logger.warn(`${feedErrors.length} source(s) failed, the run continues`);
  }

  return { collectedAt, items: split.fresh, feedErrors, activities };
};

const main = async (): Promise<void> => {
  const feeds = loadFeeds();
  const fetcher = createHttpSourceFetcher();
  const dayLabel = toIsoDayLabel(systemClock.now());

  logger.info(`collecting ${feeds.length} source(s) for ${dayLabel}`);

  const collection = await runCollect({
    feeds,
    readers: [createRssFeedReader(fetcher), createScrapeFeedReader(fetcher)],
    clock: systemClock,
    known: readKnownItems(),
    maxItemAgeDays: readIntegerEnv('VEILLE_MAX_ITEM_AGE_DAYS', DEFAULT_MAX_ITEM_AGE_DAYS),
  });

  const validated = rawCollectionSchema.safeParse(collection);

  if (!validated.success) {
    logger.error('collected data does not match its schema', validated.error);
    process.exitCode = 1;

    return;
  }

  const outputPath = buildRawCollectionPath(dayLabel);
  writeJsonFile(outputPath, validated.data);
  logger.info(`wrote ${collection.items.length} new item(s) to ${outputPath}`);
};

const entryPoint = process.argv[1];
const isDirectRun = entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href;

if (isDirectRun) {
  await main();
}

export { runCollect };
export type { CollectDependencies, RawCollection };
