import { IssueOutcome } from '../../domain/ports/IssueNotifier';
import type { IssueDraft, IssueNotifier } from '../../domain/ports/IssueNotifier';
import { createLogger } from '../../shared/logger';

/**
 * Opens issues on the repository, idempotently.
 *
 * The fingerprint is written into the issue body as an HTML comment marker, and
 * every existing issue carrying the base label is scanned for it before
 * creating anything. That is what keeps a daily run from reopening the same
 * issue forever.
 *
 * Without a token the notifier is inert rather than broken: a local run of the
 * pipeline must not need repository credentials.
 */

const logger = createLogger(import.meta.url);

const GITHUB_API_ROOT = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const ISSUES_PER_PAGE = 100;
const MAX_SCANNED_PAGES = 5;
const REQUEST_TIMEOUT_MS = 20_000;
const LABEL_ALREADY_EXISTS_STATUS = 422;

interface GitHubNotifierOptions {
  token: string;
  owner: string;
  repository: string;
  baseLabel: string;
}

const buildMarker = (fingerprint: string): string => {
  return `<!-- veille-fingerprint: ${fingerprint} -->`;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

/** Reads the `body` field of every issue in an API page. */
const readIssueBodies = (payload: unknown): string[] => {
  if (!Array.isArray(payload)) {
    return [];
  }

  const bodies: string[] = [];

  for (const entry of payload) {
    if (!isRecord(entry)) {
      continue;
    }

    const body = entry['body'];

    if (typeof body === 'string') {
      bodies.push(body);
    }
  }

  return bodies;
};

const createGitHubIssueNotifier = (options: GitHubNotifierOptions): IssueNotifier => {
  const repositoryPath = `${options.owner}/${options.repository}`;

  const request = async (path: string, init: RequestInit = {}): Promise<Response> => {
    return fetch(`${GITHUB_API_ROOT}${path}`, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${options.token}`,
        'x-github-api-version': API_VERSION,
        'content-type': 'application/json',
      },
    });
  };

  /** Creates the label when it is missing; an existing label is not an error. */
  const ensureLabel = async (name: string): Promise<void> => {
    const response = await request(`/repos/${repositoryPath}/labels`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });

    if (response.ok || response.status === LABEL_ALREADY_EXISTS_STATUS) {
      return;
    }

    logger.warn(`could not ensure label ${name}: HTTP ${response.status}`);
  };

  const hasIssueWithMarker = async (marker: string): Promise<boolean> => {
    for (let page = 1; page <= MAX_SCANNED_PAGES; page += 1) {
      const response = await request(
        `/repos/${repositoryPath}/issues?state=all&labels=${encodeURIComponent(options.baseLabel)}` +
          `&per_page=${ISSUES_PER_PAGE}&page=${page}`,
      );

      if (!response.ok) {
        logger.warn(`could not list existing issues: HTTP ${response.status}`);

        return false;
      }

      const payload: unknown = await response.json();
      const bodies = readIssueBodies(payload);

      if (bodies.some((body) => body.includes(marker))) {
        return true;
      }

      if (bodies.length < ISSUES_PER_PAGE) {
        return false;
      }
    }

    return false;
  };

  const ensureIssue = async (draft: IssueDraft): Promise<IssueOutcome> => {
    const marker = buildMarker(draft.fingerprint);

    try {
      if (await hasIssueWithMarker(marker)) {
        logger.info(`issue already exists for ${draft.fingerprint}`);

        return IssueOutcome.ALREADY_EXISTS;
      }

      for (const label of draft.labels) {
        await ensureLabel(label);
      }

      const response = await request(`/repos/${repositoryPath}/issues`, {
        method: 'POST',
        body: JSON.stringify({
          title: draft.title,
          body: `${draft.body}\n\n${marker}`,
          labels: draft.labels,
        }),
      });

      if (!response.ok) {
        logger.warn(`could not create the issue for ${draft.fingerprint}: HTTP ${response.status}`);

        return IssueOutcome.FAILED;
      }

      logger.info(`opened an issue for ${draft.fingerprint}`);

      return IssueOutcome.CREATED;
    } catch (error) {
      logger.error(`the issue request failed for ${draft.fingerprint}`, error);

      return IssueOutcome.FAILED;
    }
  };

  return { ensureIssue };
};

/** Inert notifier used when no repository token is available. */
const createNoopIssueNotifier = (): IssueNotifier => {
  return {
    ensureIssue: (draft: IssueDraft): Promise<IssueOutcome> => {
      logger.info(`notifications disabled, would have opened: ${draft.title}`);

      return Promise.resolve(IssueOutcome.ALREADY_EXISTS);
    },
  };
};

export { buildMarker, createGitHubIssueNotifier, createNoopIssueNotifier };
export type { GitHubNotifierOptions };
