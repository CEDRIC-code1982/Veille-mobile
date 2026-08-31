import type { Category } from './Category';

/**
 * Rule attaching an opaque project code to the categories that project cares
 * about, from `config/project-profiles.json`.
 *
 * Only opaque codes live here, never a real project name: the code to label
 * mapping stays in `projects.local.json`, which is gitignored. This is what
 * lets `impactedProjects` be computed deterministically in CI without leaking
 * anything.
 */
interface ProjectProfile {
  code: string;
  categories: Category[];
  tags?: string[];
}

export type { ProjectProfile };
