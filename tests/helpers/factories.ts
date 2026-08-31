import type { CollectedItem } from '../../src/domain/entities/CollectedItem';
import { Category } from '../../src/domain/entities/Category';
import type { Feed } from '../../src/domain/entities/Feed';
import { FeedType } from '../../src/domain/entities/Feed';
import type { OfficialDomain } from '../../src/domain/entities/OfficialDomain';
import { Criticality, TrustLevel } from '../../src/domain/entities/VeilleItem';
import type { VeilleItem } from '../../src/domain/entities/VeilleItem';

/**
 * Test factories.
 *
 * Every value here is synthetic scaffolding, never a claim about the real
 * world: the dates, versions and URLs below exist only to exercise the code.
 */

const TEST_OFFICIAL_DOMAINS: readonly OfficialDomain[] = [
  { domain: 'developer.apple.com' },
  { domain: 'developer.android.com' },
  { domain: 'github.com', pathPrefixes: ['/example-org/example-repo/releases'] },
];

const buildCollectedItem = (overrides: Partial<CollectedItem> = {}): CollectedItem => {
  return {
    id: 'id-1',
    title: 'A synthetic announcement',
    sourceUrl: 'https://developer.android.com/example/page',
    sourceName: 'Test Feed',
    sourceDomain: 'developer.android.com',
    official: true,
    categories: [Category.ANDROID],
    publishedAt: '2020-01-02T00:00:00.000Z',
    collectedAt: '2020-01-03T00:00:00.000Z',
    excerpt: 'A synthetic excerpt used only by the tests.',
    fingerprint: 'fp-1',
    ...overrides,
  };
};

const buildVeilleItem = (overrides: Partial<VeilleItem> = {}): VeilleItem => {
  return {
    id: 'id-1',
    title: 'A synthetic announcement',
    summary: 'Un résumé synthétique de test.',
    sourceUrl: 'https://developer.android.com/example/page',
    sourceName: 'Test Feed',
    publishedAt: '2020-01-02T00:00:00.000Z',
    collectedAt: '2020-01-03T00:00:00.000Z',
    criticality: Criticality.BACKGROUND,
    trustLevel: TrustLevel.UNVERIFIED,
    categories: [Category.ANDROID],
    tags: ['android'],
    impactedProjects: [],
    fingerprint: 'fp-1',
    ...overrides,
  };
};

const buildFeed = (overrides: Partial<Feed> = {}): Feed => {
  return {
    name: 'Test Feed',
    url: 'https://developer.android.com/feeds/example.xml',
    type: FeedType.RSS,
    domain: 'developer.android.com',
    categories: [Category.ANDROID],
    official: true,
    maxAgeDays: 30,
    ...overrides,
  };
};

export { buildCollectedItem, buildFeed, buildVeilleItem, TEST_OFFICIAL_DOMAINS };
