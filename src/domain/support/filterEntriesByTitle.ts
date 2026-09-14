import type { FeedEntry } from '../entities/Feed';

/**
 * Keeps only the entries whose title matches a configured pattern.
 *
 * Some official feeds announce every platform the publisher ships. For a watch
 * scoped to phones, most of those entries are noise that would drown the
 * signal and spend the classification budget on releases nobody here will
 * install. Narrowing is a configuration choice, declared per feed and visible
 * in `config/feeds.yaml`, never a silent default.
 *
 * An unusable pattern keeps everything: a broken filter must not silently empty
 * a source.
 */
const filterEntriesByTitle = (
  entries: readonly FeedEntry[],
  titlePattern: string | undefined,
): FeedEntry[] => {
  if (titlePattern === undefined || titlePattern.trim().length === 0) {
    return [...entries];
  }

  let matcher: RegExp;

  try {
    matcher = new RegExp(titlePattern, 'i');
  } catch {
    return [...entries];
  }

  return entries.filter((entry) => matcher.test(entry.title));
};

export { filterEntriesByTitle };
