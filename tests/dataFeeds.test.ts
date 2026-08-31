import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { FeedType } from '../src/domain/entities/Feed';
import type { FeedEntry } from '../src/domain/entities/Feed';
import { createRssFeedReader } from '../src/data/feeds/RssFeedReader';
import { createScrapeFeedReader, extractTitle } from '../src/data/feeds/ScrapeFeedReader';
import { parseFeedXml } from '../src/data/feeds/parseFeedXml';
import { toCollectedItem, toIsoTimestamp } from '../src/data/mappers/toCollectedItem';
import { buildFeed } from './helpers/factories';
import { createFakeFetcher } from './helpers/fakeFetcher';

const FIXTURES_DIRECTORY = join(resolve(fileURLToPath(import.meta.url), '..'), 'fixtures');

const readFixture = (name: string): string => {
  return readFileSync(join(FIXTURES_DIRECTORY, name), 'utf8');
};

const RSS_XML = readFixture('rss-sample.xml');
const ATOM_XML = readFixture('atom-sample.xml');
const SCRAPE_HTML = readFixture('scrape-sample.html');

describe('parseFeedXml on RSS', () => {
  const entries = parseFeedXml(RSS_XML);

  it('keeps only the entries carrying both a title and a link', () => {
    expect(entries).toHaveLength(4);
    expect(entries.map((entry) => entry.title)).toEqual([
      'First   synthetic entry',
      'Second synthetic entry',
      'Entry whose guid is not fetchable',
      'Entry whose guid is a permalink',
    ]);
  });

  it('falls back to the guid when no link element is present', () => {
    expect(entries[2]?.url).toBe('tag:example.invalid,2020:missing');
    expect(entries[3]?.url).toBe('https://example.invalid/blog/permalink');
  });

  it('decodes entities and strips HTML out of the excerpt', () => {
    expect(entries[0]?.excerpt).toBe('Short & sweet description.');
  });

  it('prefers full content over the description, and drops scripts', () => {
    expect(entries[1]?.excerpt).toBe('Full content here.');
  });

  it('keeps the raw publication date for the mapper to normalise', () => {
    expect(entries[0]?.publishedAt).toBe('Thu, 02 Jan 2020 10:00:00 GMT');
  });
});

describe('parseFeedXml on Atom', () => {
  const entries = parseFeedXml(ATOM_XML);

  it('reads every entry', () => {
    expect(entries).toHaveLength(2);
  });

  it('prefers the alternate link over the other relations', () => {
    expect(entries[0]?.url).toBe('https://example.invalid/atom/1');
  });

  it('prefers published over updated when both are present', () => {
    expect(entries[0]?.publishedAt).toBe('2020-02-02T08:30:00Z');
  });

  it('falls back to updated when there is no published date', () => {
    expect(entries[1]?.publishedAt).toBe('2020-02-04T09:00:00Z');
  });

  it('prefers content over summary for the excerpt', () => {
    expect(entries[1]?.excerpt).toBe('Atom content wins over summary.');
  });
});

describe('parseFeedXml on unusable input', () => {
  it('returns no entry for a broken document instead of throwing', () => {
    expect(parseFeedXml(readFixture('malformed.xml'))).toEqual([]);
  });

  it('returns no entry for a document that is not a feed at all', () => {
    expect(parseFeedXml('<html><body>not a feed</body></html>')).toEqual([]);
    expect(parseFeedXml('')).toEqual([]);
  });
});

describe('createRssFeedReader', () => {
  const feed = buildFeed({ url: 'https://example.invalid/feed.xml' });

  it('supports rss and atom, not scrape', () => {
    const reader = createRssFeedReader(createFakeFetcher());

    expect(reader.supports(buildFeed({ type: FeedType.RSS }))).toBe(true);
    expect(reader.supports(buildFeed({ type: FeedType.ATOM }))).toBe(true);
    expect(reader.supports(buildFeed({ type: FeedType.SCRAPE }))).toBe(false);
  });

  it('reads and parses the fetched document', async () => {
    const reader = createRssFeedReader(
      createFakeFetcher({ responses: { [feed.url]: RSS_XML } }),
    );

    await expect(reader.read(feed)).resolves.toHaveLength(4);
  });

  it('rejects when the source cannot be fetched, so the caller can record it', async () => {
    const reader = createRssFeedReader(
      createFakeFetcher({ failures: { [feed.url]: { status: 500, reason: 'HTTP 500' } } }),
    );

    await expect(reader.read(feed)).rejects.toThrow('HTTP 500');
  });
});

describe('createScrapeFeedReader', () => {
  const feed = buildFeed({ type: FeedType.SCRAPE, url: 'https://example.invalid/behaviour' });

  const readPage = async (html: string): Promise<FeedEntry | undefined> => {
    const reader = createScrapeFeedReader(createFakeFetcher({ responses: { [feed.url]: html } }));
    const entries = await reader.read(feed);

    return entries[0];
  };

  it('produces a single entry titled from the page heading', async () => {
    const entry = await readPage(SCRAPE_HTML);

    expect(entry?.title).toBe('Behaviour changes for the fixture level');
  });

  it('keeps the main region only, dropping navigation, script and footer', async () => {
    const entry = await readPage(SCRAPE_HTML);

    expect(entry?.excerpt).toContain('must declare the synthetic permission');
    expect(entry?.excerpt).not.toContain('Navigation noise');
    expect(entry?.excerpt).not.toContain('Footer noise');
    expect(entry?.excerpt).not.toContain('ignored');
  });

  it('gives the same content hash for the same page read twice', async () => {
    const first = await readPage(SCRAPE_HTML);
    const second = await readPage(SCRAPE_HTML);

    expect(first?.contentHash).toBe(second?.contentHash);
    expect(first?.contentHash).toBeTruthy();
  });

  it('ignores a change outside the main region', async () => {
    const reference = await readPage(SCRAPE_HTML);
    const withOtherNavigation = await readPage(
      SCRAPE_HTML.replace('Navigation noise, changes often, must not count.', 'Totally new menu'),
    );

    expect(withOtherNavigation?.contentHash).toBe(reference?.contentHash);
  });

  it('changes the content hash when the main region changes', async () => {
    const reference = await readPage(SCRAPE_HTML);
    const changed = await readPage(
      SCRAPE_HTML.replace('must declare the synthetic permission', 'must request runtime consent'),
    );

    expect(changed?.contentHash).not.toBe(reference?.contentHash);
  });

  it('rejects a page with no readable content', async () => {
    const reader = createScrapeFeedReader(
      createFakeFetcher({ responses: { [feed.url]: '<html><body></body></html>' } }),
    );

    await expect(reader.read(feed)).rejects.toThrow('no readable content');
  });
});

describe('extractTitle', () => {
  it('keeps only the first line of a heading, dropping the widgets buried in it', () => {
    const html =
      '<h1>Android Studio release notes<div>Stay organized with collections</div>' +
      '<div>Save and categorize content based on your preferences.</div></h1>';

    expect(extractTitle(html, 'fallback')).toBe('Android Studio release notes');
  });

  it('falls back to the document title and drops the site name suffix', () => {
    const html = '<title>Android Releases | Platform | Android Developers</title><body></body>';

    expect(extractTitle(html, 'fallback')).toBe('Android Releases');
  });

  it('handles a dash separator in a document title', () => {
    const html = '<title>Changelog \u2014 Expo</title>';

    expect(extractTitle(html, 'fallback')).toBe('Changelog');
  });

  it('caps an unreasonably long heading', () => {
    const html = `<h1>${'word '.repeat(100)}</h1>`;

    expect(extractTitle(html, 'fallback').length).toBeLessThanOrEqual(160);
  });

  it('falls back to the feed name when the page carries no title at all', () => {
    expect(extractTitle('<body><p>text</p></body>', 'Feed Name')).toBe('Feed Name');
  });
});

describe('toIsoTimestamp', () => {
  it('normalises an RFC 822 feed date', () => {
    expect(toIsoTimestamp('Thu, 02 Jan 2020 10:00:00 GMT')).toBe('2020-01-02T10:00:00.000Z');
  });

  it('returns nothing for an unusable date', () => {
    expect(toIsoTimestamp('whenever')).toBeUndefined();
    expect(toIsoTimestamp(undefined)).toBeUndefined();
  });
});

describe('toCollectedItem', () => {
  const feed = buildFeed({ url: 'https://example.invalid/blog/feed.xml', official: true });
  const collectedAt = '2020-01-10T00:00:00.000Z';

  it('resolves a relative entry link against the feed URL', () => {
    const item = toCollectedItem(
      feed,
      { title: 'Relative link', url: '/blog/second', excerpt: '' },
      collectedAt,
    );

    expect(item?.sourceUrl).toBe('https://example.invalid/blog/second');
    expect(item?.sourceDomain).toBe('example.invalid');
  });

  it('drops tracking parameters from the stored URL', () => {
    const item = toCollectedItem(
      feed,
      { title: 'Tracked', url: 'https://example.invalid/a?utm_source=rss', excerpt: '' },
      collectedAt,
    );

    expect(item?.sourceUrl).toBe('https://example.invalid/a');
  });

  it('falls back to the collection time when the entry carries no date', () => {
    const item = toCollectedItem(feed, { title: 'Undated', url: '/x', excerpt: '' }, collectedAt);

    expect(item?.publishedAt).toBe(collectedAt);
  });

  it('returns nothing rather than inventing an item when the URL is unusable', () => {
    expect(
      toCollectedItem(feed, { title: 'Bad scheme', url: 'javascript:void(0)', excerpt: '' }, collectedAt),
    ).toBeUndefined();
    expect(toCollectedItem(feed, { title: '   ', url: '/x', excerpt: '' }, collectedAt)).toBeUndefined();
  });

  it('gives the same identifier to two spellings of the same URL', () => {
    const first = toCollectedItem(
      feed,
      { title: 'Same', url: 'https://example.invalid/page/', excerpt: '' },
      collectedAt,
    );
    const second = toCollectedItem(
      feed,
      { title: 'Same', url: 'https://example.invalid/page?utm_medium=rss', excerpt: '' },
      collectedAt,
    );

    expect(first?.id).toBe(second?.id);
  });

  it('gives the same fingerprint to one story relayed by two feeds', () => {
    const fromOfficial = toCollectedItem(
      buildFeed({ name: 'Official', url: 'https://example.invalid/a.xml' }),
      { title: 'Shared story', url: 'https://example.invalid/official', excerpt: '', publishedAt: '2020-01-02T08:00:00Z' },
      collectedAt,
    );
    const fromBlog = toCollectedItem(
      buildFeed({ name: 'Blog', url: 'https://other.invalid/b.xml', official: false }),
      { title: 'shared   story', url: 'https://other.invalid/relay', excerpt: '', publishedAt: '2020-01-02T22:00:00Z' },
      collectedAt,
    );

    expect(fromOfficial?.fingerprint).toBe(fromBlog?.fingerprint);
    expect(fromOfficial?.id).not.toBe(fromBlog?.id);
  });

  it('bases identity on the content hash when the entry is a scraped page', () => {
    const entry = { title: 'Doc page', url: 'https://example.invalid/doc', excerpt: '' };
    const first = toCollectedItem(feed, { ...entry, contentHash: 'hash-one' }, collectedAt);
    const second = toCollectedItem(feed, { ...entry, contentHash: 'hash-two' }, collectedAt);
    const sameAgain = toCollectedItem(feed, { ...entry, contentHash: 'hash-one' }, '2020-05-05T00:00:00.000Z');

    expect(first?.id).not.toBe(second?.id);
    expect(first?.fingerprint).not.toBe(second?.fingerprint);
    expect(sameAgain?.id).toBe(first?.id);
  });

  it('caps the excerpt length, so no article is stored whole', () => {
    const item = toCollectedItem(
      feed,
      { title: 'Long', url: '/long', excerpt: 'word '.repeat(2000) },
      collectedAt,
    );

    expect(item?.excerpt.length).toBeLessThanOrEqual(1500);
  });
});
