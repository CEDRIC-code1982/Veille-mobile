/**
 * Assembles the deployable site into `dist-site/`.
 *
 * The site itself has no build step: this only copies `site/` next to the JSON
 * files it reads, because GitHub Pages serves a single directory and the data
 * lives outside `site/`. Nothing is transpiled, minified or bundled.
 *
 * The same output is used by the local preview and by the deploy workflow, so
 * what is checked locally is what goes online.
 */

import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';

import { computeStableHash } from '../shared/hash';
import { ensureDirectory } from '../shared/jsonStore';
import { createLogger } from '../shared/logger';
import { PATHS } from '../shared/paths';

const logger = createLogger(import.meta.url);

const OUTPUT_DIRECTORY_NAME = 'dist-site';
const CACHE_VERSION_PLACEHOLDER = '__CACHE_VERSION__';
const SERVICE_WORKER_NAME = 'sw.js';

/** Every file of a directory tree, sorted, so the hash is reproducible. */
const listFilesRecursively = (directory: string): string[] => {
  const files: string[] = [];

  for (const entry of readdirSync(directory).sort()) {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      files.push(...listFilesRecursively(path));
      continue;
    }

    files.push(path);
  }

  return files;
};

/**
 * Stamps the service worker with a version derived from the assembled files.
 *
 * A browser only installs a new worker when the bytes of its script change, so
 * a frozen cache name would keep serving the precached shell forever and the
 * site would silently stop updating.
 */
const stampCacheVersion = (output: string): string => {
  const serviceWorkerPath = join(output, SERVICE_WORKER_NAME);

  if (!existsSync(serviceWorkerPath)) {
    logger.warn('no service worker in the output, nothing to stamp');

    return 'unstamped';
  }

  const parts: string[] = [];

  for (const file of listFilesRecursively(output)) {
    if (file === serviceWorkerPath) {
      continue;
    }

    parts.push(`${relative(output, file)}:${readFileSync(file).toString('base64')}`);
  }

  const version = computeStableHash(parts.join('|'), 12);
  const source = readFileSync(serviceWorkerPath, 'utf8');
  writeFileSync(serviceWorkerPath, source.split(CACHE_VERSION_PLACEHOLDER).join(version), 'utf8');

  return version;
};

const buildSite = (): string => {
  const output = join(PATHS.root, OUTPUT_DIRECTORY_NAME);

  rmSync(output, { recursive: true, force: true });
  ensureDirectory(output);

  cpSync(join(PATHS.root, 'site'), output, { recursive: true });
  logger.info('copied site/ into the output directory');

  const dataOutput = join(output, 'data');
  ensureDirectory(dataOutput);

  if (existsSync(PATHS.siteIndex)) {
    cpSync(PATHS.siteIndex, join(dataOutput, 'index.json'));
    logger.info('copied data/index.json');
  } else {
    logger.warn('no data/index.json yet, the site will show its empty state');
  }

  if (existsSync(PATHS.itemsDirectory)) {
    cpSync(PATHS.itemsDirectory, join(dataOutput, 'items'), { recursive: true });
    logger.info('copied data/items/');
  } else {
    logger.warn('no data/items/ yet, the site will show its empty state');
  }

  logger.info(`service worker stamped with cache version ${stampCacheVersion(output)}`);
  logger.info(`site assembled in ${output}`);

  return output;
};

buildSite();

export { buildSite, OUTPUT_DIRECTORY_NAME };
