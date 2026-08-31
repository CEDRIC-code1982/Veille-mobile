/**
 * Privacy gate for this public repository.
 *
 * Fails whenever a forbidden term appears in the indexed files, the files about
 * to be added, the commit messages or the branch names. It is wired both as a
 * pre-commit hook and as the first step of the deploy workflow, so that nothing
 * reaches GitHub Pages once it has failed.
 *
 * Terms come from `forbidden-terms.local.txt` (gitignored) or, when that file is
 * absent, from the `FORBIDDEN_TERMS` environment variable. Pass
 * `--require-terms` to turn a missing configuration into a failure, which is
 * what CI does.
 *
 * A violation is reported as a location plus the 1-based index of the term. The
 * term itself and the matched text are never printed: this output is public.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';

import { createLogger } from '../shared/logger';
import { buildTermPatterns, findViolationsInText, parseForbiddenTerms } from './privacyPatterns';
import type { PrivacyViolation } from './privacyPatterns';

const logger = createLogger(import.meta.url);

const TERMS_FILE_NAME = 'forbidden-terms.local.txt';
const TERMS_ENV_VARIABLE = 'FORBIDDEN_TERMS';
const REQUIRE_TERMS_FLAG = '--require-terms';
const MAX_SCANNED_FILE_BYTES = 4_000_000;
const GIT_MAX_BUFFER_BYTES = 128 * 1024 * 1024;

// Control characters used as delimiters, built by code point so that no raw
// control byte ever appears in this source file.
const NUL = String.fromCharCode(0);
const RECORD_SEPARATOR = String.fromCharCode(30);
const FIELD_SEPARATOR = String.fromCharCode(31);

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.icns', '.pdf',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.zip', '.gz', '.tgz', '.bz2', '.xz', '.7z',
  '.mp3', '.mp4', '.mov', '.webm', '.wasm',
]);

interface ForbiddenTermsSource {
  terms: string[];
  origin: string;
}

/** Runs a git command, returning `undefined` when git itself fails. */
const runGit = (args: string[]): string | undefined => {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      maxBuffer: GIT_MAX_BUFFER_BYTES,
    });
  } catch {
    logger.warn(`git ${args[0] ?? ''} produced no output, skipping that scan`);

    return undefined;
  }
};

/** Loads the terms from the local file first, then from the environment. */
const loadForbiddenTerms = (): ForbiddenTermsSource => {
  if (existsSync(TERMS_FILE_NAME)) {
    const raw = readFileSync(TERMS_FILE_NAME, 'utf8');

    return { terms: parseForbiddenTerms(raw), origin: TERMS_FILE_NAME };
  }

  const fromEnvironment = process.env[TERMS_ENV_VARIABLE];

  if (fromEnvironment !== undefined && fromEnvironment.trim().length > 0) {
    return { terms: parseForbiddenTerms(fromEnvironment), origin: `$${TERMS_ENV_VARIABLE}` };
  }

  return { terms: [], origin: 'none' };
};

/** Lists indexed files plus untracked files that no ignore rule protects. */
const listScannableFiles = (): string[] => {
  const indexed = runGit(['ls-files', '-z']) ?? '';
  const untracked = runGit(['ls-files', '--others', '--exclude-standard', '-z']) ?? '';
  const paths = new Set<string>();

  for (const path of `${indexed}${untracked}`.split(NUL)) {
    if (path.length > 0) {
      paths.add(path);
    }
  }

  return [...paths].sort();
};

const hasBinaryExtension = (path: string): boolean => {
  const lastDotIndex = path.lastIndexOf('.');

  if (lastDotIndex < 0) {
    return false;
  }

  return BINARY_EXTENSIONS.has(path.slice(lastDotIndex).toLowerCase());
};

/** Reads a file as text, skipping binaries and oversized blobs. */
const readTextFile = (path: string): string | undefined => {
  if (hasBinaryExtension(path)) {
    return undefined;
  }

  try {
    if (statSync(path).size > MAX_SCANNED_FILE_BYTES) {
      logger.warn(`skipped ${path}, larger than ${MAX_SCANNED_FILE_BYTES} bytes`);

      return undefined;
    }

    const content = readFileSync(path, 'utf8');

    if (content.includes(NUL)) {
      return undefined;
    }

    return content;
  } catch {
    return undefined;
  }
};

const scanFiles = (patterns: RegExp[]): PrivacyViolation[] => {
  const violations: PrivacyViolation[] = [];

  for (const path of listScannableFiles()) {
    const content = readTextFile(path);

    if (content === undefined) {
      continue;
    }

    violations.push(...findViolationsInText(content, patterns, path));
  }

  return violations;
};

/** Scans every commit message of every ref, commit by commit. */
const scanCommitMessages = (patterns: RegExp[]): PrivacyViolation[] => {
  const log = runGit(['log', '--all', `--format=${RECORD_SEPARATOR}%H${FIELD_SEPARATOR}%B`]);

  if (log === undefined) {
    logger.info('no commit history to scan yet');

    return [];
  }

  const violations: PrivacyViolation[] = [];

  for (const record of log.split(RECORD_SEPARATOR)) {
    if (record.trim().length === 0) {
      continue;
    }

    const [commitHash, message] = record.split(FIELD_SEPARATOR);

    if (commitHash === undefined || message === undefined) {
      continue;
    }

    const location = `commit ${commitHash.slice(0, 12)} message`;
    violations.push(...findViolationsInText(message, patterns, location));
  }

  return violations;
};

const scanBranchNames = (patterns: RegExp[]): PrivacyViolation[] => {
  const refs = runGit(['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes']);

  if (refs === undefined) {
    return [];
  }

  return findViolationsInText(refs, patterns, 'branch name');
};

const main = (): void => {
  const requireTerms = process.argv.includes(REQUIRE_TERMS_FLAG);
  const source = loadForbiddenTerms();
  const patterns = buildTermPatterns(source.terms);

  if (patterns.length === 0) {
    if (requireTerms) {
      logger.error(
        `no forbidden term configured, expected ${TERMS_FILE_NAME} or $${TERMS_ENV_VARIABLE}`,
        new Error('privacy scan refused to run without a term list'),
      );
      process.exitCode = 1;

      return;
    }

    logger.warn(
      `no forbidden term configured (looked at ${TERMS_FILE_NAME} then $${TERMS_ENV_VARIABLE}), nothing scanned`,
    );

    return;
  }

  logger.info(`scanning with ${patterns.length} term(s) from ${source.origin}`);

  const violations = [
    ...scanFiles(patterns),
    ...scanCommitMessages(patterns),
    ...scanBranchNames(patterns),
  ];

  if (violations.length === 0) {
    logger.info('privacy scan passed, no forbidden term found');

    return;
  }

  for (const violation of violations) {
    logger.warn(`forbidden term #${violation.patternIndex} found at ${violation.location}`);
  }

  logger.error(
    `privacy scan failed with ${violations.length} violation(s)`,
    new Error('forbidden terms found, see the WARN lines above for locations'),
  );
  process.exitCode = 1;
};

main();
