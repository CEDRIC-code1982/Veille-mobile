import type { CollectedItem } from '../../domain/entities/CollectedItem';
import { buildSystemPrompt } from './systemPrompt';

/**
 * Builds the request file read by the scheduled routine.
 *
 * The routine is itself a language model, so instead of calling the Messages
 * API this pipeline hands it one file to read and asks for one file in return.
 * The rules come from `buildSystemPrompt`, the very same text the API path
 * sends, so the two paths cannot drift apart.
 */

interface ClassificationRequest {
  dayLabel: string;
  items: readonly CollectedItem[];
  proposalsPath: string;
}

/** Only the fields the model needs; nothing about the local context leaks. */
const toRequestItem = (item: CollectedItem): Record<string, unknown> => {
  return {
    id: item.id,
    title: item.title,
    sourceName: item.sourceName,
    sourceUrl: item.sourceUrl,
    publishedAt: item.publishedAt,
    feedCategories: item.categories,
    excerpt: item.excerpt,
  };
};

const buildClassificationRequest = (request: ClassificationRequest): string => {
  const payload = JSON.stringify({ items: request.items.map(toRequestItem) }, null, 2);

  return [
    `# Classification à produire pour ${request.dayLabel}`,
    '',
    `${request.items.length} item(s) à classer.`,
    '',
    '## Ce que tu dois faire',
    '',
    `Écris le fichier \`${request.proposalsPath}\` avec, pour chaque item ci-dessous, une`,
    'proposition conforme aux règles de la section suivante. Rien d\'autre : pas de commentaire,',
    'pas de fichier annexe.',
    '',
    'Un item que tu ne peux pas classer honnêtement doit être omis du fichier : il sera',
    'automatiquement publié en `background` / `unverified`, ce qui est le comportement voulu.',
    'Omettre vaut toujours mieux que deviner.',
    '',
    '## Règles',
    '',
    '```text',
    buildSystemPrompt(),
    '```',
    '',
    '## Items',
    '',
    '```json',
    payload,
    '```',
    '',
  ].join('\n');
};

export { buildClassificationRequest, toRequestItem };
export type { ClassificationRequest };
