import { Criticality, CRITICALITY_ORDER, TrustLevel } from '../entities/VeilleItem';
import type { VeilleItem } from '../entities/VeilleItem';

/**
 * Renders the weekly markdown digest, meant to be copied straight into a note
 * taking app.
 *
 * The body is written in French because it is read by a human; the code around
 * it stays in English. Nothing is invented: a missing field simply produces no
 * line.
 */

const CRITICALITY_HEADINGS: Record<Criticality, string> = {
  [Criticality.BLOCKING]: 'Bloquant',
  [Criticality.IMPACTING]: 'Impactant',
  [Criticality.BACKGROUND]: 'Veille',
};

const TRUST_LABELS: Record<TrustLevel, string> = {
  [TrustLevel.VERIFIED]: 'vérifié',
  [TrustLevel.REPORTED]: 'rapporté, citation non retrouvée',
  [TrustLevel.UNVERIFIED]: 'non vérifié',
};

const SECTION_ORDER: readonly Criticality[] = [
  Criticality.BLOCKING,
  Criticality.IMPACTING,
  Criticality.BACKGROUND,
];

interface BuildDigestInput {
  items: readonly VeilleItem[];
  weekLabel: string;
  generatedAt: string;
}

const compareItems = (left: VeilleItem, right: VeilleItem): number => {
  const byCriticality =
    CRITICALITY_ORDER[left.criticality] - CRITICALITY_ORDER[right.criticality];

  if (byCriticality !== 0) {
    return byCriticality;
  }

  const byPublication = right.publishedAt.localeCompare(left.publishedAt);

  return byPublication !== 0 ? byPublication : left.title.localeCompare(right.title);
};

/** Renders one item as a markdown block. */
const renderItem = (item: VeilleItem): string => {
  const lines = [`### ${item.title}`, '', item.summary, ''];

  if (item.deadline !== undefined) {
    lines.push(`- Échéance : ${item.deadline}`);
  }

  lines.push(`- Source : [${item.sourceName}](${item.sourceUrl})`);
  lines.push(`- Confiance : ${TRUST_LABELS[item.trustLevel]}`);

  if (item.evidenceQuote !== undefined) {
    lines.push(`- Citation retrouvée : « ${item.evidenceQuote} »`);
  }

  if (item.categories.length > 0) {
    lines.push(`- Catégories : ${item.categories.join(', ')}`);
  }

  if (item.tags.length > 0) {
    lines.push(`- Tags : ${item.tags.join(', ')}`);
  }

  if (item.impactedProjects.length > 0) {
    lines.push(`- Projets concernés : ${item.impactedProjects.join(', ')}`);
  }

  lines.push('');

  return lines.join('\n');
};

const countByCriticality = (items: readonly VeilleItem[], criticality: Criticality): number => {
  return items.filter((item) => item.criticality === criticality).length;
};

const buildDigest = (input: BuildDigestInput): string => {
  const items = [...input.items].sort(compareItems);
  const blockingCount = countByCriticality(items, Criticality.BLOCKING);

  const parts = [
    '---',
    `week: ${input.weekLabel}`,
    `generated: ${input.generatedAt}`,
    `items: ${items.length}`,
    `blocking: ${blockingCount}`,
    'tags: [veille, mobile]',
    '---',
    '',
    `# Veille mobile — ${input.weekLabel}`,
    '',
    `${items.length} item(s) publié(s) cette semaine, dont ${blockingCount} bloquant(s) vérifié(s).`,
    '',
  ];

  for (const criticality of SECTION_ORDER) {
    const sectionItems = items.filter((item) => item.criticality === criticality);
    parts.push(`## ${CRITICALITY_HEADINGS[criticality]}`, '');

    if (sectionItems.length === 0) {
      parts.push('_Aucun item cette semaine._', '');
      continue;
    }

    for (const item of sectionItems) {
      parts.push(renderItem(item));
    }
  }

  return `${parts.join('\n').trimEnd()}\n`;
};

export { buildDigest };
export type { BuildDigestInput };
