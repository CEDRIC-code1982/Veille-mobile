/**
 * Text normalisation used by the evidence check.
 *
 * Exactly four things are neutralised, as specified: letter case, repeated
 * whitespace, HTML entities and typographic punctuation. ASCII punctuation is
 * deliberately preserved, so the comparison stays meaningful.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  shy: '',
  lsquo: "'",
  rsquo: "'",
  sbquo: "'",
  ldquo: '"',
  rdquo: '"',
  bdquo: '"',
  laquo: '"',
  raquo: '"',
  lsaquo: '"',
  rsaquo: '"',
  ndash: '-',
  mdash: '-',
  minus: '-',
  hellip: '...',
  middot: '.',
  bull: '.',
  copy: '(c)',
  reg: '(r)',
  trade: '(tm)',
  aacute: 'á',
  agrave: 'à',
  acirc: 'â',
  auml: 'ä',
  ccedil: 'ç',
  eacute: 'é',
  egrave: 'è',
  ecirc: 'ê',
  euml: 'ë',
  iacute: 'í',
  icirc: 'î',
  iuml: 'ï',
  oacute: 'ó',
  ocirc: 'ô',
  ouml: 'ö',
  uacute: 'ú',
  ugrave: 'ù',
  ucirc: 'û',
  uuml: 'ü',
  ntilde: 'ñ',
  szlig: 'ß',
};

/** Characters that only differ typographically from their ASCII counterpart. */
const TYPOGRAPHIC_REPLACEMENTS: Array<[RegExp, string]> = [
  [/[‘’‚‛′´`]/g, "'"],
  [/[“”„‟″«»‹›]/g, '"'],
  [/[‐‑‒–—―−]/g, '-'],
  [/…/g, '...'],
  [/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, ' '],
  // Alternation rather than a character class: a zero-width joiner inside a
  // class is reported as a misleading sequence by the linter.
  [/\u200b|\u200c|\u200d|\u2060|\ufeff|\u00ad/g, ''],
  [/[•·‧]/g, '.'],
];

/** Decodes numeric and the most common named HTML entities. */
const decodeHtmlEntities = (text: string): string => {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (match, hex: string) => {
      const codePoint = Number.parseInt(hex, 16);

      return Number.isFinite(codePoint) && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    })
    .replace(/&#(\d+);/g, (match, decimal: string) => {
      const codePoint = Number.parseInt(decimal, 10);

      return Number.isFinite(codePoint) && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    })
    .replace(/&([a-zA-Z][a-zA-Z0-9]{1,31});/g, (match, name: string) => {
      const decoded = NAMED_ENTITIES[name.toLowerCase()];

      if (decoded === undefined) {
        return match;
      }

      // "&Eacute;" and "&eacute;" share one entry, the case comes from the name.
      if (decoded.length === 1 && /^[A-Z]/.test(name)) {
        return decoded.toUpperCase();
      }

      return decoded;
    });
};

/** Folds typographic punctuation and exotic spaces down to ASCII. */
const foldTypography = (text: string): string => {
  let folded = text;

  for (const [pattern, replacement] of TYPOGRAPHIC_REPLACEMENTS) {
    folded = folded.replace(pattern, replacement);
  }

  return folded;
};

/** Produces the canonical form used for every text comparison in the pipeline. */
const normalizeText = (text: string): string => {
  return foldTypography(decodeHtmlEntities(text))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
};

/** Shortens a text without cutting mid-word when it can be avoided. */
const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) {
    return text;
  }

  const hardCut = text.slice(0, maxLength);
  const lastSpaceIndex = hardCut.lastIndexOf(' ');

  if (lastSpaceIndex < maxLength / 2) {
    return hardCut;
  }

  return hardCut.slice(0, lastSpaceIndex);
};

export { decodeHtmlEntities, foldTypography, normalizeText, truncateText };
