import { Criticality, TrustLevel } from '../entities/VeilleItem';
import type { VeilleItem } from '../entities/VeilleItem';
import type { IssueDraft } from '../ports/IssueNotifier';
import type { StaleFeedFinding } from './detectStaleFeeds';

/**
 * Decides what is allowed to interrupt.
 *
 * Two things only: a blocking item whose evidence was actually verified, and a
 * source that has gone mute. Everything else lives on the site and in the weekly
 * digest, where it can be read when there is time for it.
 *
 * Each draft carries a fingerprint, which the notifier embeds in the issue body
 * as a marker: that is what makes the notifications idempotent across runs.
 */

const BLOCKING_LABEL = 'bloquant';
const STALE_LABEL = 'flux-muet';
const BASE_LABEL = 'veille';

interface BuildNotificationsInput {
  items: readonly VeilleItem[];
  staleFeeds: readonly StaleFeedFinding[];
  isPipelineSilent: boolean;
  weekLabel: string;
  daysSinceLastPipelineItem?: number;
}

/** Only a verified blocking item may open an issue. */
const isNotifiable = (item: VeilleItem): boolean => {
  return item.criticality === Criticality.BLOCKING && item.trustLevel === TrustLevel.VERIFIED;
};

const buildBlockingBody = (item: VeilleItem): string => {
  const lines = [
    `**${item.title}**`,
    '',
    item.summary,
    '',
    `- Source : ${item.sourceUrl}`,
    `- Publié le : ${item.publishedAt}`,
  ];

  if (item.deadline !== undefined) {
    lines.push(`- Échéance : ${item.deadline}`);
  }

  if (item.evidenceQuote !== undefined) {
    lines.push('', 'Citation retrouvée dans la source officielle :', '', `> ${item.evidenceQuote}`);
  }

  if (item.impactedProjects.length > 0) {
    lines.push('', `Projets concernés : ${item.impactedProjects.join(', ')}`);
  }

  lines.push(
    '',
    'Cet item est bloquant : sa source est de première partie et sa citation a été retrouvée',
    'dans la page refetchée. Aucune autre combinaison ne peut produire ce niveau.',
  );

  return lines.join('\n');
};

const buildStaleFeedsBody = (
  staleFeeds: readonly StaleFeedFinding[],
  isPipelineSilent: boolean,
  daysSinceLastPipelineItem: number | undefined,
): string => {
  const lines = ['Une ou plusieurs sources ne répondent plus rien de neuf.', ''];

  for (const finding of staleFeeds) {
    const elapsed =
      finding.daysSinceLastItem === undefined
        ? 'aucune activité enregistrée'
        : `${finding.daysSinceLastItem} jour(s) sans rien de neuf`;

    lines.push(`- **${finding.feedName}** : ${elapsed}, seuil configuré ${finding.maxAgeDays} jour(s)`);
  }

  if (isPipelineSilent) {
    const elapsed =
      daysSinceLastPipelineItem === undefined
        ? 'aucun item collecté à ce jour'
        : `${daysSinceLastPipelineItem} jour(s) sans aucun item collecté`;

    lines.push('', `Le pipeline lui-même est silencieux : ${elapsed}.`);
  }

  lines.push(
    '',
    'À vérifier : l’URL a peut-être changé, ou le flux a été retiré.',
    'Lancer `npm run check:feeds` pour confronter chaque source à un vrai fetch.',
  );

  return lines.join('\n');
};

const buildNotifications = (input: BuildNotificationsInput): IssueDraft[] => {
  const drafts: IssueDraft[] = [];

  for (const item of input.items) {
    if (!isNotifiable(item)) {
      continue;
    }

    drafts.push({
      title: `[VEILLE] Bloquant : ${item.title}`,
      body: buildBlockingBody(item),
      labels: [BASE_LABEL, BLOCKING_LABEL],
      fingerprint: `blocking:${item.fingerprint}`,
    });
  }

  if (input.staleFeeds.length === 0 && !input.isPipelineSilent) {
    return drafts;
  }

  // One issue per distinct set of mute sources per week: a recurring silence
  // does not reopen an issue every day, but a newly mute source does.
  const names = input.staleFeeds.map((finding) => finding.feedName).sort();
  const silenceMarker = input.isPipelineSilent ? 'pipeline' : 'feeds';

  drafts.push({
    title: '[VEILLE] Flux muet',
    body: buildStaleFeedsBody(
      input.staleFeeds,
      input.isPipelineSilent,
      input.daysSinceLastPipelineItem,
    ),
    labels: [BASE_LABEL, STALE_LABEL],
    fingerprint: `stale:${silenceMarker}:${input.weekLabel}:${names.join('|')}`,
  });

  return drafts;
};

export { BASE_LABEL, BLOCKING_LABEL, buildNotifications, STALE_LABEL };
export type { BuildNotificationsInput };
