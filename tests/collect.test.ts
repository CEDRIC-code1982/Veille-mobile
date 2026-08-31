import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { Category } from '../src/domain/entities/Category';
import { FeedType } from '../src/domain/entities/Feed';
import type { FeedReader } from '../src/domain/ports/FeedReader';
import { filterRecentItems } from '../src/domain/useCases/filterRecentItems';
import { createRssFeedReader } from '../src/data/feeds/RssFeedReader';
import { createScrapeFeedReader } from '../src/data/feeds/ScrapeFeedReader';
import { runCollect } from '../src/scripts/collect';
import { buildCollectedItem, buildFeed } from './helpers/factories';
import { createFakeFetcher } from './helpers/fakeFetcher';

const FIXTURES_DIRECTORY = join(resolve(fileURLToPath(import.meta.url), '..'), 'fixtures');

const readFixture = (name: string): string => {
  return readFileSync(join(FIXTURES_DIRECTORY, name), 'utf8');
};

const RSS_URL = 'https://example.invalid/blog/feed.xml';
const ATOM_URL = 'https://example.invalid/atom.xml';
const SCRAPE_URL = 'https://example.invalid/behaviour';
const DEAD_URL = 'https://dead.invalid/feed.xml';

const NOW = new Date('2026-08-31T06:00:00.000Z');

/**
 * The fixture entries carry 2020 dates, so the recency window is opened wide
 * for the tests that only care about collection, and narrowed explicitly in the
 * tests that exercise the filter.
 */
const WIDE_AGE_WINDOW_DAYS = 40_000;

const buildReaders = (responses: Record<string, string>, failing: string[] = []): FeedReader[] => {
  const fetcher = createFakeFetcher({
    responses,
    failures: Object.fromEntries(
      failing.map((url) => [url, { status: 500, reason: 'HTTP 500' }]),
    ),
  });

  return [createRssFeedReader(fetcher), createScrapeFeedReader(fetcher)];
};

const emptyKnownItems = (): { ids: Set<string>; fingerprints: Set<string> } => {
  return { ids: new Set<string>(), fingerprints: new Set<string>() };
};

describe('filterRecentItems', () => {
  it('keeps an item inside the window and drops one outside it', () => {
    const result = filterRecentItems({
      items: [
        buildCollectedItem({ id: 'recent', publishedAt: '2026-08-25T00:00:00.000Z' }),
        buildCollectedItem({ id: 'ancient', publishedAt: '2020-01-01T00:00:00.000Z' }),
      ],
      now: NOW,
      maxAgeDays: 30,
    });

    expect(result.recent.map((item) => item.id)).toEqual(['recent']);
    expect(result.tooOld.map((item) => item.id)).toEqual(['ancient']);
  });

  it('keeps an item whose date cannot be parsed rather than losing it', () => {
    const result = filterRecentItems({
      items: [buildCollectedItem({ id: 'undated', publishedAt: 'whenever' })],
      now: NOW,
      maxAgeDays: 30,
    });

    expect(result.recent.map((item) => item.id)).toEqual(['undated']);
  });
});

describe('runCollect on local fixtures', () => {
  const rssFeed = buildFeed({ name: 'Fixture RSS', url: RSS_URL, type: FeedType.RSS });
  const atomFeed = buildFeed({
    name: 'Fixture Atom',
    url: ATOM_URL,
    type: FeedType.ATOM,
    categories: [Category.IOS],
  });
  const scrapeFeed = buildFeed({ name: 'Fixture Scrape', url: SCRAPE_URL, type: FeedType.SCRAPE });
  const deadFeed = buildFeed({ name: 'Dead Feed', url: DEAD_URL, type: FeedType.RSS });

  const responses = {
    [RSS_URL]: readFixture('rss-sample.xml'),
    [ATOM_URL]: readFixture('atom-sample.xml'),
    [SCRAPE_URL]: readFixture('scrape-sample.html'),
  };

  it('collects every source and normalises the items', async () => {
    const collection = await runCollect({
      feeds: [rssFeed, atomFeed, scrapeFeed],
      readers: buildReaders(responses),
      clock: { now: () => NOW },
      known: emptyKnownItems(),
      maxItemAgeDays: WIDE_AGE_WINDOW_DAYS,
    });

    expect(collection.collectedAt).toBe(NOW.toISOString());
    expect(collection.items).toHaveLength(6);
    expect(collection.feedErrors).toEqual([]);
  });

  it('carries the feed categories and source name onto each item', async () => {
    const collection = await runCollect({
      feeds: [atomFeed],
      readers: buildReaders(responses),
      clock: { now: () => NOW },
      known: emptyKnownItems(),
      maxItemAgeDays: WIDE_AGE_WINDOW_DAYS,
    });

    for (const item of collection.items) {
      expect(item.sourceName).toBe('Fixture Atom');
      expect(item.categories).toEqual([Category.IOS]);
    }
  });

  it('records a feed error for a dead source without failing the run', async () => {
    const collection = await runCollect({
      feeds: [rssFeed, deadFeed],
      readers: buildReaders(responses, [DEAD_URL]),
      clock: { now: () => NOW },
      known: emptyKnownItems(),
      maxItemAgeDays: WIDE_AGE_WINDOW_DAYS,
    });

    expect(collection.items).toHaveLength(3);
    expect(collection.feedErrors).toHaveLength(1);
    expect(collection.feedErrors[0]?.feedName).toBe('Dead Feed');
    expect(collection.feedErrors[0]?.reason).toContain('HTTP 500');
    expect(collection.feedErrors[0]?.occurredAt).toBe(NOW.toISOString());
  });

  it('records a feed error when no reader supports the configured type', async () => {
    const collection = await runCollect({
      feeds: [scrapeFeed],
      readers: [createRssFeedReader(createFakeFetcher({ responses }))],
      clock: { now: () => NOW },
      known: emptyKnownItems(),
      maxItemAgeDays: WIDE_AGE_WINDOW_DAYS,
    });

    expect(collection.feedErrors[0]?.reason).toContain('no reader supports type scrape');
  });

  it('reports the newest advertised entry as the activity of a feed', async () => {
    const collection = await runCollect({
      feeds: [atomFeed],
      readers: buildReaders(responses),
      clock: { now: () => NOW },
      known: emptyKnownItems(),
      maxItemAgeDays: WIDE_AGE_WINDOW_DAYS,
    });

    expect(collection.activities).toEqual([
      { feedName: 'Fixture Atom', lastItemAt: '2020-02-04T09:00:00.000Z' },
    ]);
  });

  it('reports the successful read as the activity of a scraped page', async () => {
    const collection = await runCollect({
      feeds: [scrapeFeed],
      readers: buildReaders(responses),
      clock: { now: () => NOW },
      known: emptyKnownItems(),
      maxItemAgeDays: WIDE_AGE_WINDOW_DAYS,
    });

    expect(collection.activities).toEqual([
      { feedName: 'Fixture Scrape', lastItemAt: NOW.toISOString() },
    ]);
  });

  it('reports no activity at all for a feed that answers with nothing', async () => {
    const emptyUrl = 'https://empty.invalid/feed.xml';
    const collection = await runCollect({
      feeds: [buildFeed({ name: 'Empty Feed', url: emptyUrl })],
      readers: buildReaders({ [emptyUrl]: '<rss><channel></channel></rss>' }),
      clock: { now: () => NOW },
      known: emptyKnownItems(),
      maxItemAgeDays: WIDE_AGE_WINDOW_DAYS,
    });

    expect(collection.activities).toEqual([{ feedName: 'Empty Feed' }]);
    expect(collection.items).toEqual([]);
  });

  it('drops items older than the configured window', async () => {
    const collection = await runCollect({
      feeds: [rssFeed, scrapeFeed],
      readers: buildReaders(responses),
      clock: { now: () => NOW },
      known: emptyKnownItems(),
      maxItemAgeDays: 30,
    });

    // Only the scraped page survives: it has no date of its own, so it is
    // stamped with the collection time.
    expect(collection.items).toHaveLength(1);
    expect(collection.items[0]?.sourceName).toBe('Fixture Scrape');
  });

  it('rejects an item that is already published', async () => {
    const first = await runCollect({
      feeds: [rssFeed],
      readers: buildReaders(responses),
      clock: { now: () => NOW },
      known: emptyKnownItems(),
      maxItemAgeDays: WIDE_AGE_WINDOW_DAYS,
    });
    const knownIds = new Set(first.items.map((item) => item.id));

    const second = await runCollect({
      feeds: [rssFeed],
      readers: buildReaders(responses),
      clock: { now: () => NOW },
      known: { ids: knownIds, fingerprints: new Set<string>() },
      maxItemAgeDays: WIDE_AGE_WINDOW_DAYS,
    });

    expect(second.items).toEqual([]);
  });

  it('collapses one story relayed by two different feeds', async () => {
    const collection = await runCollect({
      feeds: [
        buildFeed({ name: 'Official', url: RSS_URL, official: true }),
        buildFeed({ name: 'Relay', url: ATOM_URL, official: false }),
      ],
      readers: buildReaders({
        [RSS_URL]: readFixture('rss-sample.xml'),
        [ATOM_URL]: readFixture('rss-sample.xml'),
      }),
      clock: { now: () => NOW },
      known: emptyKnownItems(),
      maxItemAgeDays: WIDE_AGE_WINDOW_DAYS,
    });

    expect(collection.items).toHaveLength(3);
    for (const item of collection.items) {
      expect(item.sourceName).toBe('Official');
    }
  });

  it('produces a stable result whatever the order of the feeds', async () => {
    const forward = await runCollect({
      feeds: [rssFeed, atomFeed, scrapeFeed],
      readers: buildReaders(responses),
      clock: { now: () => NOW },
      known: emptyKnownItems(),
      maxItemAgeDays: WIDE_AGE_WINDOW_DAYS,
    });
    const backward = await runCollect({
      feeds: [scrapeFeed, atomFeed, rssFeed],
      readers: buildReaders(responses),
      clock: { now: () => NOW },
      known: emptyKnownItems(),
      maxItemAgeDays: WIDE_AGE_WINDOW_DAYS,
    });

    expect(forward.items.map((item) => item.id)).toEqual(backward.items.map((item) => item.id));
  });
});
