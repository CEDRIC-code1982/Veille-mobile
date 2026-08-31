/**
 * Refetches an official source during verification.
 *
 * A failure is a normal outcome, not an exception: a 404 downgrades an item, it
 * does not break the run. `status` is 0 when no HTTP response was obtained at
 * all.
 */
const SourceFetchStatus = {
  FETCHED: 'fetched',
  FAILED: 'failed',
} as const;
type SourceFetchStatus = typeof SourceFetchStatus[keyof typeof SourceFetchStatus];

type SourceFetchResult =
  | { outcome: typeof SourceFetchStatus.FETCHED; status: number; text: string }
  | { outcome: typeof SourceFetchStatus.FAILED; status: number; reason: string };

interface SourceFetcher {
  fetchText: (url: string) => Promise<SourceFetchResult>;
}

export { SourceFetchStatus };
export type { SourceFetcher, SourceFetchResult };
