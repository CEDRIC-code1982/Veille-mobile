import { describe, expect, it } from 'vitest';

import { Criticality, TrustLevel } from '../src/domain/entities/VeilleItem';
import type { VeilleItem } from '../src/domain/entities/VeilleItem';
import { buildNotifications } from '../src/domain/useCases/buildNotifications';
import { buildKnownItems } from '../src/data/publishedItems';
import { resolveMonth, runPublish } from '../src/scripts/publish';
import { buildFeed, buildVeilleItem } from './helpers/factories';

const NOW = new Date('2026-08-31T06:00:00.000Z');
const CLOCK = { now: (): Date => NOW };
const CURRENT_WEEK = '2026-W36';

const buildPublishInput = (
  overrides: Partial<Parameters<typeof runPublish>[0]> = {},
): Parameters<typeof runPublish>[0] => {
  return {
    verifiedItems: [],
    existingItems: [],
    feeds: [],
    activities: [],
    clock: CLOCK,
    pipelineSilenceDays: 14,
    ...overrides,
  };
};

const buildRecentItem = (overrides: Partial<VeilleItem> = {}): VeilleItem => {
  return buildVeilleItem({
    publishedAt: '2026-08-31T05:00:00.000Z',
    collectedAt: '2026-08-31T06:00:00.000Z',
    ...overrides,
  });
};

describe('buildKnownItems', () => {
  it('remembers an item that carries a summary', () => {
    const known = buildKnownItems([
      buildVeilleItem({ id: 'classified', fingerprint: 'fp-1', summary: 'Un résumé.' }),
    ]);

    expect(known.ids.has('classified')).toBe(true);
    expect(known.fingerprints.has('fp-1')).toBe(true);
  });

  it('forgets an item published without a summary, so it gets another chance', () => {
    const known = buildKnownItems([
      buildVeilleItem({ id: 'degraded', fingerprint: 'fp-2', summary: '' }),
      buildVeilleItem({ id: 'blank', fingerprint: 'fp-3', summary: '   ' }),
    ]);

    expect(known.ids.size).toBe(0);
    expect(known.fingerprints.size).toBe(0);
  });
});

describe('resolveMonth', () => {
  it('uses the publication month', () => {
    expect(resolveMonth(buildVeilleItem({ publishedAt: '2026-03-15T00:00:00.000Z' }))).toBe(
      '2026-03',
    );
  });

  it('falls back to the collection month when the publication date is unusable', () => {
    expect(
      resolveMonth(
        buildVeilleItem({ publishedAt: 'not a date', collectedAt: '2026-04-02T00:00:00.000Z' }),
      ),
    ).toBe('2026-04');
  });
});

describe('runPublish, month files', () => {
  it('writes only the months touched by the new items', () => {
    const plan = runPublish(
      buildPublishInput({
        existingItems: [
          buildVeilleItem({ id: 'old', fingerprint: 'fp-old', publishedAt: '2026-01-05T00:00:00.000Z' }),
        ],
        verifiedItems: [buildRecentItem({ id: 'new', fingerprint: 'fp-new' })],
      }),
    );

    expect(plan.months.map((month) => month.month)).toEqual(['2026-08']);
    expect(plan.addedCount).toBe(1);
  });

  it('merges new items into the month file that already exists', () => {
    const plan = runPublish(
      buildPublishInput({
        existingItems: [
          buildRecentItem({ id: 'first', fingerprint: 'fp-1', publishedAt: '2026-08-02T00:00:00.000Z' }),
        ],
        verifiedItems: [buildRecentItem({ id: 'second', fingerprint: 'fp-2' })],
      }),
    );

    expect(plan.months[0]?.items.map((item) => item.id)).toEqual(['second', 'first']);
  });

  it('lets a freshly verified item replace its stored version', () => {
    const plan = runPublish(
      buildPublishInput({
        existingItems: [
          buildRecentItem({ id: 'same', criticality: Criticality.BLOCKING, trustLevel: TrustLevel.UNVERIFIED }),
        ],
        verifiedItems: [
          buildRecentItem({ id: 'same', criticality: Criticality.IMPACTING, trustLevel: TrustLevel.REPORTED }),
        ],
      }),
    );

    expect(plan.months[0]?.items).toHaveLength(1);
    expect(plan.months[0]?.items[0]?.criticality).toBe(Criticality.IMPACTING);
    expect(plan.addedCount).toBe(0);
  });

  it('sorts a month file most recent first, so a rerun rewrites nothing', () => {
    const plan = runPublish(
      buildPublishInput({
        verifiedItems: [
          buildRecentItem({ id: 'b', publishedAt: '2026-08-10T00:00:00.000Z' }),
          buildRecentItem({ id: 'a', publishedAt: '2026-08-20T00:00:00.000Z' }),
          buildRecentItem({ id: 'c', publishedAt: '2026-08-10T00:00:00.000Z' }),
        ],
      }),
    );

    expect(plan.months[0]?.items.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('runPublish, site index', () => {
  it('counts every stored item by criticality and trust', () => {
    const plan = runPublish(
      buildPublishInput({
        verifiedItems: [
          buildRecentItem({ id: '1', criticality: Criticality.BLOCKING, trustLevel: TrustLevel.VERIFIED }),
          buildRecentItem({ id: '2', criticality: Criticality.IMPACTING, trustLevel: TrustLevel.REPORTED }),
          buildRecentItem({ id: '3', criticality: Criticality.BACKGROUND, trustLevel: TrustLevel.UNVERIFIED }),
          buildRecentItem({ id: '4', criticality: Criticality.BACKGROUND, trustLevel: TrustLevel.UNVERIFIED }),
        ],
        feeds: [buildFeed({ name: 'One' }), buildFeed({ name: 'Two' })],
      }),
    );

    expect(plan.index.counts).toEqual({
      total: 4,
      blocking: 1,
      impacting: 1,
      background: 2,
      unverified: 2,
    });
    expect(plan.index.feedCount).toBe(2);
  });

  it('lists every month present, not only the touched ones', () => {
    const plan = runPublish(
      buildPublishInput({
        existingItems: [buildVeilleItem({ id: 'old', publishedAt: '2026-01-05T00:00:00.000Z' })],
        verifiedItems: [buildRecentItem({ id: 'new' })],
      }),
    );

    expect(plan.index.months.map((month) => month.month)).toEqual(['2026-01', '2026-08']);
  });

  it('reports the most recent collection time', () => {
    const plan = runPublish(
      buildPublishInput({
        verifiedItems: [
          buildRecentItem({ id: '1', collectedAt: '2026-08-30T00:00:00.000Z' }),
          buildRecentItem({ id: '2', collectedAt: '2026-08-31T06:00:00.000Z' }),
        ],
      }),
    );

    expect(plan.index.lastCollectedAt).toBe('2026-08-31T06:00:00.000Z');
  });
});

describe('runPublish, weekly digest', () => {
  it('names the digest after the current ISO week', () => {
    const plan = runPublish(buildPublishInput());

    expect(plan.digest.weekLabel).toBe(CURRENT_WEEK);
    expect(plan.digest.content).toContain(`# Veille mobile — ${CURRENT_WEEK}`);
  });

  it('keeps only the items published during that week', () => {
    const plan = runPublish(
      buildPublishInput({
        verifiedItems: [
          buildRecentItem({ id: 'thisweek', title: 'Cette semaine' }),
          buildRecentItem({
            id: 'lastmonth',
            title: 'Le mois dernier',
            publishedAt: '2026-07-01T00:00:00.000Z',
          }),
        ],
      }),
    );

    expect(plan.digest.content).toContain('Cette semaine');
    expect(plan.digest.content).not.toContain('Le mois dernier');
  });
});

describe('runPublish, notifications', () => {
  it('notifies a blocking item only once its evidence is verified', () => {
    const plan = runPublish(
      buildPublishInput({
        verifiedItems: [
          buildRecentItem({
            id: 'verified',
            title: 'Contrainte prouvée',
            criticality: Criticality.BLOCKING,
            trustLevel: TrustLevel.VERIFIED,
            evidenceQuote: 'must declare the permission',
          }),
          buildRecentItem({
            id: 'unverified',
            title: 'Contrainte non prouvée',
            criticality: Criticality.BLOCKING,
            trustLevel: TrustLevel.UNVERIFIED,
          }),
          buildRecentItem({
            id: 'reported',
            title: 'Contrainte rapportée',
            criticality: Criticality.BLOCKING,
            trustLevel: TrustLevel.REPORTED,
          }),
        ],
      }),
    );

    expect(plan.notifications.map((draft) => draft.title)).toEqual([
      '[VEILLE] Bloquant : Contrainte prouvée',
    ]);
    expect(plan.notifications[0]?.fingerprint).toBe('blocking:fp-1');
    expect(plan.notifications[0]?.body).toContain('must declare the permission');
  });

  it('opens a mute source issue when a feed stops publishing', () => {
    const plan = runPublish(
      buildPublishInput({
        verifiedItems: [buildRecentItem({ id: '1' })],
        feeds: [buildFeed({ name: 'Frozen Feed', maxAgeDays: 10 })],
        activities: [{ feedName: 'Frozen Feed', lastItemAt: '2026-01-01T00:00:00.000Z' }],
      }),
    );

    const staleDraft = plan.notifications.find((draft) => draft.title === '[VEILLE] Flux muet');

    expect(staleDraft).toBeDefined();
    expect(staleDraft?.body).toContain('Frozen Feed');
    expect(staleDraft?.labels).toContain('flux-muet');
  });

  it('stays quiet while every source keeps publishing', () => {
    const plan = runPublish(
      buildPublishInput({
        verifiedItems: [buildRecentItem({ id: '1' })],
        feeds: [buildFeed({ name: 'Live Feed', maxAgeDays: 30 })],
        activities: [{ feedName: 'Live Feed', lastItemAt: '2026-08-30T00:00:00.000Z' }],
      }),
    );

    expect(plan.notifications).toEqual([]);
  });

  it('reports a silent pipeline when nothing has been collected for too long', () => {
    const plan = runPublish(
      buildPublishInput({
        existingItems: [
          buildVeilleItem({
            id: 'old',
            publishedAt: '2026-06-01T00:00:00.000Z',
            collectedAt: '2026-06-01T00:00:00.000Z',
          }),
        ],
        feeds: [buildFeed({ name: 'Live Feed', maxAgeDays: 30 })],
        activities: [{ feedName: 'Live Feed', lastItemAt: '2026-08-30T00:00:00.000Z' }],
      }),
    );

    const staleDraft = plan.notifications.find((draft) => draft.title === '[VEILLE] Flux muet');

    expect(staleDraft?.body).toContain('Le pipeline lui-même est silencieux');
  });
});

describe('buildNotifications, idempotency keys', () => {
  it('keys a blocking notification on the item fingerprint', () => {
    const drafts = buildNotifications({
      items: [
        buildVeilleItem({
          fingerprint: 'fp-abc',
          criticality: Criticality.BLOCKING,
          trustLevel: TrustLevel.VERIFIED,
        }),
      ],
      staleFeeds: [],
      isPipelineSilent: false,
      weekLabel: CURRENT_WEEK,
    });

    expect(drafts[0]?.fingerprint).toBe('blocking:fp-abc');
  });

  it('keys a mute source notification on the week and the set of sources', () => {
    const drafts = buildNotifications({
      items: [],
      staleFeeds: [
        { feedName: 'Beta', maxAgeDays: 10 },
        { feedName: 'Alpha', maxAgeDays: 10 },
      ],
      isPipelineSilent: false,
      weekLabel: CURRENT_WEEK,
    });

    expect(drafts[0]?.fingerprint).toBe(`stale:feeds:${CURRENT_WEEK}:Alpha|Beta`);
  });

  it('gives the same key whatever the order the sources were reported in', () => {
    const first = buildNotifications({
      items: [],
      staleFeeds: [
        { feedName: 'Alpha', maxAgeDays: 10 },
        { feedName: 'Beta', maxAgeDays: 10 },
      ],
      isPipelineSilent: false,
      weekLabel: CURRENT_WEEK,
    });
    const second = buildNotifications({
      items: [],
      staleFeeds: [
        { feedName: 'Beta', maxAgeDays: 10 },
        { feedName: 'Alpha', maxAgeDays: 10 },
      ],
      isPipelineSilent: false,
      weekLabel: CURRENT_WEEK,
    });

    expect(first[0]?.fingerprint).toBe(second[0]?.fingerprint);
  });

  it('names impacted projects by opaque code only, never by label', () => {
    const drafts = buildNotifications({
      items: [
        buildVeilleItem({
          criticality: Criticality.BLOCKING,
          trustLevel: TrustLevel.VERIFIED,
          impactedProjects: ['proj-a', 'proj-c'],
        }),
      ],
      staleFeeds: [],
      isPipelineSilent: false,
      weekLabel: CURRENT_WEEK,
    });

    const projectsLine = drafts[0]?.body
      .split('\n')
      .find((line) => line.startsWith('Projets concernés :'));

    expect(projectsLine).toBe('Projets concernés : proj-a, proj-c');
    for (const code of projectsLine?.replace('Projets concernés :', '').split(',') ?? []) {
      expect(code.trim()).toMatch(/^proj-[a-z0-9-]+$/);
    }
  });
});
