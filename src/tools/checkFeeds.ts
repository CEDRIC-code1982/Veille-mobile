/**
 * Checks every configured source with a real fetch.
 *
 * Run it after any change to `config/feeds.yaml`: a URL that does not answer
 * must be removed rather than replaced by a plausible guess. Pass `--strict` to
 * turn any unreachable or empty source into a non-zero exit code.
 */

import type { Feed } from '../domain/entities/Feed';
import type { FeedReader } from '../domain/ports/FeedReader';
import { createRssFeedReader } from '../data/feeds/RssFeedReader';
import { createScrapeFeedReader } from '../data/feeds/ScrapeFeedReader';
import { createHttpSourceFetcher } from '../data/feeds/httpClient';
import { toIsoTimestamp } from '../data/mappers/toCollectedItem';
import { loadFeeds } from '../shared/config';
import { createLogger } from '../shared/logger';

const logger = createLogger(import.meta.url);

const STRICT_FLAG = '--strict';

interface FeedCheck {
  feed: Feed;
  entryCount: number;
  newestPublishedAt?: string;
  failure?: string;
}

const pickReader = (readers: readonly FeedReader[], feed: Feed): FeedReader | undefined => {
  return readers.find((reader) => reader.supports(feed));
};

const findNewestPublishedAt = (dates: Array<string | undefined>): string | undefined => {
  let newest: string | undefined;

  for (const date of dates) {
    const iso = toIsoTimestamp(date);

    if (iso === undefined) {
      continue;
    }

    if (newest === undefined || iso > newest) {
      newest = iso;
    }
  }

  return newest;
};

const checkFeed = async (readers: readonly FeedReader[], feed: Feed): Promise<FeedCheck> => {
  const reader = pickReader(readers, feed);

  if (reader === undefined) {
    return { feed, entryCount: 0, failure: `no reader supports type ${feed.type}` };
  }

  try {
    const entries = await reader.read(feed);
    const newest = findNewestPublishedAt(entries.map((entry) => entry.publishedAt));

    return {
      feed,
      entryCount: entries.length,
      ...(newest !== undefined ? { newestPublishedAt: newest } : {}),
    };
  } catch (error) {
    return {
      feed,
      entryCount: 0,
      failure: error instanceof Error ? error.message : 'unknown failure',
    };
  }
};

const describeCheck = (check: FeedCheck): string => {
  const parts = [`${check.feed.name} [${check.feed.type}]`, `${check.entryCount} entry(ies)`];

  if (check.newestPublishedAt !== undefined) {
    parts.push(`newest ${check.newestPublishedAt}`);
  }

  return parts.join(', ');
};

const main = async (): Promise<void> => {
  const strict = process.argv.includes(STRICT_FLAG);
  const feeds = loadFeeds();
  const readers: readonly FeedReader[] = [
    createRssFeedReader(createHttpSourceFetcher()),
    createScrapeFeedReader(createHttpSourceFetcher()),
  ];

  logger.info(`checking ${feeds.length} configured source(s)`);

  const checks = await Promise.all(feeds.map((feed) => checkFeed(readers, feed)));
  let problems = 0;

  for (const check of checks) {
    if (check.failure !== undefined) {
      problems += 1;
      logger.warn(`UNREACHABLE ${check.feed.name} <${check.feed.url}>: ${check.failure}`);
      continue;
    }

    if (check.entryCount === 0) {
      problems += 1;
      logger.warn(`EMPTY ${check.feed.name} <${check.feed.url}>: answered but produced no entry`);
      continue;
    }

    logger.info(`OK ${describeCheck(check)}`);
  }

  if (problems === 0) {
    logger.info('every configured source answered with at least one entry');

    return;
  }

  logger.warn(`${problems} source(s) need attention before being committed`);

  if (strict) {
    process.exitCode = 1;
  }
};

await main();
