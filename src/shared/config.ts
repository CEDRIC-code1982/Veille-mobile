import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

import type { Deadline } from '../domain/entities/Deadline';
import type { Feed } from '../domain/entities/Feed';
import type { OfficialDomain } from '../domain/entities/OfficialDomain';
import type { ProjectProfile } from '../domain/entities/ProjectProfile';
import { readOptionalJsonFile, readRequiredJsonFile } from './jsonStore';
import { PATHS } from './paths';
import {
  deadlinesSchema,
  feedsConfigSchema,
  officialDomainsSchema,
  projectProfilesSchema,
} from './schemas/config';

/**
 * Loads the hand-maintained configuration.
 *
 * A malformed configuration throws: unlike a dead feed, it is a bug and the run
 * must stop rather than silently watch fewer sources.
 */

const loadFeeds = (filePath: string = PATHS.feedsConfig): Feed[] => {
  const raw: unknown = parseYaml(readFileSync(filePath, 'utf8'));
  const result = feedsConfigSchema.safeParse(raw);

  if (!result.success) {
    throw new Error(`invalid feed configuration in ${filePath}: ${result.error.message}`);
  }

  return result.data.feeds;
};

const loadOfficialDomains = (filePath: string = PATHS.officialDomainsConfig): OfficialDomain[] => {
  return readRequiredJsonFile(filePath, officialDomainsSchema).domains;
};

const loadDeadlines = (filePath: string = PATHS.deadlinesConfig): Deadline[] => {
  return readOptionalJsonFile(filePath, deadlinesSchema)?.deadlines ?? [];
};

const loadProjectProfiles = (filePath: string = PATHS.projectProfilesConfig): ProjectProfile[] => {
  return readOptionalJsonFile(filePath, projectProfilesSchema)?.profiles ?? [];
};

export { loadDeadlines, loadFeeds, loadOfficialDomains, loadProjectProfiles };
