import { describe, expect, it } from 'vitest';

import { canonicalizeUrl } from '../src/domain/support/canonicalizeUrl';
import { findQuoteInText, QuoteLookupResult } from '../src/domain/support/findQuoteInText';
import {
  buildFingerprintSource,
  buildIdSource,
  toDayStamp,
} from '../src/domain/support/identifiers';
import { isOfficialSource } from '../src/domain/support/isOfficialSource';
import { toIsoDayLabel, toIsoMonthLabel, toIsoWeekLabel } from '../src/domain/support/isoWeek';
import { normalizeText, truncateText } from '../src/domain/support/normalizeText';
import { stripHtml } from '../src/domain/support/stripHtml';
import { TEST_OFFICIAL_DOMAINS } from './helpers/factories';

describe('normalizeText', () => {
  it('neutralises letter case and repeated whitespace', () => {
    expect(normalizeText('  Background   EXECUTION\tlimits \n')).toBe('background execution limits');
  });

  it('decodes HTML entities, named, decimal and hexadecimal', () => {
    expect(normalizeText('apps &amp; services')).toBe('apps & services');
    expect(normalizeText('don&#8217;t stop')).toBe("don't stop");
    expect(normalizeText('don&#x2019;t stop')).toBe("don't stop");
  });

  it('folds typographic punctuation down to ASCII', () => {
    expect(normalizeText('“Background” — don’t…')).toBe('"background" - don\'t...');
  });

  it('turns a non-breaking space into a plain space', () => {
    expect(normalizeText('target\u00a0API\u00a0level')).toBe('target api level');
  });

  it('removes zero-width characters instead of turning them into spaces', () => {
    expect(normalizeText('API\u200blevel')).toBe('apilevel');
    expect(normalizeText('soft\u00adhyphen')).toBe('softhyphen');
  });

  it('makes a typographic quote and its ASCII twin compare equal', () => {
    expect(normalizeText('Apps “must” target the level — see docs')).toBe(
      normalizeText('apps  "must"  target the level - see docs'),
    );
  });

  it('leaves an unknown entity untouched rather than mangling it', () => {
    expect(normalizeText('&unknownentity; stays')).toBe('&unknownentity; stays');
  });
});

describe('truncateText', () => {
  it('returns the text untouched when it already fits', () => {
    expect(truncateText('short', 10)).toBe('short');
  });

  it('cuts on a word boundary when there is one late enough', () => {
    expect(truncateText('alpha beta gamma', 12)).toBe('alpha beta');
  });

  it('falls back to a hard cut when the only space is too early', () => {
    expect(truncateText('a bbbbbbbbbbbbbbbb', 10)).toBe('a bbbbbbbb');
  });
});

describe('stripHtml', () => {
  it('drops scripts, styles and comments entirely', () => {
    const html = '<p>Kept</p><script>const a = 1;</script><style>.a{}</style><!-- note -->';

    expect(stripHtml(html)).toBe('Kept');
  });

  it('drops site chrome, so boilerplate can never pass as evidence', () => {
    const html =
      '<nav>Menu everywhere</nav><aside>Sidebar</aside><p>Real content</p>' +
      '<footer>Footer everywhere</footer>';

    expect(stripHtml(html)).toBe('Real content');
  });

  it('turns block ends and line breaks into newlines', () => {
    expect(stripHtml('<p>One</p><p>Two<br>Three</p>')).toBe('One\nTwo\nThree');
  });

  it('decodes entities in the extracted text', () => {
    expect(stripHtml('<p>apps &amp; games</p>')).toBe('apps & games');
  });
});

describe('canonicalizeUrl', () => {
  it('lower-cases the host, drops the fragment and the trailing slash', () => {
    expect(canonicalizeUrl('https://Developer.Apple.COM/news/?#anchor')).toBe(
      'https://developer.apple.com/news',
    );
  });

  it('drops tracking parameters and sorts the remaining query', () => {
    expect(canonicalizeUrl('https://example.invalid/a?utm_source=x&b=2&a=1&fbclid=z')).toBe(
      'https://example.invalid/a?a=1&b=2',
    );
  });

  it('returns unparsable input trimmed, so the identifier stays deterministic', () => {
    expect(canonicalizeUrl('  not a url  ')).toBe('not a url');
  });

  it('gives two spellings of the same page the same canonical form', () => {
    expect(canonicalizeUrl('https://example.invalid/page/?utm_medium=rss')).toBe(
      canonicalizeUrl('https://example.invalid/page'),
    );
  });
});

describe('isOfficialSource', () => {
  it('accepts a whitelisted domain and its subdomains', () => {
    expect(isOfficialSource('https://developer.apple.com/news/x', TEST_OFFICIAL_DOMAINS)).toBe(true);
    expect(isOfficialSource('https://cdn.developer.apple.com/x', TEST_OFFICIAL_DOMAINS)).toBe(true);
  });

  it('rejects a domain that is not whitelisted', () => {
    expect(isOfficialSource('https://some-blog.example.invalid/post', TEST_OFFICIAL_DOMAINS)).toBe(
      false,
    );
  });

  it('rejects a look-alike domain that merely ends with the same letters', () => {
    expect(isOfficialSource('https://notdeveloper.apple.com.evil.invalid/x', TEST_OFFICIAL_DOMAINS)).toBe(
      false,
    );
  });

  it('honours the path restriction of a shared host', () => {
    expect(
      isOfficialSource(
        'https://github.com/example-org/example-repo/releases/tag/v1',
        TEST_OFFICIAL_DOMAINS,
      ),
    ).toBe(true);
    expect(
      isOfficialSource('https://github.com/someone/else/issues/1', TEST_OFFICIAL_DOMAINS),
    ).toBe(false);
  });

  it('rejects a non-http protocol and an unparsable URL', () => {
    expect(isOfficialSource('ftp://developer.apple.com/x', TEST_OFFICIAL_DOMAINS)).toBe(false);
    expect(isOfficialSource('nonsense', TEST_OFFICIAL_DOMAINS)).toBe(false);
  });
});

describe('findQuoteInText', () => {
  const page = 'Apps targeting the new level must declare the permission before publishing.';

  it('finds a quote that differs only by case, spacing and typography', () => {
    expect(findQuoteInText('“Apps  targeting the new level MUST declare”', page)).toBe(
      QuoteLookupResult.FOUND,
    );
  });

  it('reports a quote that is simply not there', () => {
    expect(findQuoteInText('apps may ignore the permission entirely', page)).toBe(
      QuoteLookupResult.MISSING,
    );
  });

  it('accepts an elided quote when every segment is present in order', () => {
    expect(findQuoteInText('Apps targeting the new level ... declare the permission', page)).toBe(
      QuoteLookupResult.FOUND,
    );
  });

  it('rejects an elided quote whose segments appear in the wrong order', () => {
    expect(findQuoteInText('declare the permission ... Apps targeting the new', page)).toBe(
      QuoteLookupResult.MISSING,
    );
  });

  it('refuses a quote too short to prove anything', () => {
    expect(findQuoteInText('must', page)).toBe(QuoteLookupResult.TOO_SHORT);
    expect(findQuoteInText('   ', page)).toBe(QuoteLookupResult.TOO_SHORT);
  });
});

describe('identifiers', () => {
  it('keeps only the calendar day of a timestamp', () => {
    expect(toDayStamp('2020-01-02T15:04:05.000Z')).toBe('2020-01-02');
    expect(toDayStamp('not a date')).toBe('');
  });

  it('builds the same id source for two spellings of one URL', () => {
    expect(buildIdSource('https://example.invalid/a/?utm_source=rss')).toBe(
      buildIdSource('https://example.invalid/a'),
    );
  });

  it('builds the same fingerprint source for one story relayed twice', () => {
    expect(buildFingerprintSource('Behavior  changes', '2020-01-02T08:00:00Z')).toBe(
      buildFingerprintSource('behavior changes', '2020-01-02T20:00:00Z'),
    );
  });

  it('keeps a recurring title distinct from one day to the next', () => {
    expect(buildFingerprintSource('Release notes', '2020-01-02T00:00:00Z')).not.toBe(
      buildFingerprintSource('Release notes', '2020-01-09T00:00:00Z'),
    );
  });
});

describe('isoWeek', () => {
  it('labels a mid-week day with its ISO week', () => {
    expect(toIsoWeekLabel(new Date('2020-01-02T00:00:00Z'))).toBe('2020-W01');
  });

  it('keeps a January day inside the previous ISO year when the week belongs to it', () => {
    expect(toIsoWeekLabel(new Date('2021-01-01T00:00:00Z'))).toBe('2020-W53');
  });

  it('labels the last days of December in week 1 of the next year when applicable', () => {
    expect(toIsoWeekLabel(new Date('2019-12-30T00:00:00Z'))).toBe('2020-W01');
  });

  it('formats day and month labels in UTC', () => {
    const date = new Date('2020-03-04T23:30:00Z');

    expect(toIsoDayLabel(date)).toBe('2020-03-04');
    expect(toIsoMonthLabel(date)).toBe('2020-03');
  });
});
