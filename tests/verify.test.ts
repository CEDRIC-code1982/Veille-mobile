import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { Criticality, TrustLevel } from '../src/domain/entities/VeilleItem';
import type { VeilleItem } from '../src/domain/entities/VeilleItem';
import { runVerify } from '../src/scripts/verify';
import { buildVeilleItem, TEST_OFFICIAL_DOMAINS } from './helpers/factories';
import { createFakeFetcher } from './helpers/fakeFetcher';

const FIXTURES_DIRECTORY = join(resolve(fileURLToPath(import.meta.url), '..'), 'fixtures');
const OFFICIAL_PAGE = readFileSync(join(FIXTURES_DIRECTORY, 'official-page.html'), 'utf8');

const OFFICIAL_URL = 'https://developer.android.com/example/behaviour';
const THIRD_PARTY_URL = 'https://some-blog.example.invalid/post';

/**
 * The quote as the model would return it: plain ASCII apostrophes and spaces,
 * where the page uses a non-breaking space, an entity and inline markup. Only
 * the normalisation makes the two comparable.
 */
const REAL_QUOTE = 'Apps targeting the fixture level must declare the synthetic permission & request consent';

const NOW = new Date('2026-08-31T06:00:00.000Z');
const CLOCK = { now: (): Date => NOW };

const buildBlockingItem = (overrides: Partial<VeilleItem> = {}): VeilleItem => {
  return buildVeilleItem({
    criticality: Criticality.BLOCKING,
    trustLevel: TrustLevel.UNVERIFIED,
    sourceUrl: OFFICIAL_URL,
    evidenceQuote: REAL_QUOTE,
    ...overrides,
  });
};

const verifyWith = async (
  items: readonly VeilleItem[],
  fetcher = createFakeFetcher({ responses: { [OFFICIAL_URL]: OFFICIAL_PAGE } }),
): Promise<Awaited<ReturnType<typeof runVerify>>> => {
  return runVerify({
    items,
    officialDomains: TEST_OFFICIAL_DOMAINS,
    fetcher,
    clock: CLOCK,
    concurrency: 4,
  });
};

describe('runVerify, the four mandatory cases', () => {
  it('case 1, quote found in the first-party page: stays blocking and becomes verified', async () => {
    const result = await verifyWith([buildBlockingItem()]);

    expect(result.items[0]?.criticality).toBe(Criticality.BLOCKING);
    expect(result.items[0]?.trustLevel).toBe(TrustLevel.VERIFIED);
    expect(result.downgrades).toEqual([]);
  });

  it('case 2, quote absent from the page: downgraded to impacting and unverified', async () => {
    const result = await verifyWith([
      buildBlockingItem({ evidenceQuote: 'Apps may safely ignore this requirement entirely' }),
    ]);

    expect(result.items[0]?.criticality).toBe(Criticality.IMPACTING);
    expect(result.items[0]?.trustLevel).toBe(TrustLevel.UNVERIFIED);
    expect(result.downgrades).toHaveLength(1);
    expect(result.downgrades[0]?.reason).toContain('not found in the refetched source');
  });

  it('case 3, domain not whitelisted: downgraded even though the page carries the quote', async () => {
    const fetcher = createFakeFetcher({
      responses: { [THIRD_PARTY_URL]: OFFICIAL_PAGE, [OFFICIAL_URL]: OFFICIAL_PAGE },
    });
    const result = await verifyWith([buildBlockingItem({ sourceUrl: THIRD_PARTY_URL })], fetcher);

    expect(result.items[0]?.criticality).toBe(Criticality.IMPACTING);
    expect(result.items[0]?.trustLevel).toBe(TrustLevel.UNVERIFIED);
    expect(result.downgrades[0]?.reason).toContain('not first-party');
  });

  it('case 4, source answering 404: downgraded, and the run still succeeds', async () => {
    const fetcher = createFakeFetcher({
      failures: { [OFFICIAL_URL]: { status: 404, reason: 'HTTP 404' } },
    });
    const result = await verifyWith([buildBlockingItem()], fetcher);

    expect(result.items[0]?.criticality).toBe(Criticality.IMPACTING);
    expect(result.items[0]?.trustLevel).toBe(TrustLevel.UNVERIFIED);
    expect(result.downgrades[0]?.reason).toContain('could not be refetched');
    expect(result.items).toHaveLength(1);
    expect(result.verifiedAt).toBe(NOW.toISOString());
  });
});

describe('runVerify, normalisation of the comparison', () => {
  it('matches through non-breaking spaces, entities and inline markup', async () => {
    const result = await verifyWith([buildBlockingItem()]);

    expect(result.items[0]?.trustLevel).toBe(TrustLevel.VERIFIED);
  });

  it('matches a quote wrapped in typographic quotation marks', async () => {
    const result = await verifyWith([
      buildBlockingItem({ evidenceQuote: `“${REAL_QUOTE}”` }),
    ]);

    expect(result.items[0]?.trustLevel).toBe(TrustLevel.VERIFIED);
  });

  it('refuses a quote too short to prove anything', async () => {
    const result = await verifyWith([buildBlockingItem({ evidenceQuote: 'must' })]);

    expect(result.items[0]?.criticality).toBe(Criticality.IMPACTING);
    expect(result.downgrades[0]?.reason).toContain('too short');
  });

  it('never finds a quote in the navigation or the footer', async () => {
    const result = await verifyWith([buildBlockingItem({ evidenceQuote: 'Footer noise is here' })]);

    expect(result.items[0]?.criticality).toBe(Criticality.IMPACTING);
  });
});

describe('runVerify, blocking without a usable quote', () => {
  it('downgrades a blocking proposal that carries no quote, without refetching', async () => {
    const fetcher = createFakeFetcher({ responses: { [OFFICIAL_URL]: OFFICIAL_PAGE } });
    const item = buildVeilleItem({
      criticality: Criticality.BLOCKING,
      sourceUrl: OFFICIAL_URL,
    });
    const result = await verifyWith([item], fetcher);

    expect(result.items[0]?.criticality).toBe(Criticality.IMPACTING);
    expect(result.downgrades[0]?.reason).toContain('no evidence quote provided');
    expect(fetcher.requestedUrls).toEqual([]);
  });
});

describe('runVerify, trust level of non-blocking items', () => {
  it('marks a first-party impacting item with a found quote as verified', async () => {
    const result = await verifyWith([
      buildBlockingItem({ criticality: Criticality.IMPACTING }),
    ]);

    expect(result.items[0]?.criticality).toBe(Criticality.IMPACTING);
    expect(result.items[0]?.trustLevel).toBe(TrustLevel.VERIFIED);
    expect(result.downgrades).toEqual([]);
  });

  it('marks a first-party item whose quote is unfindable as reported, not downgraded', async () => {
    const result = await verifyWith([
      buildBlockingItem({
        criticality: Criticality.IMPACTING,
        evidenceQuote: 'A sentence that is nowhere on that page at all',
      }),
    ]);

    expect(result.items[0]?.criticality).toBe(Criticality.IMPACTING);
    expect(result.items[0]?.trustLevel).toBe(TrustLevel.REPORTED);
    expect(result.downgrades).toEqual([]);
  });

  it('leaves a third-party background item alone and never fetches it', async () => {
    const fetcher = createFakeFetcher({ responses: { [OFFICIAL_URL]: OFFICIAL_PAGE } });
    const result = await verifyWith(
      [
        buildVeilleItem({
          criticality: Criticality.BACKGROUND,
          sourceUrl: THIRD_PARTY_URL,
          evidenceQuote: REAL_QUOTE,
        }),
      ],
      fetcher,
    );

    expect(result.items[0]?.criticality).toBe(Criticality.BACKGROUND);
    expect(result.items[0]?.trustLevel).toBe(TrustLevel.UNVERIFIED);
    expect(fetcher.requestedUrls).toEqual([]);
  });
});

describe('runVerify, notes and bookkeeping', () => {
  it('explains an unverified item in French, for the site to display', async () => {
    const result = await verifyWith([
      buildBlockingItem({ evidenceQuote: 'A sentence that is nowhere on that page at all' }),
    ]);

    expect(result.items[0]?.verificationNote).toBe(
      'rétrogradé : citation introuvable dans la source refetchée',
    );
  });

  it('keeps a note left by an earlier stage rather than overwriting it', async () => {
    const result = await verifyWith([
      buildVeilleItem({
        criticality: Criticality.BACKGROUND,
        sourceUrl: THIRD_PARTY_URL,
        verificationNote: 'non classé : simulated parse failure',
      }),
    ]);

    expect(result.items[0]?.verificationNote).toBe('non classé : simulated parse failure');
  });

  it('adds no note to a fully verified item, the badge is enough', async () => {
    const result = await verifyWith([buildBlockingItem()]);

    expect(result.items[0]?.verificationNote).toBeUndefined();
  });

  it('processes every item whatever the concurrency, keeping the input order', async () => {
    const items = [
      buildBlockingItem({ id: 'a' }),
      buildBlockingItem({ id: 'b', evidenceQuote: 'nowhere to be found on this page' }),
      buildBlockingItem({ id: 'c' }),
      buildBlockingItem({ id: 'd' }),
      buildBlockingItem({ id: 'e' }),
    ];
    const result = await runVerify({
      items,
      officialDomains: TEST_OFFICIAL_DOMAINS,
      fetcher: createFakeFetcher({ responses: { [OFFICIAL_URL]: OFFICIAL_PAGE } }),
      clock: CLOCK,
      concurrency: 2,
    });

    expect(result.items.map((item) => item.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(result.downgrades.map((downgrade) => downgrade.itemId)).toEqual(['b']);
  });

  it('returns an empty result for an empty input', async () => {
    const result = await verifyWith([]);

    expect(result.items).toEqual([]);
    expect(result.downgrades).toEqual([]);
  });
});
