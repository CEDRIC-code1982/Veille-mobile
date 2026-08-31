import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Category } from '../src/domain/entities/Category';
import { Criticality, TrustLevel } from '../src/domain/entities/VeilleItem';
import { ClassificationStatus } from '../src/domain/ports/LlmClassifier';
import type { ClassificationOutcome } from '../src/domain/ports/LlmClassifier';
import { buildClassificationRequest } from '../src/data/llm/buildClassificationRequest';
import { createFileProposalsClassifier } from '../src/data/llm/FileProposalsClassifier';
import { runClassify } from '../src/scripts/classify';
import { buildCollectedItem } from './helpers/factories';

/** Reads the reason of a failed outcome, narrowing the union first. */
const readFailureReason = (outcome: ClassificationOutcome | undefined): string => {
  return outcome !== undefined && outcome.status === ClassificationStatus.FAILED
    ? outcome.reason
    : '';
};

const NOW = new Date('2026-08-31T06:00:00.000Z');
const CLOCK = { now: (): Date => NOW };

describe('buildClassificationRequest', () => {
  const items = [
    buildCollectedItem({ id: 'id-1', title: 'Premier item' }),
    buildCollectedItem({ id: 'id-2', title: 'Second item', excerpt: 'Un extrait.' }),
  ];
  const request = buildClassificationRequest({
    dayLabel: '2026-08-31',
    items,
    proposalsPath: 'data/raw/2026-08-31.proposals.json',
  });

  it('names the file the routine has to write', () => {
    expect(request).toContain('data/raw/2026-08-31.proposals.json');
  });

  it('carries the same rules as the API path, so the two cannot drift', () => {
    expect(request).toContain('Never invent anything');
    expect(request).toContain('mandatory as soon as you propose "blocking"');
  });

  it('says explicitly that omitting an item is allowed and preferable to guessing', () => {
    expect(request).toContain('doit être omis du fichier');
    expect(request).toContain('Omettre vaut toujours mieux que deviner');
  });

  it('embeds the items as parsable JSON', () => {
    const payload = request.slice(request.indexOf('```json') + 7, request.lastIndexOf('```'));
    const parsed: unknown = JSON.parse(payload);

    expect(parsed).toEqual({
      items: [
        expect.objectContaining({ id: 'id-1', title: 'Premier item' }),
        expect.objectContaining({ id: 'id-2', excerpt: 'Un extrait.' }),
      ],
    });
  });

  it('hands the model nothing about the local context', () => {
    expect(request).not.toContain('impactedProjects');
    expect(request).not.toContain('proj-');
    expect(request).not.toContain('fingerprint');
  });
});

describe('createFileProposalsClassifier', () => {
  let directory = '';
  let proposalsPath = '';

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'veille-proposals-'));
    proposalsPath = join(directory, 'proposals.json');
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  const writeProposals = (content: string): void => {
    writeFileSync(proposalsPath, content, 'utf8');
  };

  it('accepts a well-formed proposals file', async () => {
    writeProposals(
      JSON.stringify({
        items: [
          {
            id: 'id-1',
            summary: 'Un résumé reformulé en deux phrases. Rien de copié.',
            criticality: Criticality.IMPACTING,
            categories: [Category.ANDROID],
            tags: ['android'],
          },
        ],
      }),
    );

    const run = await createFileProposalsClassifier(proposalsPath).classifyBatch([
      buildCollectedItem({ id: 'id-1' }),
    ]);

    expect(run.outcomes[0]?.status).toBe(ClassificationStatus.CLASSIFIED);
    expect(run.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('degrades an item the routine said nothing about', async () => {
    writeProposals(JSON.stringify({ items: [] }));

    const run = await createFileProposalsClassifier(proposalsPath).classifyBatch([
      buildCollectedItem({ id: 'id-1' }),
    ]);

    expect(run.outcomes[0]).toEqual({
      itemId: 'id-1',
      status: ClassificationStatus.FAILED,
      reason: 'the proposals file says nothing about this item',
    });
  });

  it('degrades everything when the file is missing', async () => {
    const run = await createFileProposalsClassifier(join(directory, 'absent.json')).classifyBatch([
      buildCollectedItem({ id: 'id-1' }),
    ]);

    expect(run.outcomes[0]?.status).toBe(ClassificationStatus.FAILED);
  });

  it('degrades everything when the file is not valid JSON', async () => {
    writeProposals('{ not json');

    const run = await createFileProposalsClassifier(proposalsPath).classifyBatch([
      buildCollectedItem({ id: 'id-1' }),
    ]);

    expect(readFailureReason(run.outcomes[0])).toContain('not valid JSON');
  });

  it('degrades everything when the file does not match the schema', async () => {
    writeProposals(JSON.stringify({ items: [{ id: 'id-1', criticality: 'urgent' }] }));

    const run = await createFileProposalsClassifier(proposalsPath).classifyBatch([
      buildCollectedItem({ id: 'id-1' }),
    ]);

    expect(readFailureReason(run.outcomes[0])).toContain('does not match the schema');
  });

  it('gives the routine no more credit than the API: a blocking proposal stays unverified', async () => {
    writeProposals(
      JSON.stringify({
        items: [
          {
            id: 'id-1',
            summary: 'La routine prétend que c’est bloquant.',
            criticality: Criticality.BLOCKING,
            categories: [Category.ANDROID],
            tags: [],
            evidenceQuote: 'apps must declare the permission',
          },
        ],
      }),
    );

    const result = await runClassify({
      items: [buildCollectedItem({ id: 'id-1' })],
      classifier: createFileProposalsClassifier(proposalsPath),
      profiles: [],
      clock: CLOCK,
      model: 'scheduled-routine',
      maxItemsPerRun: 60,
      batchSize: 10,
    });

    expect(result.items[0]?.criticality).toBe(Criticality.BLOCKING);
    expect(result.items[0]?.trustLevel).toBe(TrustLevel.UNVERIFIED);
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('drops an unknown category proposed by the routine', async () => {
    writeProposals(
      JSON.stringify({
        items: [
          {
            id: 'id-1',
            summary: 'Résumé.',
            criticality: Criticality.BACKGROUND,
            categories: ['android', 'inventée'],
            tags: [],
          },
        ],
      }),
    );

    const result = await runClassify({
      items: [buildCollectedItem({ id: 'id-1' })],
      classifier: createFileProposalsClassifier(proposalsPath),
      profiles: [],
      clock: CLOCK,
      model: 'scheduled-routine',
      maxItemsPerRun: 60,
      batchSize: 10,
    });

    expect(result.items[0]?.categories).toEqual([Category.ANDROID]);
  });
});
