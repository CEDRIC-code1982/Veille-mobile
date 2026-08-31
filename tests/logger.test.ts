import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLogger } from '../src/shared/logger';

const LINE_PATTERN =
  /^\[(DEBUG|INFO|WARN|ERROR)\]\[logger\.test\.ts\]\[[^\]]+\]\[\d+\]\[\d{2}:\d{2}:\d{2}\] /;

/**
 * Replaces `console.log` by a collector, so that assertions read fully typed
 * `unknown` arguments instead of the `any[]` exposed by the console signature.
 */
const captureLogLines = (): unknown[][] => {
  const lines: unknown[][] = [];

  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]): void => {
    lines.push(args);
  });

  return lines;
};

const readLine = (lines: unknown[][], index: number): string => {
  const first = lines[index]?.[0];

  return typeof first === 'string' ? first : '';
};

describe('createLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LOG_LEVEL;
  });

  it('formats a line as [LEVEL][FileName][functionName][line][HH:mm:ss] message', () => {
    const lines = captureLogLines();
    const logger = createLogger(import.meta.url);

    logger.info('pipeline started');

    expect(lines).toHaveLength(1);
    expect(readLine(lines, 0)).toMatch(LINE_PATTERN);
    expect(readLine(lines, 0)).toContain('] pipeline started');
  });

  it('reports the real caller line, not a line inside the logger module', () => {
    const lines = captureLogLines();
    const logger = createLogger(import.meta.url);

    logger.warn('feed looks stale');

    expect(readLine(lines, 0)).toMatch(/^\[WARN\]\[logger\.test\.ts\]/);
  });

  it('always passes the full error object alongside an ERROR line', () => {
    const lines = captureLogLines();
    const logger = createLogger(import.meta.url);
    const failure = new Error('socket hang up');

    logger.error('fetch failed', failure);

    expect(readLine(lines, 0)).toMatch(/^\[ERROR\]\[logger\.test\.ts\]/);
    expect(lines[0]?.[1]).toBe(failure);
  });

  it('hides DEBUG lines unless LOG_LEVEL asks for them', () => {
    const lines = captureLogLines();
    const logger = createLogger(import.meta.url);

    logger.debug('hidden by default');
    expect(lines).toHaveLength(0);

    process.env.LOG_LEVEL = 'DEBUG';
    logger.debug('now visible');
    expect(lines).toHaveLength(1);
  });

  it('never lets an ERROR line be filtered out', () => {
    const lines = captureLogLines();
    process.env.LOG_LEVEL = 'ERROR';
    const logger = createLogger(import.meta.url);

    logger.info('dropped');
    logger.error('kept', new Error('boom'));

    expect(lines).toHaveLength(1);
    expect(readLine(lines, 0)).toMatch(/^\[ERROR\]/);
  });

  it('derives the file name from a module URL, a path or a bare name', () => {
    const lines = captureLogLines();

    createLogger('file:///a/b/collect.ts').info('a');
    createLogger('/a/b/verify.ts').info('b');
    createLogger('publish.ts').info('c');

    expect(readLine(lines, 0)).toContain('[collect.ts]');
    expect(readLine(lines, 1)).toContain('[verify.ts]');
    expect(readLine(lines, 2)).toContain('[publish.ts]');
  });
});
