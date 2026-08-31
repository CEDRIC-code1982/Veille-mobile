import Anthropic from '@anthropic-ai/sdk';

import type { CollectedItem } from '../../domain/entities/CollectedItem';
import { ClassificationStatus } from '../../domain/ports/LlmClassifier';
import type {
  ClassificationOutcome,
  ClassificationRun,
  LlmClassifier,
  LlmUsage,
} from '../../domain/ports/LlmClassifier';
import { createLogger } from '../../shared/logger';
import { llmResponseSchema } from '../../shared/schemas/llm';
import { toClassificationProposal } from '../mappers/toClassificationProposal';
import { buildSystemPrompt } from './systemPrompt';

/**
 * Anthropic Messages API implementation of the classifier port.
 *
 * Two properties matter here, and both are about not trusting the answer:
 *
 * - it never throws. An API failure, an unparsable answer or a missing item all
 *   degrade into `FAILED` outcomes, which the classify stage turns into
 *   background/unverified items. A watch run must never die on the model.
 * - it validates before returning. Nothing reaches the domain without going
 *   through the wire schema first.
 *
 * The model id is pinned rather than aliased, so a scheduled run cannot change
 * behaviour silently. Effort is deliberately not sent: the fast tier does not
 * support it, and this task is structured extraction, not reasoning.
 */

const logger = createLogger(import.meta.url);

const DEFAULT_MAX_TOKENS = 8_000;

interface AnthropicClassifierOptions {
  apiKey: string;
  model: string;
  maxTokens?: number;
}

const EMPTY_USAGE: LlmUsage = { inputTokens: 0, outputTokens: 0 };

const addUsage = (left: LlmUsage, right: LlmUsage): LlmUsage => {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
  };
};

/** Only the fields the model needs; nothing about the local context leaks. */
const toPromptItem = (item: CollectedItem): Record<string, unknown> => {
  return {
    id: item.id,
    title: item.title,
    sourceName: item.sourceName,
    sourceUrl: item.sourceUrl,
    publishedAt: item.publishedAt,
    feedCategories: item.categories,
    excerpt: item.excerpt,
  };
};

const extractText = (message: Anthropic.Message): string => {
  const parts: string[] = [];

  for (const block of message.content) {
    if (block.type === 'text') {
      parts.push(block.text);
    }
  }

  return parts.join('\n').trim();
};

/**
 * Isolates the JSON object inside an answer, tolerating a markdown fence or a
 * stray sentence around it.
 */
const extractJsonObject = (text: string): string | undefined => {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');

  if (start < 0 || end <= start) {
    return undefined;
  }

  return text.slice(start, end + 1);
};

const buildFailedOutcomes = (
  items: readonly CollectedItem[],
  reason: string,
): ClassificationOutcome[] => {
  return items.map((item) => {
    return { itemId: item.id, status: ClassificationStatus.FAILED, reason };
  });
};

const createAnthropicLlmClassifier = (options: AnthropicClassifierOptions): LlmClassifier => {
  const client = new Anthropic({ apiKey: options.apiKey });
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const systemPrompt = buildSystemPrompt();

  /** Turns a validated answer into one outcome per requested item. */
  const toOutcomes = (
    items: readonly CollectedItem[],
    answer: string,
  ): ClassificationOutcome[] | undefined => {
    const jsonText = extractJsonObject(answer);

    if (jsonText === undefined) {
      return undefined;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return undefined;
    }

    const validated = llmResponseSchema.safeParse(parsed);

    if (!validated.success) {
      return undefined;
    }

    const proposalsById = new Map(validated.data.items.map((dto) => [dto.id, dto]));
    const outcomes: ClassificationOutcome[] = [];

    for (const item of items) {
      const dto = proposalsById.get(item.id);

      if (dto === undefined) {
        outcomes.push({
          itemId: item.id,
          status: ClassificationStatus.FAILED,
          reason: 'the model answered without this item',
        });
        continue;
      }

      outcomes.push({
        itemId: item.id,
        status: ClassificationStatus.CLASSIFIED,
        proposal: toClassificationProposal(dto),
      });
    }

    return outcomes;
  };

  const classifyBatch = async (items: readonly CollectedItem[]): Promise<ClassificationRun> => {
    if (items.length === 0) {
      return { outcomes: [], usage: EMPTY_USAGE };
    }

    const userContent = JSON.stringify({ items: items.map(toPromptItem) });
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userContent }];
    let usage = EMPTY_USAGE;

    try {
      const first = await client.messages.create({
        model: options.model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages,
      });

      usage = addUsage(usage, {
        inputTokens: first.usage.input_tokens,
        outputTokens: first.usage.output_tokens,
      });

      const firstAnswer = extractText(first);
      const firstOutcomes = toOutcomes(items, firstAnswer);

      if (firstOutcomes !== undefined) {
        return { outcomes: firstOutcomes, usage };
      }

      logger.warn(`unparsable answer for ${items.length} item(s), asking once for a correction`);

      const second = await client.messages.create({
        model: options.model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [
          ...messages,
          { role: 'assistant', content: firstAnswer.length > 0 ? firstAnswer : '(empty answer)' },
          {
            role: 'user',
            content:
              'That answer could not be parsed. Answer again with raw JSON only, matching the ' +
              'documented shape exactly: no markdown fence, no comment, no text around the JSON.',
          },
        ],
      });

      usage = addUsage(usage, {
        inputTokens: second.usage.input_tokens,
        outputTokens: second.usage.output_tokens,
      });

      const secondOutcomes = toOutcomes(items, extractText(second));

      if (secondOutcomes !== undefined) {
        return { outcomes: secondOutcomes, usage };
      }

      logger.warn(`correction also unparsable, ${items.length} item(s) degraded`);

      return {
        outcomes: buildFailedOutcomes(items, 'the model answer could not be parsed twice'),
        usage,
      };
    } catch (error) {
      logger.error(`the classification request failed for ${items.length} item(s)`, error);

      return {
        outcomes: buildFailedOutcomes(items, 'the classification request failed'),
        usage,
      };
    }
  };

  return { classifyBatch };
};

export { createAnthropicLlmClassifier, DEFAULT_MAX_TOKENS, extractJsonObject };
export type { AnthropicClassifierOptions };
