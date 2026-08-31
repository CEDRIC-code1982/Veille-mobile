import { decodeHtmlEntities } from './normalizeText';

/**
 * Turns an HTML document into plain text, without any dependency.
 *
 * Only used to look for an evidence quote and to build the excerpt handed to
 * the classifier: it does not try to be a faithful renderer.
 */

const BLOCK_TAGS = 'p|div|section|article|li|ul|ol|tr|td|th|h1|h2|h3|h4|h5|h6|pre|blockquote';
const BLOCK_END_PATTERN = new RegExp(`</(?:${BLOCK_TAGS})\\s*>`, 'gi');
// A block start also breaks the line: a widget nested at the end of a heading
// must not end up glued to the heading text.
const BLOCK_START_PATTERN = new RegExp(`<(?:${BLOCK_TAGS})\\b[^>]*>`, 'gi');
const LINE_BREAK_PATTERN = /<br\s*\/?>/gi;
/**
 * Blocks removed before any text is extracted. Beyond the obvious script and
 * style, site chrome goes too: navigation, sidebars and footers are the same on
 * every page, so they pollute the excerpt handed to the classifier and, worse,
 * would let a boilerplate sentence pass as evidence.
 */
const REMOVED_BLOCKS_PATTERN =
  /<(script|style|noscript|svg|template|nav|aside|footer|form|button|select|dialog|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const COMMENT_PATTERN = /<!--[\s\S]*?-->/g;
const TAG_PATTERN = /<[^>]+>/g;

const stripHtml = (html: string): string => {
  const withoutHiddenBlocks = html
    .replace(COMMENT_PATTERN, ' ')
    .replace(REMOVED_BLOCKS_PATTERN, ' ');

  const withBreaks = withoutHiddenBlocks
    .replace(LINE_BREAK_PATTERN, '\n')
    .replace(BLOCK_END_PATTERN, '\n')
    .replace(BLOCK_START_PATTERN, '\n');

  const text = decodeHtmlEntities(withBreaks.replace(TAG_PATTERN, ' '));

  return text
    .replace(/[ \t\f\r]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
};

export { stripHtml };
