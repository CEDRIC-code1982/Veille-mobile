import { z } from 'zod';

import {
  categorySchema,
  httpUrlSchema,
  isoTimestampSchema,
  nonEmptyStringSchema,
} from './common';
import { veilleItemSchema } from './publication';

/**
 * Schemas for the files exchanged between the four pipeline stages.
 *
 * These files live under `data/raw/`, which is never versioned: they carry the
 * excerpts handed to the classifier, and third-party text has no place in the
 * repository.
 */

const collectedItemSchema = z.strictObject({
  id: nonEmptyStringSchema,
  title: nonEmptyStringSchema,
  sourceUrl: httpUrlSchema,
  sourceName: nonEmptyStringSchema,
  sourceDomain: nonEmptyStringSchema,
  official: z.boolean(),
  categories: z.array(categorySchema),
  publishedAt: isoTimestampSchema,
  collectedAt: isoTimestampSchema,
  excerpt: z.string(),
  fingerprint: nonEmptyStringSchema,
});

const feedErrorSchema = z.strictObject({
  feedName: nonEmptyStringSchema,
  feedUrl: z.string(),
  reason: nonEmptyStringSchema,
  occurredAt: isoTimestampSchema,
});

const feedActivitySchema = z.strictObject({
  feedName: nonEmptyStringSchema,
  lastItemAt: isoTimestampSchema.optional(),
});

const rawCollectionSchema = z.strictObject({
  collectedAt: isoTimestampSchema,
  items: z.array(collectedItemSchema),
  feedErrors: z.array(feedErrorSchema),
  activities: z.array(feedActivitySchema),
});

const classificationFailureSchema = z.strictObject({
  itemId: nonEmptyStringSchema,
  reason: nonEmptyStringSchema,
});

const llmUsageSchema = z.strictObject({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
});

const classificationFileSchema = z.strictObject({
  classifiedAt: isoTimestampSchema,
  model: nonEmptyStringSchema,
  items: z.array(veilleItemSchema),
  failures: z.array(classificationFailureSchema),
  skippedForBudget: z.number().int().nonnegative(),
  usage: llmUsageSchema,
});

const verificationNoteSchema = z.strictObject({
  itemId: nonEmptyStringSchema,
  reason: nonEmptyStringSchema,
});

const verificationFileSchema = z.strictObject({
  verifiedAt: isoTimestampSchema,
  items: z.array(veilleItemSchema),
  downgrades: z.array(verificationNoteSchema),
});

export {
  classificationFileSchema,
  collectedItemSchema,
  feedActivitySchema,
  feedErrorSchema,
  rawCollectionSchema,
  verificationFileSchema,
};
