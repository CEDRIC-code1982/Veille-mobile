import type { Category } from './Category';

/**
 * A recurring external deadline, maintained by hand in
 * `config/deadlines.json`. Nothing in the pipeline invents one.
 */
interface Deadline {
  code: string;
  label: string;
  dueDate: string;
  categories: Category[];
  sourceUrl: string;
  note?: string;
}

export type { Deadline };
