import { SourceFetchStatus } from '../../domain/ports/SourceFetcher';
import type { SourceFetcher, SourceFetchResult } from '../../domain/ports/SourceFetcher';
import { readIntegerEnv, readOptionalEnv } from '../../shared/env';
import { createLogger } from '../../shared/logger';

/**
 * The single HTTP entry point of the pipeline.
 *
 * A remote failure is a value, never an exception: the collect stage turns it
 * into a feed error and the verify stage turns it into a downgrade. Neither
 * fails the run.
 */

const logger = createLogger(import.meta.url);

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_USER_AGENT = 'veille-mobile-bot';
const MAX_RESPONSE_CHARACTERS = 2_000_000;
const RETRY_DELAY_MS = 1_500;
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const NO_HTTP_RESPONSE = 0;

const delay = (milliseconds: number): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
};

const describeUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return 'unknown transport failure';
};

/** One attempt, with no retry logic of its own. */
const attemptFetch = async (url: string, timeoutMs: number): Promise<SourceFetchResult> => {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'user-agent': readOptionalEnv('VEILLE_USER_AGENT') ?? DEFAULT_USER_AGENT,
        accept: 'application/rss+xml, application/atom+xml, application/xml, text/html;q=0.9, */*;q=0.5',
        'accept-language': 'en',
      },
    });

    if (!response.ok) {
      return {
        outcome: SourceFetchStatus.FAILED,
        status: response.status,
        reason: `HTTP ${response.status}`,
      };
    }

    const body = await response.text();

    return {
      outcome: SourceFetchStatus.FETCHED,
      status: response.status,
      text: body.slice(0, MAX_RESPONSE_CHARACTERS),
    };
  } catch (error) {
    return {
      outcome: SourceFetchStatus.FAILED,
      status: NO_HTTP_RESPONSE,
      reason: describeUnknownError(error),
    };
  }
};

const isRetryable = (result: SourceFetchResult): boolean => {
  if (result.outcome === SourceFetchStatus.FETCHED) {
    return false;
  }

  return result.status === NO_HTTP_RESPONSE || RETRYABLE_STATUSES.has(result.status);
};

/**
 * Fetches a URL as text, retrying once on a transport failure or a status that
 * is worth retrying.
 */
const fetchText = async (url: string): Promise<SourceFetchResult> => {
  const timeoutMs = readIntegerEnv('VEILLE_HTTP_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
  const first = await attemptFetch(url, timeoutMs);

  if (!isRetryable(first)) {
    return first;
  }

  logger.debug(`retrying ${url} once after ${first.outcome} response`);
  await delay(RETRY_DELAY_MS);

  return attemptFetch(url, timeoutMs);
};

const createHttpSourceFetcher = (): SourceFetcher => {
  return { fetchText };
};

export { createHttpSourceFetcher, fetchText, MAX_RESPONSE_CHARACTERS };
