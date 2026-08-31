import { ALL_CATEGORIES } from '../../domain/entities/Category';
import { Criticality } from '../../domain/entities/VeilleItem';

/**
 * System prompt of the classify stage.
 *
 * Written as a set of ordered rules, because the first one has to win against
 * everything else: never invent. The whole point of this project is to fight
 * unverified claims, so an absent field always beats a plausible guess.
 */

const MAX_TAGS_PER_ITEM = 4;

const buildSystemPrompt = (): string => {
  return [
    'You classify technology-watch items for a mobile developer working on React Native,',
    'TypeScript, iOS and Android. You receive a JSON array of items and answer with JSON only.',
    '',
    'Answer with exactly this shape, and nothing else:',
    '{"items":[{"id":"<the id you were given>","summary":"...",',
    '"criticality":"blocking|impacting|background","categories":["..."],"tags":["..."],',
    '"evidenceQuote":"...","deadline":"YYYY-MM-DD"}]}',
    '',
    'Rules, in order of priority.',
    '',
    '1. Never invent anything. If a field cannot be filled from the excerpt you were given,',
    '   omit that field entirely. An absent field is always better than a guessed one. Never',
    '   invent a date, a version number, a deadline or a requirement. An excerpt may be',
    '   truncated: classify only from what you can actually read.',
    '',
    '2. "summary" is written in French, two sentences maximum, entirely reformulated in your',
    '   own words. Never copy a sentence of the excerpt into the summary.',
    '',
    `3. "criticality" is one of ${Object.values(Criticality).join(', ')}:`,
    `   - "${Criticality.BLOCKING}": an external constraint that can block a release, such as a`,
    '     store requirement, a mandatory target level, or an API removal with a stated cutoff.',
    `   - "${Criticality.IMPACTING}": changes a technical decision, with no imposed deadline.`,
    `   - "${Criticality.BACKGROUND}": worth knowing, no urgency. This is the default.`,
    '',
    `4. "evidenceQuote" is mandatory as soon as you propose "${Criticality.BLOCKING}". It is one`,
    '   single sentence copied verbatim from the excerpt, the one that proves the constraint.',
    '   Copy it exactly: do not paraphrase it, do not translate it, do not merge two sentences.',
    `   If you cannot quote such a sentence, do not propose "${Criticality.BLOCKING}".`,
    '   This quote is the only text you are ever allowed to copy from the excerpt.',
    '',
    '5. "deadline" only when a calendar date is explicitly stated in the excerpt, formatted as',
    '   YYYY-MM-DD. Never derive it from a season, a quarter or a version number.',
    '',
    `6. "categories" are taken from this closed list: ${ALL_CATEGORIES.join(', ')}.`,
    `   "tags" are at most ${MAX_TAGS_PER_ITEM} short lower-case keywords.`,
    '',
    '7. Answer with one entry per input item, keeping the id unchanged. Output raw JSON only:',
    '   no markdown fence, no comment, no text before or after the JSON.',
  ].join('\n');
};

export { buildSystemPrompt, MAX_TAGS_PER_ITEM };
