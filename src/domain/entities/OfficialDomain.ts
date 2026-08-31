/**
 * One entry of the first-party whitelist, from `config/official-domains.json`.
 *
 * `pathPrefixes` narrows a host that also carries third-party content: on
 * `github.com`, only the release pages of the projects actually followed here
 * count as first-party.
 */
interface OfficialDomain {
  domain: string;
  pathPrefixes?: string[];
}

export type { OfficialDomain };
