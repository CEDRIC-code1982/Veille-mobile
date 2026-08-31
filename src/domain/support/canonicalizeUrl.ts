/**
 * URL canonicalisation, so that the same article collected twice yields the
 * same identifier.
 *
 * Uses only the standard `URL` global: the domain layer stays dependency-free.
 */

const TRACKING_PARAMETER_PREFIXES = ['utm_', 'mc_', 'at_', 'pk_', 'ref_'];
const TRACKING_PARAMETERS = new Set([
  'fbclid',
  'gclid',
  'igshid',
  'mkt_tok',
  'ref',
  's',
  'source',
  'wt_mc',
]);

const isTrackingParameter = (name: string): boolean => {
  const lowerName = name.toLowerCase();

  if (TRACKING_PARAMETERS.has(lowerName)) {
    return true;
  }

  return TRACKING_PARAMETER_PREFIXES.some((prefix) => lowerName.startsWith(prefix));
};

/**
 * Returns a stable form of a URL: lower-cased host, no fragment, no tracking
 * parameter, sorted query, no trailing slash. Unparsable input is returned
 * trimmed, so a malformed URL still produces a deterministic identifier.
 */
const canonicalizeUrl = (rawUrl: string): string => {
  const trimmed = rawUrl.trim();

  let url: URL;

  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }

  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  url.protocol = url.protocol.toLowerCase();

  const keptParameters: Array<[string, string]> = [];

  for (const [name, value] of url.searchParams.entries()) {
    if (!isTrackingParameter(name)) {
      keptParameters.push([name, value]);
    }
  }

  keptParameters.sort(([leftName], [rightName]) => leftName.localeCompare(rightName));

  const search = new URLSearchParams(keptParameters).toString();
  url.search = search.length > 0 ? `?${search}` : '';

  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }

  return url.toString();
};

export { canonicalizeUrl };
