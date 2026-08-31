/**
 * Watchdog over the pipeline itself.
 *
 * The daily run is driven by a scheduled routine on a personal machine, so a
 * machine that stays off, a broken routine or a revoked credential would all
 * produce the same thing: silence. And silence is exactly the failure this
 * project cannot afford, because a watch that stopped feels identical to a watch
 * with nothing to report.
 *
 * This check reads only `data/index.json`. It never collects, never classifies,
 * never publishes, and needs no API key: it compares the last collection date to
 * now and opens one issue per week while the pipeline stays mute.
 */

import { detectStaleFeeds } from '../domain/useCases/detectStaleFeeds';
import { toIsoWeekLabel } from '../domain/support/isoWeek';
import { IssueOutcome } from '../domain/ports/IssueNotifier';
import type { IssueDraft, IssueNotifier } from '../domain/ports/IssueNotifier';
import {
  createGitHubIssueNotifier,
  createNoopIssueNotifier,
} from '../data/github/GitHubIssueNotifier';
import { BASE_LABEL } from '../domain/useCases/buildNotifications';
import { readIntegerEnv, readOptionalEnv } from '../shared/env';
import { readOptionalJsonFile } from '../shared/jsonStore';
import { createLogger } from '../shared/logger';
import { PATHS } from '../shared/paths';
import { siteIndexSchema } from '../shared/schemas/publication';
import { systemClock } from '../shared/systemClock';

const logger = createLogger(import.meta.url);

const DEFAULT_SILENCE_DAYS = 3;
const SILENCE_LABEL = 'pipeline-silencieux';

const buildDraft = (
  weekLabel: string,
  lastCollectedAt: string,
  daysSince: number | undefined,
): IssueDraft => {
  const elapsed =
    daysSince === undefined ? 'depuis une date illisible' : `depuis ${daysSince} jour(s)`;

  return {
    title: '[VEILLE] Pipeline silencieux',
    body: [
      `La dernière collecte enregistrée date de \`${lastCollectedAt}\`, soit ${elapsed}.`,
      '',
      'La routine planifiée qui pilote le pipeline ne publie plus. Pistes, de la plus',
      'probable à la moins probable :',
      '',
      '- la machine qui héberge la routine est restée éteinte ;',
      '- la routine est désactivée ou en erreur ;',
      "- le `git push` échoue (droits, clé, branche divergente) ;",
      '- toutes les sources sont muettes en même temps, ce qui serait très inhabituel.',
      '',
      'Cette vérification ne collecte rien et ne publie rien : elle lit seulement',
      '`data/index.json`. Elle rouvrira une issue par semaine tant que le silence dure.',
    ].join('\n'),
    labels: [BASE_LABEL, SILENCE_LABEL],
    fingerprint: `heartbeat:${weekLabel}`,
  };
};

/** Builds the notifier, inert when the run has no repository credentials. */
const buildNotifier = (): IssueNotifier => {
  const token = readOptionalEnv('GITHUB_TOKEN');
  const repository = readOptionalEnv('GITHUB_REPOSITORY');
  const [owner, name] = (repository ?? '').split('/');

  if (token === undefined || owner === undefined || name === undefined || name.length === 0) {
    logger.info('no repository credentials, the watchdog only reports to the log');

    return createNoopIssueNotifier();
  }

  return createGitHubIssueNotifier({ token, owner, repository: name, baseLabel: BASE_LABEL });
};

const main = async (): Promise<void> => {
  const index = readOptionalJsonFile(PATHS.siteIndex, siteIndexSchema);

  if (index === undefined) {
    logger.warn('no data/index.json yet: nothing has ever been published, nothing to watch');

    return;
  }

  const lastCollectedAt = index.lastCollectedAt;

  if (lastCollectedAt === undefined) {
    logger.warn('the site index carries no collection date, nothing to compare');

    return;
  }

  const now = systemClock.now();
  const silenceDays = readIntegerEnv('VEILLE_HEARTBEAT_SILENCE_DAYS', DEFAULT_SILENCE_DAYS);
  const report = detectStaleFeeds({
    feeds: [],
    activities: [],
    now,
    pipelineSilenceDays: silenceDays,
    lastPipelineItemAt: lastCollectedAt,
  });

  if (!report.isPipelineSilent) {
    logger.info(
      `pipeline alive: last collection ${lastCollectedAt}, ` +
        `${report.daysSinceLastPipelineItem ?? 0} day(s) ago, threshold ${silenceDays}`,
    );

    return;
  }

  logger.warn(
    `pipeline silent since ${lastCollectedAt}, more than ${silenceDays} day(s), opening an issue`,
  );

  const outcome = await buildNotifier().ensureIssue(
    buildDraft(toIsoWeekLabel(now), lastCollectedAt, report.daysSinceLastPipelineItem),
  );

  if (outcome === IssueOutcome.FAILED) {
    logger.error(
      'the watchdog could not open its issue',
      new Error('issue creation failed, see the warnings above'),
    );
    process.exitCode = 1;
  }
};

await main();
