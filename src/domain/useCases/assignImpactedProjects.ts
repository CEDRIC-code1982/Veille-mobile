import type { Category } from '../entities/Category';
import type { ProjectProfile } from '../entities/ProjectProfile';

/**
 * Attaches opaque project codes to an item, by intersecting the item's
 * categories and tags with the declared project profiles.
 *
 * Deliberately deterministic and free of any model involvement: the language
 * model has no idea which projects exist, so it is never asked to guess. With
 * no profile configured, the result is empty rather than invented.
 */

const PROJECT_CODE_PATTERN = /^proj-[a-z0-9-]+$/;

interface AssignImpactedProjectsInput {
  categories: readonly Category[];
  tags: readonly string[];
  profiles: readonly ProjectProfile[];
}

const matchesProfile = (
  profile: ProjectProfile,
  categories: readonly Category[],
  tags: readonly string[],
): boolean => {
  const hasCategory = profile.categories.some((category) => categories.includes(category));

  if (hasCategory) {
    return true;
  }

  const profileTags = profile.tags ?? [];

  return profileTags.some((tag) => tags.includes(tag.toLowerCase()));
};

const assignImpactedProjects = (input: AssignImpactedProjectsInput): string[] => {
  const codes = new Set<string>();

  for (const profile of input.profiles) {
    if (!PROJECT_CODE_PATTERN.test(profile.code)) {
      continue;
    }

    if (matchesProfile(profile, input.categories, input.tags)) {
      codes.add(profile.code);
    }
  }

  return [...codes].sort();
};

export { assignImpactedProjects, PROJECT_CODE_PATTERN };
export type { AssignImpactedProjectsInput };
