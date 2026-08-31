/**
 * Opens the only notifications allowed to interrupt: verified blocking items
 * and mute feeds.
 *
 * Idempotency is carried by `fingerprint`, which the implementation embeds in
 * the issue body as a machine-readable marker.
 */
const IssueOutcome = {
  CREATED: 'created',
  ALREADY_EXISTS: 'already-exists',
  FAILED: 'failed',
} as const;
type IssueOutcome = typeof IssueOutcome[keyof typeof IssueOutcome];

interface IssueDraft {
  title: string;
  body: string;
  labels: string[];
  fingerprint: string;
}

interface IssueNotifier {
  ensureIssue: (draft: IssueDraft) => Promise<IssueOutcome>;
}

export { IssueOutcome };
export type { IssueDraft, IssueNotifier };
