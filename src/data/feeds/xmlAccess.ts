/**
 * Narrowing helpers over the untyped tree returned by the XML parser.
 *
 * The parser hands back `any`; nothing else in the codebase is allowed to see
 * that, so every access to the tree goes through these guards.
 */

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
};

/** Reads a child, whether the parser produced a single node or a list. */
const asArray = (value: unknown): unknown[] => {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
};

/**
 * Extracts text from a node that may be a plain string, a number, or an object
 * carrying its text in `#text` alongside attributes.
 */
const asText = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    const trimmed = value.trim();

    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  const record = asRecord(value);

  if (record === undefined) {
    return undefined;
  }

  return asText(record['#text']);
};

const readChild = (node: Record<string, unknown> | undefined, key: string): unknown => {
  return node?.[key];
};

const readAttribute = (value: unknown, attributeName: string): string | undefined => {
  return asText(readChild(asRecord(value), attributeName));
};

export { asArray, asRecord, asText, readAttribute, readChild };
