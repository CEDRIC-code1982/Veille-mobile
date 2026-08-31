import { z } from 'zod';

import { criticalitySchema } from './common';

/**
 * Contract for the model answer.
 *
 * Unknown keys are tolerated and stripped, and free-text fields stay untyped
 * strings on purpose: an unknown category or a malformed deadline is filtered
 * downstream instead of failing the whole batch. Only the criticality is
 * strictly typed, because an unusable value there means the answer is unusable.
 */

const llmProposalSchema = z.object({
  id: z.string().min(1),
  summary: z.string().min(1),
  criticality: criticalitySchema,
  categories: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  evidenceQuote: z.string().optional(),
  deadline: z.string().optional(),
});

const llmResponseSchema = z.object({
  items: z.array(llmProposalSchema),
});

type LlmProposalDto = z.infer<typeof llmProposalSchema>;

export { llmProposalSchema, llmResponseSchema };
export type { LlmProposalDto };
