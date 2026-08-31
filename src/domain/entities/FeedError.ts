/**
 * Internal item produced when a feed fails or looks mute. It travels with the
 * collected data so that later stages can report it without re-fetching.
 */
interface FeedError {
  feedName: string;
  feedUrl: string;
  reason: string;
  occurredAt: string;
}

export type { FeedError };
