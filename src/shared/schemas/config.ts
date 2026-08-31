import { z } from 'zod';

import {
  categorySchema,
  feedTypeSchema,
  httpUrlSchema,
  isoDaySchema,
  nonEmptyStringSchema,
  projectCodeSchema,
} from './common';

/**
 * Schemas for the hand-maintained configuration files.
 *
 * A malformed configuration must fail loudly and immediately: unlike a dead
 * feed, it is a bug, not an expected outcome.
 */

const feedSchema = z.strictObject({
  name: nonEmptyStringSchema,
  url: httpUrlSchema,
  type: feedTypeSchema,
  domain: nonEmptyStringSchema,
  categories: z.array(categorySchema).min(1),
  official: z.boolean(),
  maxAgeDays: z.number().int().positive(),
});

const feedsConfigSchema = z.strictObject({
  feeds: z.array(feedSchema).min(1),
});

const officialDomainSchema = z.strictObject({
  domain: nonEmptyStringSchema,
  pathPrefixes: z.array(nonEmptyStringSchema).optional(),
});

const officialDomainsSchema = z.strictObject({
  // Configuration files carry a _comment field explaining the contract to
  // whoever edits them by hand.
  _comment: z.string().optional(),
  domains: z.array(officialDomainSchema).min(1),
});

const deadlineSchema = z.strictObject({
  code: nonEmptyStringSchema,
  label: nonEmptyStringSchema,
  dueDate: isoDaySchema,
  categories: z.array(categorySchema),
  sourceUrl: httpUrlSchema,
  note: nonEmptyStringSchema.optional(),
});

const deadlinesSchema = z.strictObject({
  _comment: z.string().optional(),
  deadlines: z.array(deadlineSchema),
});

const projectProfileSchema = z.strictObject({
  code: projectCodeSchema,
  categories: z.array(categorySchema),
  tags: z.array(nonEmptyStringSchema).optional(),
});

const projectProfilesSchema = z.strictObject({
  _comment: z.string().optional(),
  profiles: z.array(projectProfileSchema),
});

export {
  deadlinesSchema,
  feedsConfigSchema,
  feedSchema,
  officialDomainsSchema,
  projectProfilesSchema,
};
