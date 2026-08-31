import { existsSync, readFileSync } from 'node:fs';

import type { CollectedItem } from '../../domain/entities/CollectedItem';
import { ClassificationStatus } from '../../domain/ports/LlmClassifier';
import type {
  ClassificationOutcome,
  ClassificationRun,
  LlmClassifier,
} from '../../domain/ports/LlmClassifier';
import { createLogger } from '../../shared/logger';
import { llmResponseSchema } from '../../shared/schemas/llm';
import { toClassificationProposal } from '../mappers/toClassificationProposal';

/**
 * Classifier backed by a proposals file written by the scheduled routine.
 *
 * The file is treated exactly like an API answer: validated by the same Zod
 * schema, and anything missing or malformed degrades into a `FAILED` outcome
 * rather than being trusted. The routine gets no more credit than the API would.
 *
 * Token usage is reported as zero because no API call is billed on this path.
 */

const logger = createLogger(import.meta.url);

const NO_USAGE = { inputTokens: 0, outputTokens: 0 };

const buildFailedOutcomes = (
  items: readonly CollectedItem[],
  reason: string,
): ClassificationOutcome[] => {
  return items.map((item) => {
    return { itemId: item.id, status: ClassificationStatus.FAILED, reason };
  });
};

const createFileProposalsClassifier = (filePath: string): LlmClassifier => {
  const classifyBatch = (items: readonly CollectedItem[]): Promise<ClassificationRun> => {
    if (items.length === 0) {
      return Promise.resolve({ outcomes: [], usage: NO_USAGE });
    }

    if (!existsSync(filePath)) {
      logger.warn(`no proposals file at ${filePath}, every item is degraded`);

      return Promise.resolve({
        outcomes: buildFailedOutcomes(items, 'no proposals file was produced'),
        usage: NO_USAGE,
      });
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    } catch (error) {
      logger.error(`the proposals file is not valid JSON`, error);

      return Promise.resolve({
        outcomes: buildFailedOutcomes(items, 'the proposals file is not valid JSON'),
        usage: NO_USAGE,
      });
    }

    const validated = llmResponseSchema.safeParse(parsed);

    if (!validated.success) {
      logger.warn(`the proposals file does not match the schema, every item is degraded`);

      return Promise.resolve({
        outcomes: buildFailedOutcomes(items, 'the proposals file does not match the schema'),
        usage: NO_USAGE,
      });
    }

    const proposalsById = new Map(validated.data.items.map((dto) => [dto.id, dto]));
    const outcomes: ClassificationOutcome[] = [];

    for (const item of items) {
      const dto = proposalsById.get(item.id);

      if (dto === undefined) {
        outcomes.push({
          itemId: item.id,
          status: ClassificationStatus.FAILED,
          reason: 'the proposals file says nothing about this item',
        });
        continue;
      }

      outcomes.push({
        itemId: item.id,
        status: ClassificationStatus.CLASSIFIED,
        proposal: toClassificationProposal(dto),
      });
    }

    return Promise.resolve({ outcomes, usage: NO_USAGE });
  };

  return { classifyBatch };
};

export { createFileProposalsClassifier };
