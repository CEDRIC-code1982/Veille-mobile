import { SourceFetchStatus } from '../../src/domain/ports/SourceFetcher';
import type { SourceFetcher, SourceFetchResult } from '../../src/domain/ports/SourceFetcher';

/**
 * In-memory `SourceFetcher` for the tests: no test ever touches the network.
 */

interface FakeFetcherOptions {
  responses?: Record<string, string>;
  failures?: Record<string, { status: number; reason: string }>;
}

interface FakeFetcher extends SourceFetcher {
  requestedUrls: string[];
}

const createFakeFetcher = (options: FakeFetcherOptions = {}): FakeFetcher => {
  const requestedUrls: string[] = [];

  return {
    requestedUrls,
    fetchText: (url: string): Promise<SourceFetchResult> => {
      requestedUrls.push(url);

      const failure = options.failures?.[url];

      if (failure !== undefined) {
        return Promise.resolve({
          outcome: SourceFetchStatus.FAILED,
          status: failure.status,
          reason: failure.reason,
        });
      }

      const body = options.responses?.[url];

      if (body === undefined) {
        return Promise.resolve({
          outcome: SourceFetchStatus.FAILED,
          status: 404,
          reason: 'HTTP 404',
        });
      }

      return Promise.resolve({ outcome: SourceFetchStatus.FETCHED, status: 200, text: body });
    },
  };
};

export { createFakeFetcher };
export type { FakeFetcher };
