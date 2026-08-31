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

import { cpSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { ensureDirectory } from '../shared/jsonStore';
import { createLogger } from '../shared/logger';
import { PATHS } from '../shared/paths';

const logger = createLogger(import.meta.url);

const OUTPUT_DIRECTORY_NAME = 'dist-site';

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

  logger.info(`site assembled in ${output}`);

  return output;
};

buildSite();

export { buildSite, OUTPUT_DIRECTORY_NAME };
