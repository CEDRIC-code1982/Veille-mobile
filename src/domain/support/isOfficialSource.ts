import type { OfficialDomain } from '../entities/OfficialDomain';

/**
 * First-party check behind the trust rule.
 *
 * A third-party blog can never produce a blocking item, so this is the first of
 * the three conditions checked by `verifyEvidence`.
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

const matchesHost = (hostname: string, domain: string): boolean => {
  const lowerHost = hostname.toLowerCase();
  const lowerDomain = domain.toLowerCase();

  return lowerHost === lowerDomain || lowerHost.endsWith(`.${lowerDomain}`);
};

const matchesPath = (pathname: string, pathPrefixes: string[] | undefined): boolean => {
  if (pathPrefixes === undefined || pathPrefixes.length === 0) {
    return true;
  }

  const lowerPath = pathname.toLowerCase();

  return pathPrefixes.some((prefix) => lowerPath.startsWith(prefix.toLowerCase()));
};

/** Tells whether a URL belongs to the first-party whitelist. */
const isOfficialSource = (rawUrl: string, whitelist: readonly OfficialDomain[]): boolean => {
  let url: URL;

  try {
    url = new URL(rawUrl.trim());
  } catch {
    return false;
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol.toLowerCase())) {
    return false;
  }

  for (const entry of whitelist) {
    if (matchesHost(url.hostname, entry.domain) && matchesPath(url.pathname, entry.pathPrefixes)) {
      return true;
    }
  }

  return false;
};

export { isOfficialSource };
