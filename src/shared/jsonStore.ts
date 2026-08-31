import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { ZodType } from 'zod';

/**
 * Validated file access.
 *
 * Nothing enters the pipeline without going through a schema, and nothing is
 * written without a trailing newline and a stable indentation, so that a
 * committed file only changes when its content actually changes.
 */

const JSON_INDENTATION = 2;

const describeIssues = (error: z.ZodError): string => {
  return z.prettifyError(error).replace(/\s+/g, ' ').trim();
};

/** Reads and validates a file, returning `undefined` when it does not exist. */
const readOptionalJsonFile = <T>(filePath: string, schema: ZodType<T>): T | undefined => {
  if (!existsSync(filePath)) {
    return undefined;
  }

  const raw = readFileSync(filePath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  const result = schema.safeParse(parsed);

  if (!result.success) {
    throw new Error(`invalid content in ${filePath}: ${describeIssues(result.error)}`);
  }

  return result.data;
};

/** Reads and validates a file the caller cannot work without. */
const readRequiredJsonFile = <T>(filePath: string, schema: ZodType<T>): T => {
  const content = readOptionalJsonFile(filePath, schema);

  if (content === undefined) {
    throw new Error(`missing required file ${filePath}`);
  }

  return content;
};

const ensureDirectory = (directoryPath: string): void => {
  mkdirSync(directoryPath, { recursive: true });
};

const writeJsonFile = (filePath: string, value: unknown): void => {
  ensureDirectory(dirname(filePath));
  writeFileSync(filePath, `${JSON.stringify(value, null, JSON_INDENTATION)}\n`, 'utf8');
};

const writeTextFile = (filePath: string, content: string): void => {
  ensureDirectory(dirname(filePath));
  writeFileSync(filePath, content, 'utf8');
};

/** Lists the file names of a directory, or nothing when it does not exist. */
const listDirectory = (directoryPath: string): string[] => {
  if (!existsSync(directoryPath)) {
    return [];
  }

  return readdirSync(directoryPath).sort();
};

export {
  ensureDirectory,
  listDirectory,
  readOptionalJsonFile,
  readRequiredJsonFile,
  writeJsonFile,
  writeTextFile,
};
