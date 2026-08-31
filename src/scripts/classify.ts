/**
 * Stage 2 of 4: classify.
 *
 * Asks the language model for a proposal on every collected item, and turns
 * that proposal into a typed item. This stage decides nothing about
 * publication: everything it produces carries `unverified` trust, and the
 * criticality it writes is only what was proposed. `verify` has the last word.
 *
 * Cost is bounded twice: `MAX_ITEMS_PER_RUN` caps how many items a single run
 * pays for, and items skipped for budget are simply collected again tomorrow.
 */

import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import type { CollectedItem } from '../domain/entities/CollectedItem';
import type { ProjectProfile } from '../domain/entities/ProjectProfile';
import { Criticality } from '../domain/entities/VeilleItem';
import type { VeilleItem } from '../domain/entities/VeilleItem';
import type { Clock } from '../domain/ports/Clock';
import { ClassificationStatus } from '../domain/ports/LlmClassifier';
import type { ClassificationRun, LlmClassifier, LlmUsage } from '../domain/ports/LlmClassifier';
import { classifyItem } from '../domain/useCases/classifyItem';
import { createAnthropicLlmClassifier } from '../data/llm/AnthropicLlmClassifier';
import { loadProjectProfiles } from '../shared/config';
import { readIntegerEnv, readOptionalEnv, readRequiredEnv } from '../shared/env';
import { readRequiredJsonFile, writeJsonFile } from '../shared/jsonStore';
import { createLogger } from '../shared/logger';
import { buildClassificationPath, buildRawCollectionPath } from '../shared/paths';
import { classificationFileSchema, rawCollectionSchema } from '../shared/schemas/pipeline';
import { systemClock } from '../shared/systemClock';
import { findNewestCollectedDay, resolveRequestedDay } from './pipelineDay';

const logger = createLogger(import.meta.url);

/**
 * Pinned model id, verified against the official model documentation rather
 * than guessed. The fast tier is the right one here: this is structured
 * extraction, not reasoning.
 */
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_MAX_ITEMS_PER_RUN = 60;
const DEFAULT_BATCH_SIZE = 10;

interface ClassificationFailure {
  itemId: string;
  reason: string;
}

interface ClassifyDependencies {
  items: readonly CollectedItem[];
  classifier: LlmClassifier;
  profiles: readonly ProjectProfile[];
  clock: Clock;
  model: string;
  maxItemsPerRun: number;
  batchSize: number;
}

interface ClassificationResult {
  classifiedAt: string;
  model: string;
  items: VeilleItem[];
  failures: ClassificationFailure[];
  skippedForBudget: number;
  usage: LlmUsage;
}

/**
 * Orders the items so that the budget is spent on what matters most: a
 * first-party source first, then the most recent publication.
 */
const prioritizeItems = (items: readonly CollectedItem[]): CollectedItem[] => {
  return [...items].sort((left, right) => {
    if (left.official !== right.official) {
      return left.official ? -1 : 1;
    }

    const byPublication = right.publishedAt.localeCompare(left.publishedAt);

    return byPublication !== 0 ? byPublication : left.id.localeCompare(right.id);
  });
};

const toBatches = <T>(items: readonly T[], batchSize: number): T[][] => {
  const batches: T[][] = [];
  const size = Math.max(1, batchSize);

  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }

  return batches;
};

/**
 * Item published when the model could not be used at all: background level,
 * unverified trust, no summary invented, and the reason recorded in plain sight.
 */
const toDegradedItem = (
  item: CollectedItem,
  reason: string,
  profiles: readonly ProjectProfile[],
): VeilleItem => {
  const degraded = classifyItem({
    item,
    proposal: {
      summary: '',
      criticality: Criticality.BACKGROUND,
      categories: [...item.categories],
      tags: [],
    },
    profiles,
  });

  return { ...degraded, verificationNote: `non classé : ${reason}` };
};

const runClassify = async (
  dependencies: ClassifyDependencies,
): Promise<ClassificationResult> => {
  const { classifier, profiles, clock, model, maxItemsPerRun, batchSize } = dependencies;
  const prioritized = prioritizeItems(dependencies.items);
  const selected = prioritized.slice(0, Math.max(0, maxItemsPerRun));
  const skippedForBudget = prioritized.length - selected.length;
  const itemsById = new Map(selected.map((item) => [item.id, item]));

  if (skippedForBudget > 0) {
    logger.info(`${skippedForBudget} item(s) left for a next run, budget capped at ${maxItemsPerRun}`);
  }

  const batches = toBatches(selected, batchSize);
  const items: VeilleItem[] = [];
  const failures: ClassificationFailure[] = [];
  let usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];

    if (batch === undefined || batch.length === 0) {
      continue;
    }

    logger.info(`classifying batch ${index + 1}/${batches.length}, ${batch.length} item(s)`);

    let run: ClassificationRun;

    try {
      run = await classifier.classifyBatch(batch);
    } catch (error) {
      // The port forbids throwing, so this is a defence in depth: a batch that
      // blows up degrades to background instead of killing the run.
      logger.error(`batch ${index + 1} threw instead of degrading`, error);
      run = {
        outcomes: batch.map((item) => {
          return {
            itemId: item.id,
            status: ClassificationStatus.FAILED,
            reason: 'the classifier threw an unexpected error',
          };
        }),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    usage = {
      inputTokens: usage.inputTokens + run.usage.inputTokens,
      outputTokens: usage.outputTokens + run.usage.outputTokens,
    };

    for (const outcome of run.outcomes) {
      const item = itemsById.get(outcome.itemId);

      if (item === undefined) {
        logger.warn(`the model answered about an unknown item, ignored`);
        continue;
      }

      if (outcome.status === ClassificationStatus.FAILED) {
        logger.warn(`item degraded to background: ${outcome.reason}`);
        failures.push({ itemId: outcome.itemId, reason: outcome.reason });
        items.push(toDegradedItem(item, outcome.reason, profiles));
        continue;
      }

      items.push(classifyItem({ item, proposal: outcome.proposal, profiles }));
    }
  }

  const proposedBlocking = items.filter(
    (item) => item.criticality === Criticality.BLOCKING,
  ).length;

  logger.info(
    `classified ${items.length} item(s), ${failures.length} degraded, ` +
      `${proposedBlocking} blocking proposal(s) awaiting verification`,
  );
  logger.info(
    `token usage for this run: ${usage.inputTokens} input, ${usage.outputTokens} output`,
  );

  return {
    classifiedAt: clock.now().toISOString(),
    model,
    items,
    failures,
    skippedForBudget,
    usage,
  };
};

const main = async (): Promise<void> => {
  const requestedDay = resolveRequestedDay(process.argv, systemClock);
  const dayLabel = existsSync(buildRawCollectionPath(requestedDay))
    ? requestedDay
    : findNewestCollectedDay();

  if (dayLabel === undefined) {
    logger.error(
      'no collect output to classify',
      new Error(`no file found for ${requestedDay} nor any earlier day`),
    );
    process.exitCode = 1;

    return;
  }

  if (dayLabel !== requestedDay) {
    logger.warn(`no collect output for ${requestedDay}, falling back to ${dayLabel}`);
  }

  const collection = readRequiredJsonFile(buildRawCollectionPath(dayLabel), rawCollectionSchema);
  const model = readOptionalEnv('ANTHROPIC_MODEL') ?? DEFAULT_MODEL;

  logger.info(`classifying ${collection.items.length} item(s) from ${dayLabel} with ${model}`);

  const result = await runClassify({
    items: collection.items,
    classifier: createAnthropicLlmClassifier({
      apiKey: readRequiredEnv('ANTHROPIC_API_KEY'),
      model,
    }),
    profiles: loadProjectProfiles(),
    clock: systemClock,
    model,
    maxItemsPerRun: readIntegerEnv('MAX_ITEMS_PER_RUN', DEFAULT_MAX_ITEMS_PER_RUN),
    batchSize: readIntegerEnv('VEILLE_LLM_BATCH_SIZE', DEFAULT_BATCH_SIZE),
  });

  const validated = classificationFileSchema.safeParse(result);

  if (!validated.success) {
    logger.error('classified data does not match its schema', validated.error);
    process.exitCode = 1;

    return;
  }

  const outputPath = buildClassificationPath(dayLabel);
  writeJsonFile(outputPath, validated.data);
  logger.info(`wrote ${result.items.length} classified item(s) to ${outputPath}`);
};

const entryPoint = process.argv[1];
const isDirectRun = entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href;

if (isDirectRun) {
  await main();
}

export { DEFAULT_MAX_ITEMS_PER_RUN, prioritizeItems, runClassify, toBatches };
export type { ClassificationResult, ClassifyDependencies };
