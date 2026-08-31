import { decodeHtmlEntities } from './normalizeText';

/**
 * Turns an HTML document into plain text, without any dependency.
 *
 * Only used to look for an evidence quote and to build the excerpt handed to
 * the classifier: it does not try to be a faithful renderer.
 */

const BLOCK_END_PATTERN =
  /<\/(p|div|section|article|li|ul|ol|tr|td|th|h1|h2|h3|h4|h5|h6|pre|blockquote)\s*>/gi;
const LINE_BREAK_PATTERN = /<br\s*\/?>/gi;
const REMOVED_BLOCKS_PATTERN = /<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const COMMENT_PATTERN = /<!--[\s\S]*?-->/g;
const TAG_PATTERN = /<[^>]+>/g;

const stripHtml = (html: string): string => {
  const withoutHiddenBlocks = html
    .replace(COMMENT_PATTERN, ' ')
    .replace(REMOVED_BLOCKS_PATTERN, ' ');

  const withBreaks = withoutHiddenBlocks
    .replace(LINE_BREAK_PATTERN, '\n')
    .replace(BLOCK_END_PATTERN, '\n');

  const text = decodeHtmlEntities(withBreaks.replace(TAG_PATTERN, ' '));

  return text
    .replace(/[ \t\f\r]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

export { stripHtml };
