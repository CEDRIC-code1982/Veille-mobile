import { describe, expect, it } from 'vitest';

import { Category } from '../src/domain/entities/Category';
import type { CollectedItem } from '../src/domain/entities/CollectedItem';
import { Criticality, TrustLevel } from '../src/domain/entities/VeilleItem';
import { ClassificationStatus } from '../src/domain/ports/LlmClassifier';
import type {
  ClassificationProposal,
  ClassificationRun,
  LlmClassifier,
} from '../src/domain/ports/LlmClassifier';
import { extractJsonObject } from '../src/data/llm/AnthropicLlmClassifier';
import { buildSystemPrompt } from '../src/data/llm/systemPrompt';
import { toClassificationProposal } from '../src/data/mappers/toClassificationProposal';
import { prioritizeItems, runClassify, toBatches } from '../src/scripts/classify';
import { buildCollectedItem } from './helpers/factories';

const NOW = new Date('2026-08-31T06:00:00.000Z');
const CLOCK = { now: (): Date => NOW };

interface FakeClassifierOptions {
  proposalFor?: (item: CollectedItem) => ClassificationProposal | undefined;
  throwOnBatch?: number;
  inputTokensPerBatch?: number;
  outputTokensPerBatch?: number;
}

interface FakeClassifier extends LlmClassifier {
  seenBatches: CollectedItem[][];
}

const defaultProposal = (): ClassificationProposal => {
  return {
    summary: 'Un résumé reformulé.',
    criticality: Criticality.IMPACTING,
    categories: [Category.ANDROID],
    tags: ['android'],
  };
};

const createFakeClassifier = (options: FakeClassifierOptions = {}): FakeClassifier => {
  const seenBatches: CollectedItem[][] = [];

  return {
    seenBatches,
    classifyBatch: (items: readonly CollectedItem[]): Promise<ClassificationRun> => {
      seenBatches.push([...items]);

      if (options.throwOnBatch === seenBatches.length) {
        throw new Error('simulated transport explosion');
      }

      const proposalFor = options.proposalFor ?? defaultProposal;

      return Promise.resolve({
        outcomes: items.map((item) => {
          const proposal = proposalFor(item);

          if (proposal === undefined) {
            return {
              itemId: item.id,
              status: ClassificationStatus.FAILED,
              reason: 'simulated parse failure',
            };
          }

          return { itemId: item.id, status: ClassificationStatus.CLASSIFIED, proposal };
        }),
        usage: {
          inputTokens: options.inputTokensPerBatch ?? 100,
          outputTokens: options.outputTokensPerBatch ?? 20,
        },
      });
    },
  };
};

const buildItems = (count: number): CollectedItem[] => {
  const items: CollectedItem[] = [];

  for (let index = 0; index < count; index += 1) {
    items.push(
      buildCollectedItem({
        id: `id-${String(index).padStart(3, '0')}`,
        fingerprint: `fp-${index}`,
        title: `Item ${index}`,
      }),
    );
  }

  return items;
};

describe('toBatches', () => {
  it('splits a list into batches of the requested size', () => {
    expect(toBatches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('never produces a zero-sized batch, whatever the requested size', () => {
    expect(toBatches([1, 2], 0)).toEqual([[1], [2]]);
    expect(toBatches([], 10)).toEqual([]);
  });
});

describe('prioritizeItems', () => {
  it('puts first-party sources before third-party ones', () => {
    const ordered = prioritizeItems([
      buildCollectedItem({ id: 'blog', official: false }),
      buildCollectedItem({ id: 'official', official: true }),
    ]);

    expect(ordered.map((item) => item.id)).toEqual(['official', 'blog']);
  });

  it('puts the most recent publication first within the same tier', () => {
    const ordered = prioritizeItems([
      buildCollectedItem({ id: 'old', publishedAt: '2026-01-01T00:00:00.000Z' }),
      buildCollectedItem({ id: 'new', publishedAt: '2026-08-01T00:00:00.000Z' }),
    ]);

    expect(ordered.map((item) => item.id)).toEqual(['new', 'old']);
  });
});

describe('runClassify', () => {
  it('never publishes a verified item, whatever the model proposed', async () => {
    const result = await runClassify({
      items: buildItems(3),
      classifier: createFakeClassifier({
        proposalFor: () => ({ ...defaultProposal(), criticality: Criticality.BLOCKING }),
      }),
      profiles: [],
      clock: CLOCK,
      model: 'test-model',
      maxItemsPerRun: 60,
      batchSize: 10,
    });

    expect(result.items).toHaveLength(3);
    for (const item of result.items) {
      expect(item.trustLevel).toBe(TrustLevel.UNVERIFIED);
      expect(item.criticality).toBe(Criticality.BLOCKING);
    }
  });

  it('respects the batch size', async () => {
    const classifier = createFakeClassifier();
    await runClassify({
      items: buildItems(7),
      classifier,
      profiles: [],
      clock: CLOCK,
      model: 'test-model',
      maxItemsPerRun: 60,
      batchSize: 3,
    });

    expect(classifier.seenBatches.map((batch) => batch.length)).toEqual([3, 3, 1]);
  });

  it('caps the number of items paid for and reports what was left out', async () => {
    const classifier = createFakeClassifier();
    const result = await runClassify({
      items: buildItems(25),
      classifier,
      profiles: [],
      clock: CLOCK,
      model: 'test-model',
      maxItemsPerRun: 10,
      batchSize: 10,
    });

    expect(result.items).toHaveLength(10);
    expect(result.skippedForBudget).toBe(15);
    expect(classifier.seenBatches).toHaveLength(1);
  });

  it('sums the token usage across every batch', async () => {
    const result = await runClassify({
      items: buildItems(5),
      classifier: createFakeClassifier({ inputTokensPerBatch: 50, outputTokensPerBatch: 7 }),
      profiles: [],
      clock: CLOCK,
      model: 'test-model',
      maxItemsPerRun: 60,
      batchSize: 2,
    });

    expect(result.usage).toEqual({ inputTokens: 150, outputTokens: 21 });
  });

  it('degrades a failed item to background and unverified instead of dropping it', async () => {
    const result = await runClassify({
      items: buildItems(2),
      classifier: createFakeClassifier({
        proposalFor: (item) => (item.id === 'id-000' ? undefined : defaultProposal()),
      }),
      profiles: [],
      clock: CLOCK,
      model: 'test-model',
      maxItemsPerRun: 60,
      batchSize: 10,
    });

    const degraded = result.items.find((item) => item.id === 'id-000');

    expect(result.items).toHaveLength(2);
    expect(degraded?.criticality).toBe(Criticality.BACKGROUND);
    expect(degraded?.trustLevel).toBe(TrustLevel.UNVERIFIED);
    expect(degraded?.summary).toBe('');
    expect(degraded?.verificationNote).toContain('simulated parse failure');
    expect(result.failures).toEqual([{ itemId: 'id-000', reason: 'simulated parse failure' }]);
  });

  it('survives a classifier that throws, degrading that batch only', async () => {
    const result = await runClassify({
      items: buildItems(4),
      classifier: createFakeClassifier({ throwOnBatch: 1 }),
      profiles: [],
      clock: CLOCK,
      model: 'test-model',
      maxItemsPerRun: 60,
      batchSize: 2,
    });

    expect(result.items).toHaveLength(4);
    expect(result.failures).toHaveLength(2);
    expect(result.items.filter((item) => item.criticality === Criticality.BACKGROUND)).toHaveLength(2);
  });

  it('stamps the run with the injected clock and the model actually used', async () => {
    const result = await runClassify({
      items: buildItems(1),
      classifier: createFakeClassifier(),
      profiles: [],
      clock: CLOCK,
      model: 'pinned-model-id',
      maxItemsPerRun: 60,
      batchSize: 10,
    });

    expect(result.classifiedAt).toBe(NOW.toISOString());
    expect(result.model).toBe('pinned-model-id');
  });

  it('attaches opaque project codes from the committed profiles', async () => {
    const result = await runClassify({
      items: buildItems(1),
      classifier: createFakeClassifier(),
      profiles: [{ code: 'proj-a', categories: [Category.ANDROID] }],
      clock: CLOCK,
      model: 'test-model',
      maxItemsPerRun: 60,
      batchSize: 10,
    });

    expect(result.items[0]?.impactedProjects).toEqual(['proj-a']);
  });

  it('does nothing at all when there is nothing to classify', async () => {
    const classifier = createFakeClassifier();
    const result = await runClassify({
      items: [],
      classifier,
      profiles: [],
      clock: CLOCK,
      model: 'test-model',
      maxItemsPerRun: 60,
      batchSize: 10,
    });

    expect(result.items).toEqual([]);
    expect(classifier.seenBatches).toEqual([]);
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});

describe('toClassificationProposal', () => {
  it('keeps only the categories that actually exist', () => {
    const proposal = toClassificationProposal({
      id: 'x',
      summary: 'Résumé.',
      criticality: Criticality.IMPACTING,
      categories: ['android', 'not-a-category', 'ios', 'android'],
      tags: ['a'],
    });

    expect(proposal.categories).toEqual([Category.ANDROID, Category.IOS]);
  });

  it('omits a blank quote or deadline rather than storing an empty string', () => {
    const proposal = toClassificationProposal({
      id: 'x',
      summary: 'Résumé.',
      criticality: Criticality.IMPACTING,
      categories: [],
      tags: [],
      evidenceQuote: '   ',
      deadline: '',
    });

    expect(proposal.evidenceQuote).toBeUndefined();
    expect(proposal.deadline).toBeUndefined();
  });
});

describe('extractJsonObject', () => {
  it('finds the object inside a markdown fence', () => {
    expect(extractJsonObject('```json\n{"items":[]}\n```')).toBe('{"items":[]}');
  });

  it('finds the object despite surrounding prose', () => {
    expect(extractJsonObject('Sure! {"items":[]} hope this helps')).toBe('{"items":[]}');
  });

  it('returns nothing when there is no object at all', () => {
    expect(extractJsonObject('no json here')).toBeUndefined();
    expect(extractJsonObject('}{')).toBeUndefined();
  });
});

describe('buildSystemPrompt', () => {
  const prompt = buildSystemPrompt();

  it('forbids inventing anything, as the first rule', () => {
    expect(prompt).toContain('Never invent anything');
    expect(prompt.indexOf('Never invent anything')).toBeLessThan(prompt.indexOf('"summary" is'));
  });

  it('requires a French summary of at most two sentences, reformulated', () => {
    expect(prompt).toContain('written in French, two sentences maximum');
    expect(prompt).toContain('Never copy a sentence of the excerpt into the summary');
  });

  it('makes the evidence quote mandatory for a blocking proposal', () => {
    expect(prompt).toContain('mandatory as soon as you propose "blocking"');
    expect(prompt).toContain('copied verbatim');
  });

  it('lists the closed category list, so no category can be invented', () => {
    expect(prompt).toContain('react-native');
    expect(prompt).toContain('closed list');
  });
});
