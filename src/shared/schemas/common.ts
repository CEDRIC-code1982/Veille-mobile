import { z } from 'zod';

import { Category } from '../../domain/entities/Category';
import { FeedType } from '../../domain/entities/Feed';
import { Criticality, TrustLevel } from '../../domain/entities/VeilleItem';

/**
 * Building blocks shared by every schema.
 *
 * These schemas are the contract between the pipeline scripts and the static
 * site: anything the site reads is validated here before being written.
 */

const nonEmptyStringSchema = z.string().trim().min(1);

/** Any timestamp the runtime can parse; the pipeline always writes ISO 8601. */
const isoTimestampSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'expected a parsable ISO 8601 timestamp',
  });

const isoDaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected a YYYY-MM-DD day');

const isoMonthSchema = z.string().regex(/^\d{4}-\d{2}$/, 'expected a YYYY-MM month');

const isoWeekSchema = z.string().regex(/^\d{4}-W\d{2}$/, 'expected a YYYY-Wnn week');

/** Accepts only absolute http(s) URLs, checked with the standard parser. */
const httpUrlSchema = z.string().refine(
  (value) => {
    try {
      const url = new URL(value);

      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  },
  { message: 'expected an absolute http(s) URL' },
);

const categorySchema = z.enum(Category);
const criticalitySchema = z.enum(Criticality);
const trustLevelSchema = z.enum(TrustLevel);
const feedTypeSchema = z.enum(FeedType);

/** Opaque project codes only: a real project name must never be published. */
const projectCodeSchema = z
  .string()
  .regex(/^proj-[a-z0-9-]+$/, 'expected an opaque project code such as proj-a');

export {
  categorySchema,
  criticalitySchema,
  feedTypeSchema,
  httpUrlSchema,
  isoDaySchema,
  isoMonthSchema,
  isoTimestampSchema,
  isoWeekSchema,
  nonEmptyStringSchema,
  projectCodeSchema,
  trustLevelSchema,
};
