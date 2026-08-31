import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Every path the pipeline touches, resolved from this module's own location so
 * that a script behaves the same whatever the working directory is.
 */

const REPOSITORY_ROOT = resolve(fileURLToPath(import.meta.url), '../../..');

const PATHS = {
  root: REPOSITORY_ROOT,
  feedsConfig: join(REPOSITORY_ROOT, 'config', 'feeds.yaml'),
  officialDomainsConfig: join(REPOSITORY_ROOT, 'config', 'official-domains.json'),
  deadlinesConfig: join(REPOSITORY_ROOT, 'config', 'deadlines.json'),
  projectProfilesConfig: join(REPOSITORY_ROOT, 'config', 'project-profiles.json'),
  rawDirectory: join(REPOSITORY_ROOT, 'data', 'raw'),
  itemsDirectory: join(REPOSITORY_ROOT, 'data', 'items'),
  siteIndex: join(REPOSITORY_ROOT, 'data', 'index.json'),
  digestDirectory: join(REPOSITORY_ROOT, 'digest'),
} as const;

/** Path of the collect output for one day. */
const buildRawCollectionPath = (dayLabel: string): string => {
  return join(PATHS.rawDirectory, `${dayLabel}.json`);
};

const buildClassificationPath = (dayLabel: string): string => {
  return join(PATHS.rawDirectory, `${dayLabel}.classified.json`);
};

const buildVerificationPath = (dayLabel: string): string => {
  return join(PATHS.rawDirectory, `${dayLabel}.verified.json`);
};

const buildMonthItemsPath = (monthLabel: string): string => {
  return join(PATHS.itemsDirectory, `${monthLabel}.json`);
};

const buildDigestPath = (weekLabel: string): string => {
  return join(PATHS.digestDirectory, `${weekLabel}.md`);
};

export {
  buildClassificationPath,
  buildDigestPath,
  buildMonthItemsPath,
  buildRawCollectionPath,
  buildVerificationPath,
  PATHS,
  REPOSITORY_ROOT,
};
