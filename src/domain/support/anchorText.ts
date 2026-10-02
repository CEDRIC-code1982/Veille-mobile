/**
 * Narrows a scraped page to the section that actually carries the payload.
 *
 * A documentation page often buries what matters under a long preamble: the
 * deprecation tables that state retirement dates sit below the policy prose,
 * past the excerpt budget, so the classifier never reads the one thing worth
 * reading. The anchor says where the useful part starts.
 *
 * It narrows the identity hash as well as the excerpt, and that is deliberate:
 * a new item then appears when the anchored section changes, not when a
 * sentence of the preamble is reworded.
 *
 * An unusable or unmatched pattern keeps the whole text: a broken anchor must
 * not silently empty a source.
 */
const anchorText = (text: string, anchorPattern: string | undefined): string => {
  if (anchorPattern === undefined || anchorPattern.trim().length === 0) {
    return text;
  }

  let matcher: RegExp;

  try {
    matcher = new RegExp(anchorPattern, 'i');
  } catch {
    return text;
  }

  const match = matcher.exec(text);

  return match === null ? text : text.slice(match.index);
};

export { anchorText };
