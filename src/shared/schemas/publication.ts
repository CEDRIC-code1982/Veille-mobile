import { z } from 'zod';

import {
  categorySchema,
  criticalitySchema,
  httpUrlSchema,
  isoDaySchema,
  isoMonthSchema,
  isoTimestampSchema,
  nonEmptyStringSchema,
  projectCodeSchema,
  trustLevelSchema,
} from './common';

/**
 * Schemas for everything that is committed and served to the site.
 *
 * This is the public contract: `site/app.js` reads exactly these shapes, so a
 * change here is a change to the site.
 */

const veilleItemSchema = z.strictObject({
  id: nonEmptyStringSchema,
  title: nonEmptyStringSchema,
  summary: z.string(),
  sourceUrl: httpUrlSchema,
  sourceName: nonEmptyStringSchema,
  publishedAt: isoTimestampSchema,
  collectedAt: isoTimestampSchema,
  criticality: criticalitySchema,
  trustLevel: trustLevelSchema,
  categories: z.array(categorySchema),
  tags: z.array(z.string()),
  impactedProjects: z.array(projectCodeSchema),
  fingerprint: nonEmptyStringSchema,
  evidenceQuote: z.string().optional(),
  deadline: isoDaySchema.optional(),
  verificationNote: z.string().optional(),
});

const monthFileSchema = z.strictObject({
  month: isoMonthSchema,
  updatedAt: isoTimestampSchema,
  items: z.array(veilleItemSchema),
});

const monthSummarySchema = z.strictObject({
  month: isoMonthSchema,
  itemCount: z.number().int().nonnegative(),
  blockingCount: z.number().int().nonnegative(),
});

const siteIndexSchema = z.strictObject({
  generatedAt: isoTimestampSchema,
  months: z.array(monthSummarySchema),
  counts: z.strictObject({
    total: z.number().int().nonnegative(),
    blocking: z.number().int().nonnegative(),
    impacting: z.number().int().nonnegative(),
    background: z.number().int().nonnegative(),
    unverified: z.number().int().nonnegative(),
  }),
  feedCount: z.number().int().nonnegative(),
  lastCollectedAt: isoTimestampSchema.optional(),
});

export { monthFileSchema, monthSummarySchema, siteIndexSchema, veilleItemSchema };
