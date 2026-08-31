import type { Category } from '../entities/Category';
import type { CollectedItem } from '../entities/CollectedItem';
import type { Criticality } from '../entities/VeilleItem';

/**
 * What the language model proposes for one item. It is only a proposal: the
 * classify stage never decides publication, and `verifyEvidence` may downgrade
 * any of it.
 */
interface ClassificationProposal {
  summary: string;
  criticality: Criticality;
  categories: Category[];
  tags: string[];
  evidenceQuote?: string;
  deadline?: string;
}

const ClassificationStatus = {
  CLASSIFIED: 'classified',
  FAILED: 'failed',
} as const;
type ClassificationStatus = typeof ClassificationStatus[keyof typeof ClassificationStatus];

type ClassificationOutcome =
  | {
      itemId: string;
      status: typeof ClassificationStatus.CLASSIFIED;
      proposal: ClassificationProposal;
    }
  | { itemId: string; status: typeof ClassificationStatus.FAILED; reason: string };

interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

interface ClassificationRun {
  outcomes: ClassificationOutcome[];
  usage: LlmUsage;
}

/**
 * Classifies a batch of items in a single call. Implementations must degrade
 * instead of throwing: an unparsable answer yields `FAILED` outcomes.
 */
interface LlmClassifier {
  classifyBatch: (items: CollectedItem[]) => Promise<ClassificationRun>;
}

export { ClassificationStatus };
export type {
  ClassificationOutcome,
  ClassificationProposal,
  ClassificationRun,
  LlmClassifier,
  LlmUsage,
};
