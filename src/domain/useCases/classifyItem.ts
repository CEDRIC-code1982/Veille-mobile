import { isCategory } from '../entities/Category';
import type { Category } from '../entities/Category';
import type { CollectedItem } from '../entities/CollectedItem';
import type { ProjectProfile } from '../entities/ProjectProfile';
import { TrustLevel } from '../entities/VeilleItem';
import type { VeilleItem } from '../entities/VeilleItem';
import type { ClassificationProposal } from '../ports/LlmClassifier';
import { normalizeText, truncateText } from '../support/normalizeText';
import { assignImpactedProjects } from './assignImpactedProjects';

/**
 * Turns a collected item plus a model proposal into a publishable item.
 *
 * This use case never decides publication: it produces an item whose trust
 * level is always `unverified`, and the criticality it carries is only the one
 * proposed. `verifyEvidence` has the last word.
 *
 * Everything coming from the model is bounded here: summary length, quote
 * length, tag shape and count, category validity, deadline format. A field the
 * model could not fill correctly is dropped rather than guessed.
 */

const MAX_SUMMARY_LENGTH = 400;
const MAX_QUOTE_LENGTH = 300;
const MAX_TAGS = 6;
const MAX_TAG_LENGTH = 32;
const ISO_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

interface ClassifyItemInput {
  item: CollectedItem;
  proposal: ClassificationProposal;
  profiles: readonly ProjectProfile[];
}

/** Collapses whitespace and caps the length of a free-text field. */
const sanitizeText = (text: string, maxLength: number): string => {
  return truncateText(text.replace(/\s+/g, ' ').trim(), maxLength);
};

/** Lower-cases tags, turns spaces into hyphens, drops duplicates and noise. */
const sanitizeTags = (tags: readonly string[]): string[] => {
  const sanitized: string[] = [];

  for (const rawTag of tags) {
    const tag = normalizeText(rawTag)
      .replace(/[^a-z0-9+#. -]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-|-$/g, '');

    if (tag.length === 0 || tag.length > MAX_TAG_LENGTH || sanitized.includes(tag)) {
      continue;
    }

    sanitized.push(tag);

    if (sanitized.length === MAX_TAGS) {
      break;
    }
  }

  return sanitized;
};

/**
 * Keeps the categories the model proposed that actually exist, falling back to
 * the ones declared on the feed when nothing usable comes back.
 */
const sanitizeCategories = (
  proposed: readonly string[],
  fallback: readonly Category[],
): Category[] => {
  const categories: Category[] = [];

  for (const candidate of proposed) {
    if (isCategory(candidate) && !categories.includes(candidate)) {
      categories.push(candidate);
    }
  }

  return categories.length > 0 ? categories : [...fallback];
};

/** Accepts a deadline only when it is a real calendar day in `YYYY-MM-DD`. */
const sanitizeDeadline = (deadline: string | undefined): string | undefined => {
  if (deadline === undefined) {
    return undefined;
  }

  const trimmed = deadline.trim();

  if (!ISO_DAY_PATTERN.test(trimmed)) {
    return undefined;
  }

  const parsed = new Date(`${trimmed}T00:00:00Z`);

  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== trimmed) {
    return undefined;
  }

  return trimmed;
};

const sanitizeQuote = (quote: string | undefined): string | undefined => {
  if (quote === undefined) {
    return undefined;
  }

  const sanitized = sanitizeText(quote, MAX_QUOTE_LENGTH);

  return sanitized.length > 0 ? sanitized : undefined;
};

const classifyItem = (input: ClassifyItemInput): VeilleItem => {
  const { item, proposal } = input;
  const categories = sanitizeCategories(proposal.categories, item.categories);
  const tags = sanitizeTags(proposal.tags);
  const evidenceQuote = sanitizeQuote(proposal.evidenceQuote);
  const deadline = sanitizeDeadline(proposal.deadline);

  return {
    id: item.id,
    title: sanitizeText(item.title, MAX_SUMMARY_LENGTH),
    summary: sanitizeText(proposal.summary, MAX_SUMMARY_LENGTH),
    sourceUrl: item.sourceUrl,
    sourceName: item.sourceName,
    publishedAt: item.publishedAt,
    collectedAt: item.collectedAt,
    criticality: proposal.criticality,
    trustLevel: TrustLevel.UNVERIFIED,
    categories,
    tags,
    impactedProjects: assignImpactedProjects({ categories, tags, profiles: input.profiles }),
    fingerprint: item.fingerprint,
    ...(evidenceQuote !== undefined ? { evidenceQuote } : {}),
    ...(deadline !== undefined ? { deadline } : {}),
  };
};

export { classifyItem, MAX_QUOTE_LENGTH, MAX_SUMMARY_LENGTH, MAX_TAGS };
export type { ClassifyItemInput };
