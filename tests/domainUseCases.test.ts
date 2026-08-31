import { describe, expect, it } from 'vitest';

import { Category } from '../src/domain/entities/Category';
import type { ProjectProfile } from '../src/domain/entities/ProjectProfile';
import { Criticality, TrustLevel } from '../src/domain/entities/VeilleItem';
import type { ClassificationProposal } from '../src/domain/ports/LlmClassifier';
import { assignImpactedProjects } from '../src/domain/useCases/assignImpactedProjects';
import { buildDigest } from '../src/domain/useCases/buildDigest';
import { classifyItem } from '../src/domain/useCases/classifyItem';
import { deduplicateItems, rejectKnownItems } from '../src/domain/useCases/deduplicateItems';
import { detectStaleFeeds } from '../src/domain/useCases/detectStaleFeeds';
import { buildCollectedItem, buildFeed, buildVeilleItem } from './helpers/factories';

const buildProposal = (overrides: Partial<ClassificationProposal> = {}): ClassificationProposal => {
  return {
    summary: 'Un résumé reformulé en deux phrases. Rien de copié.',
    criticality: Criticality.IMPACTING,
    categories: [Category.ANDROID],
    tags: ['android', 'background'],
    ...overrides,
  };
};

describe('classifyItem', () => {
  it('always produces an unverified item, whatever the model proposed', () => {
    const item = classifyItem({
      item: buildCollectedItem(),
      proposal: buildProposal({ criticality: Criticality.BLOCKING }),
      profiles: [],
    });

    expect(item.trustLevel).toBe(TrustLevel.UNVERIFIED);
    expect(item.criticality).toBe(Criticality.BLOCKING);
  });

  it('carries the identifiers and source metadata from the collected item', () => {
    const collected = buildCollectedItem({ id: 'id-9', fingerprint: 'fp-9' });
    const item = classifyItem({ item: collected, proposal: buildProposal(), profiles: [] });

    expect(item.id).toBe('id-9');
    expect(item.fingerprint).toBe('fp-9');
    expect(item.sourceUrl).toBe(collected.sourceUrl);
    expect(item.publishedAt).toBe(collected.publishedAt);
  });

  it('collapses whitespace and caps the summary length', () => {
    const item = classifyItem({
      item: buildCollectedItem(),
      proposal: buildProposal({ summary: `  a  b  ${'x'.repeat(600)}  ` }),
      profiles: [],
    });

    expect(item.summary.startsWith('a b ')).toBe(true);
    expect(item.summary.length).toBeLessThanOrEqual(400);
  });

  it('normalises tags, drops duplicates and caps their number', () => {
    const item = classifyItem({
      item: buildCollectedItem(),
      proposal: buildProposal({
        tags: ['Background Modes', 'background-modes', 'BLE', '', 'a'.repeat(40), 'x1', 'x2', 'x3', 'x4'],
      }),
      profiles: [],
    });

    expect(item.tags).toContain('background-modes');
    expect(item.tags.filter((tag) => tag === 'background-modes')).toHaveLength(1);
    expect(item.tags.length).toBeLessThanOrEqual(6);
    expect(item.tags).not.toContain('');
  });

  it('drops unknown categories and falls back to the feed ones when nothing is usable', () => {
    const item = classifyItem({
      item: buildCollectedItem({ categories: [Category.IOS] }),
      proposal: buildProposal({ categories: [] }),
      profiles: [],
    });

    expect(item.categories).toEqual([Category.IOS]);
  });

  it('drops a deadline that is not a real calendar day', () => {
    const withBadFormat = classifyItem({
      item: buildCollectedItem(),
      proposal: buildProposal({ deadline: 'next spring' }),
      profiles: [],
    });
    const withImpossibleDay = classifyItem({
      item: buildCollectedItem(),
      proposal: buildProposal({ deadline: '2020-02-31' }),
      profiles: [],
    });

    expect(withBadFormat.deadline).toBeUndefined();
    expect(withImpossibleDay.deadline).toBeUndefined();
  });

  it('keeps a well-formed deadline', () => {
    const item = classifyItem({
      item: buildCollectedItem(),
      proposal: buildProposal({ deadline: '2020-06-30' }),
      profiles: [],
    });

    expect(item.deadline).toBe('2020-06-30');
  });

  it('omits an empty evidence quote instead of storing a blank one', () => {
    const item = classifyItem({
      item: buildCollectedItem(),
      proposal: buildProposal({ evidenceQuote: '   ' }),
      profiles: [],
    });

    expect(item.evidenceQuote).toBeUndefined();
    expect('evidenceQuote' in item).toBe(false);
  });

  it('caps the evidence quote, so no article paragraph is ever stored', () => {
    const item = classifyItem({
      item: buildCollectedItem(),
      proposal: buildProposal({ evidenceQuote: 'word '.repeat(200) }),
      profiles: [],
    });

    expect(item.evidenceQuote?.length).toBeLessThanOrEqual(300);
  });
});

describe('assignImpactedProjects', () => {
  const profiles: readonly ProjectProfile[] = [
    { code: 'proj-a', categories: [Category.ANDROID] },
    { code: 'proj-b', categories: [Category.IOS], tags: ['ble'] },
    { code: 'not-opaque', categories: [Category.ANDROID] },
  ];

  it('returns nothing when no profile is configured', () => {
    expect(assignImpactedProjects({ categories: [Category.ANDROID], tags: [], profiles: [] })).toEqual(
      [],
    );
  });

  it('matches on categories', () => {
    expect(
      assignImpactedProjects({ categories: [Category.ANDROID], tags: [], profiles }),
    ).toEqual(['proj-a']);
  });

  it('matches on tags too', () => {
    expect(assignImpactedProjects({ categories: [], tags: ['ble'], profiles })).toEqual(['proj-b']);
  });

  it('refuses a code that is not an opaque proj- code', () => {
    const codes = assignImpactedProjects({ categories: [Category.ANDROID], tags: [], profiles });

    expect(codes).not.toContain('not-opaque');
  });

  it('returns codes sorted and deduplicated', () => {
    const codes = assignImpactedProjects({
      categories: [Category.ANDROID, Category.IOS],
      tags: ['ble'],
      profiles,
    });

    expect(codes).toEqual(['proj-a', 'proj-b']);
  });
});

describe('deduplicateItems', () => {
  it('collapses two entries sharing the same URL identifier', () => {
    const result = deduplicateItems([
      buildCollectedItem({ id: 'id-1', fingerprint: 'fp-1' }),
      buildCollectedItem({ id: 'id-1', fingerprint: 'fp-2' }),
    ]);

    expect(result.kept).toHaveLength(1);
    expect(result.dropped).toHaveLength(1);
  });

  it('prefers the first-party source when one story is relayed twice', () => {
    const result = deduplicateItems([
      buildCollectedItem({
        id: 'id-blog',
        fingerprint: 'fp-shared',
        official: false,
        sourceName: 'Blog',
      }),
      buildCollectedItem({
        id: 'id-official',
        fingerprint: 'fp-shared',
        official: true,
        sourceName: 'Official',
      }),
    ]);

    expect(result.kept).toHaveLength(1);
    expect(result.kept[0]?.sourceName).toBe('Official');
  });

  it('falls back to the earliest publication when both are equally official', () => {
    const result = deduplicateItems([
      buildCollectedItem({
        id: 'id-late',
        fingerprint: 'fp-shared',
        publishedAt: '2020-01-05T00:00:00.000Z',
      }),
      buildCollectedItem({
        id: 'id-early',
        fingerprint: 'fp-shared',
        publishedAt: '2020-01-01T00:00:00.000Z',
      }),
    ]);

    expect(result.kept[0]?.id).toBe('id-early');
  });

  it('is order-independent, so a committed pipeline stays reproducible', () => {
    const items = [
      buildCollectedItem({ id: 'a', fingerprint: 'fp-a' }),
      buildCollectedItem({ id: 'b', fingerprint: 'fp-b', publishedAt: '2020-02-02T00:00:00.000Z' }),
      buildCollectedItem({ id: 'c', fingerprint: 'fp-a', official: false }),
    ];
    const forward = deduplicateItems(items).kept.map((item) => item.id);
    const backward = deduplicateItems([...items].reverse()).kept.map((item) => item.id);

    expect(forward).toEqual(backward);
  });

  it('returns the most recent items first', () => {
    const result = deduplicateItems([
      buildCollectedItem({ id: 'old', fingerprint: 'fp-1', publishedAt: '2020-01-01T00:00:00.000Z' }),
      buildCollectedItem({ id: 'new', fingerprint: 'fp-2', publishedAt: '2020-03-01T00:00:00.000Z' }),
    ]);

    expect(result.kept.map((item) => item.id)).toEqual(['new', 'old']);
  });
});

describe('rejectKnownItems', () => {
  it('separates never-seen items from already-published ones', () => {
    const result = rejectKnownItems(
      [
        buildCollectedItem({ id: 'known-id', fingerprint: 'fp-1' }),
        buildCollectedItem({ id: 'id-2', fingerprint: 'known-fp' }),
        buildCollectedItem({ id: 'id-3', fingerprint: 'fp-3' }),
      ],
      { ids: new Set(['known-id']), fingerprints: new Set(['known-fp']) },
    );

    expect(result.fresh.map((item) => item.id)).toEqual(['id-3']);
    expect(result.known).toHaveLength(2);
  });
});

describe('detectStaleFeeds', () => {
  const now = new Date('2020-03-01T00:00:00.000Z');

  it('reports a feed that has published nothing for longer than its threshold', () => {
    const result = detectStaleFeeds({
      feeds: [buildFeed({ name: 'Slow Feed', maxAgeDays: 10 })],
      activities: [{ feedName: 'Slow Feed', lastItemAt: '2020-01-01T00:00:00.000Z' }],
      now,
      pipelineSilenceDays: 14,
      lastPipelineItemAt: '2020-02-28T00:00:00.000Z',
    });

    expect(result.staleFeeds).toEqual([
      { feedName: 'Slow Feed', maxAgeDays: 10, daysSinceLastItem: 60 },
    ]);
  });

  it('leaves a feed alone while it stays inside its threshold', () => {
    const result = detectStaleFeeds({
      feeds: [buildFeed({ name: 'Live Feed', maxAgeDays: 30 })],
      activities: [{ feedName: 'Live Feed', lastItemAt: '2020-02-20T00:00:00.000Z' }],
      now,
      pipelineSilenceDays: 14,
      lastPipelineItemAt: '2020-02-28T00:00:00.000Z',
    });

    expect(result.staleFeeds).toEqual([]);
  });

  it('reports a feed with no recorded activity at all', () => {
    const result = detectStaleFeeds({
      feeds: [buildFeed({ name: 'Never Seen', maxAgeDays: 30 })],
      activities: [],
      now,
      pipelineSilenceDays: 14,
    });

    expect(result.staleFeeds).toEqual([{ feedName: 'Never Seen', maxAgeDays: 30 }]);
  });

  it('flags a silent pipeline when nothing was collected for too long', () => {
    const result = detectStaleFeeds({
      feeds: [],
      activities: [],
      now,
      pipelineSilenceDays: 14,
      lastPipelineItemAt: '2020-01-01T00:00:00.000Z',
    });

    expect(result.isPipelineSilent).toBe(true);
    expect(result.daysSinceLastPipelineItem).toBe(60);
  });

  it('treats a missing or unparsable last collection as silence', () => {
    expect(detectStaleFeeds({ feeds: [], activities: [], now, pipelineSilenceDays: 14 }).isPipelineSilent).toBe(
      true,
    );
    expect(
      detectStaleFeeds({
        feeds: [],
        activities: [],
        now,
        pipelineSilenceDays: 14,
        lastPipelineItemAt: 'not a date',
      }).isPipelineSilent,
    ).toBe(true);
  });

  it('stays quiet while the pipeline keeps collecting', () => {
    const result = detectStaleFeeds({
      feeds: [],
      activities: [],
      now,
      pipelineSilenceDays: 14,
      lastPipelineItemAt: '2020-02-27T00:00:00.000Z',
    });

    expect(result.isPipelineSilent).toBe(false);
  });
});

describe('buildDigest', () => {
  const generatedAt = '2020-03-01T06:00:00.000Z';

  it('renders the three criticality sections in order', () => {
    const digest = buildDigest({
      items: [
        buildVeilleItem({ id: '1', title: 'Fond', criticality: Criticality.BACKGROUND }),
        buildVeilleItem({ id: '2', title: 'Bloque', criticality: Criticality.BLOCKING }),
        buildVeilleItem({ id: '3', title: 'Impacte', criticality: Criticality.IMPACTING }),
      ],
      weekLabel: '2020-W09',
      generatedAt,
    });

    expect(digest.indexOf('## Bloquant')).toBeLessThan(digest.indexOf('## Impactant'));
    expect(digest.indexOf('## Impactant')).toBeLessThan(digest.indexOf('## Veille'));
    expect(digest.indexOf('### Bloque')).toBeLessThan(digest.indexOf('### Impacte'));
  });

  it('states the counts in the front matter and the introduction', () => {
    const digest = buildDigest({
      items: [
        buildVeilleItem({ id: '1', criticality: Criticality.BLOCKING }),
        buildVeilleItem({ id: '2', criticality: Criticality.BACKGROUND }),
      ],
      weekLabel: '2020-W09',
      generatedAt,
    });

    expect(digest).toContain('week: 2020-W09');
    expect(digest).toContain('items: 2');
    expect(digest).toContain('blocking: 1');
  });

  it('marks an empty section rather than omitting it', () => {
    const digest = buildDigest({ items: [], weekLabel: '2020-W09', generatedAt });

    expect(digest.match(/_Aucun item cette semaine\._/g)).toHaveLength(3);
  });

  it('omits the deadline, quote and project lines when the fields are absent', () => {
    const digest = buildDigest({
      items: [buildVeilleItem()],
      weekLabel: '2020-W09',
      generatedAt,
    });

    expect(digest).not.toContain('Échéance');
    expect(digest).not.toContain('Citation retrouvée');
    expect(digest).not.toContain('Projets concernés');
  });

  it('renders the deadline, the quote, the trust level and the project codes', () => {
    const digest = buildDigest({
      items: [
        buildVeilleItem({
          criticality: Criticality.BLOCKING,
          trustLevel: TrustLevel.VERIFIED,
          deadline: '2020-06-30',
          evidenceQuote: 'must declare the permission',
          impactedProjects: ['proj-a'],
        }),
      ],
      weekLabel: '2020-W09',
      generatedAt,
    });

    expect(digest).toContain('- Échéance : 2020-06-30');
    expect(digest).toContain('- Confiance : vérifié');
    expect(digest).toContain('« must declare the permission »');
    expect(digest).toContain('- Projets concernés : proj-a');
  });

  it('links the source without ever inlining article content', () => {
    const digest = buildDigest({
      items: [buildVeilleItem({ sourceName: 'Android Developers Blog' })],
      weekLabel: '2020-W09',
      generatedAt,
    });

    expect(digest).toContain('[Android Developers Blog](https://developer.android.com/example/page)');
  });
});
