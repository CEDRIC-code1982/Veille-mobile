import { XMLParser } from 'fast-xml-parser';

import type { FeedEntry } from '../../domain/entities/Feed';
import { stripHtml } from '../../domain/support/stripHtml';
import { truncateText } from '../../domain/support/normalizeText';
import { asArray, asRecord, asText, readAttribute, readChild } from './xmlAccess';

/**
 * RSS 2.0 and Atom parsing, tolerant by design.
 *
 * A feed that drifts from the specification is common; an entry missing a title
 * or a link is dropped rather than guessed, and the rest of the feed still goes
 * through.
 */

const MAX_EXCERPT_LENGTH = 1_500;
const ATTRIBUTE_PREFIX = '@_';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ATTRIBUTE_PREFIX,
  trimValues: true,
  processEntities: true,
  parseTagValue: false,
  parseAttributeValue: false,
});

/** Turns any HTML-bearing field into a bounded plain-text excerpt. */
const toExcerpt = (...candidates: Array<string | undefined>): string => {
  for (const candidate of candidates) {
    if (candidate === undefined) {
      continue;
    }

    const text = stripHtml(candidate).replace(/\s+/g, ' ').trim();

    if (text.length > 0) {
      return truncateText(text, MAX_EXCERPT_LENGTH);
    }
  }

  return '';
};

/** Picks the alternate link of an Atom entry, or the first usable one. */
const readAtomLink = (entry: Record<string, unknown>): string | undefined => {
  const links = asArray(readChild(entry, 'link'));
  let fallback: string | undefined;

  for (const link of links) {
    const href = readAttribute(link, `${ATTRIBUTE_PREFIX}href`);

    if (href === undefined) {
      continue;
    }

    const relation = readAttribute(link, `${ATTRIBUTE_PREFIX}rel`);

    if (relation === undefined || relation === 'alternate') {
      return href;
    }

    fallback ??= href;
  }

  return fallback ?? asText(readChild(entry, 'link'));
};

const readRssItems = (channel: Record<string, unknown>): FeedEntry[] => {
  const entries: FeedEntry[] = [];

  for (const rawItem of asArray(readChild(channel, 'item'))) {
    const item = asRecord(rawItem);

    if (item === undefined) {
      continue;
    }

    const title = asText(readChild(item, 'title'));
    const url = asText(readChild(item, 'link')) ?? asText(readChild(item, 'guid'));

    if (title === undefined || url === undefined) {
      continue;
    }

    const publishedAt = asText(readChild(item, 'pubDate')) ?? asText(readChild(item, 'dc:date'));

    entries.push({
      title,
      url,
      excerpt: toExcerpt(
        asText(readChild(item, 'content:encoded')),
        asText(readChild(item, 'description')),
      ),
      ...(publishedAt !== undefined ? { publishedAt } : {}),
    });
  }

  return entries;
};

const readAtomEntries = (feed: Record<string, unknown>): FeedEntry[] => {
  const entries: FeedEntry[] = [];

  for (const rawEntry of asArray(readChild(feed, 'entry'))) {
    const entry = asRecord(rawEntry);

    if (entry === undefined) {
      continue;
    }

    const title = asText(readChild(entry, 'title'));
    const url = readAtomLink(entry) ?? asText(readChild(entry, 'id'));

    if (title === undefined || url === undefined) {
      continue;
    }

    const publishedAt =
      asText(readChild(entry, 'published')) ?? asText(readChild(entry, 'updated'));

    entries.push({
      title,
      url,
      excerpt: toExcerpt(
        asText(readChild(entry, 'content')),
        asText(readChild(entry, 'summary')),
      ),
      ...(publishedAt !== undefined ? { publishedAt } : {}),
    });
  }

  return entries;
};

/**
 * Parses an RSS or Atom document. The shape is detected from the root element,
 * not from the configured type, so a feed declared `rss` that actually serves
 * Atom still works.
 */
const parseFeedXml = (xml: string): FeedEntry[] => {
  let parsed: unknown;

  try {
    parsed = parser.parse(xml);
  } catch {
    // A document too broken to parse yields no entry; the caller reports the
    // feed as mute rather than failing the run.
    return [];
  }

  const root = asRecord(parsed);

  if (root === undefined) {
    return [];
  }

  const rss = asRecord(readChild(root, 'rss'));
  const channel = asRecord(readChild(rss, 'channel'));

  if (channel !== undefined) {
    return readRssItems(channel);
  }

  const atomFeed = asRecord(readChild(root, 'feed'));

  if (atomFeed !== undefined) {
    return readAtomEntries(atomFeed);
  }

  const bareChannel = asRecord(readChild(root, 'channel'));

  if (bareChannel !== undefined) {
    return readRssItems(bareChannel);
  }

  return [];
};

export { MAX_EXCERPT_LENGTH, parseFeedXml };
