import { isCategory } from '../../domain/entities/Category';
import type { Category } from '../../domain/entities/Category';
import type { ClassificationProposal } from '../../domain/ports/LlmClassifier';
import type { LlmProposalDto } from '../../shared/schemas/llm';

/**
 * Turns a validated model answer into a domain proposal.
 *
 * Free-text fields stay strings in the wire schema on purpose: an unknown
 * category is dropped here rather than failing the whole batch.
 */

const toKnownCategories = (candidates: readonly string[]): Category[] => {
  const categories: Category[] = [];

  for (const candidate of candidates) {
    if (isCategory(candidate) && !categories.includes(candidate)) {
      categories.push(candidate);
    }
  }

  return categories;
};

const toClassificationProposal = (dto: LlmProposalDto): ClassificationProposal => {
  const evidenceQuote = dto.evidenceQuote?.trim();
  const deadline = dto.deadline?.trim();

  return {
    summary: dto.summary,
    criticality: dto.criticality,
    categories: toKnownCategories(dto.categories),
    tags: dto.tags,
    ...(evidenceQuote !== undefined && evidenceQuote.length > 0 ? { evidenceQuote } : {}),
    ...(deadline !== undefined && deadline.length > 0 ? { deadline } : {}),
  };
};

export { toClassificationProposal, toKnownCategories };
