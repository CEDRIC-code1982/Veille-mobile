import { describe, expect, it } from 'vitest';

import {
  buildTermPattern,
  buildTermPatterns,
  findViolationsInText,
  parseForbiddenTerms,
} from '../src/tools/privacyPatterns';

describe('parseForbiddenTerms', () => {
  it('keeps one term per line, dropping comments and blank lines', () => {
    const raw = ['# a comment', '', '  Example Client  ', 'OtherTerm', '   ', '# trailing'].join(
      '\n',
    );

    expect(parseForbiddenTerms(raw)).toEqual(['Example Client', 'OtherTerm']);
  });

  it('accepts CRLF input, as produced by a Windows editor or a CI secret', () => {
    expect(parseForbiddenTerms('First\r\nSecond\r\n')).toEqual(['First', 'Second']);
  });

  it('returns an empty list for an empty input', () => {
    expect(parseForbiddenTerms('')).toEqual([]);
    expect(parseForbiddenTerms('\n\n# only comments\n')).toEqual([]);
  });
});

describe('buildTermPattern', () => {
  it('is case-insensitive', () => {
    const pattern = buildTermPattern('ExampleEmployer');

    expect(pattern?.test('EXAMPLEEMPLOYER')).toBe(true);
    expect(pattern?.test('exampleemployer')).toBe(true);
  });

  it('tolerates hyphen, underscore, space, dot or no separator at all', () => {
    const pattern = buildTermPattern('Example Employer');

    expect(pattern?.test('example-employer')).toBe(true);
    expect(pattern?.test('example_employer')).toBe(true);
    expect(pattern?.test('example employer')).toBe(true);
    expect(pattern?.test('example.employer')).toBe(true);
    expect(pattern?.test('exampleemployer')).toBe(true);
  });

  it('treats a camelCase term as separate chunks, so every spelling is caught', () => {
    const pattern = buildTermPattern('ExampleEmployer');

    expect(pattern?.test('example-employer')).toBe(true);
    expect(pattern?.test('EXAMPLE_EMPLOYER')).toBe(true);
  });

  it('does not match an unrelated word', () => {
    const pattern = buildTermPattern('Example Employer');

    expect(pattern?.test('react native background modes')).toBe(false);
  });

  it('anchors a short term, so an acronym stays usable', () => {
    const pattern = buildTermPattern('ZQL');

    expect(pattern?.test('ZQL')).toBe(true);
    expect(pattern?.test('la société ZQL, à Exempleville')).toBe(true);
    expect(pattern?.test('zql-access')).toBe(true);
    expect(pattern?.test('my_zql_thing')).toBe(true);
    expect(pattern?.test('ZQL.ACCESS')).toBe(true);
  });

  it('keeps a short term from matching inside a word or a hash', () => {
    const pattern = buildTermPattern('ZQL');

    expect(pattern?.test('sha512-Abzqlxyzqw==')).toBe(false);
    expect(pattern?.test('prozqligious')).toBe(false);
    expect(pattern?.test('zqly')).toBe(false);
    expect(pattern?.test('xzql')).toBe(false);
  });

  it('still matches a long term inside a longer word', () => {
    const pattern = buildTermPattern('Contoso');

    expect(pattern?.test('MyContosoThing')).toBe(true);
  });

  it('returns undefined for a term without any alphanumeric character', () => {
    expect(buildTermPattern('---')).toBeUndefined();
    expect(buildTermPattern('   ')).toBeUndefined();
  });

  it('skips unusable terms while keeping the order of the usable ones', () => {
    expect(buildTermPatterns(['First', '###', 'Second'])).toHaveLength(2);
  });
});

describe('findViolationsInText', () => {
  const patterns = buildTermPatterns(['ExampleEmployer', 'internal-codename']);

  it('reports the location with a 1-based line number and a 1-based term index', () => {
    const text = ['harmless line', 'mentions example_employer here', 'harmless again'].join('\n');

    expect(findViolationsInText(text, patterns, 'README.md')).toEqual([
      { location: 'README.md:2', patternIndex: 1 },
    ]);
  });

  it('reports every offending term on the same line', () => {
    const text = 'exampleemployer and internalcodename together';

    expect(findViolationsInText(text, patterns, 'notes.md')).toEqual([
      { location: 'notes.md:1', patternIndex: 1 },
      { location: 'notes.md:1', patternIndex: 2 },
    ]);
  });

  it('returns nothing for a clean text', () => {
    const text = 'Android 0 behaviour changes for background work';

    expect(findViolationsInText(text, patterns, 'clean.md')).toEqual([]);
  });

  it('returns nothing when no pattern is configured', () => {
    expect(findViolationsInText('ExampleEmployer', [], 'clean.md')).toEqual([]);
  });
});
