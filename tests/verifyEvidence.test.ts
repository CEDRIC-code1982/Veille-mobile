import { describe, expect, it } from 'vitest';

import { Criticality, TrustLevel } from '../src/domain/entities/VeilleItem';
import { EvidenceCheck, verifyEvidence } from '../src/domain/useCases/verifyEvidence';
import { TEST_OFFICIAL_DOMAINS } from './helpers/factories';

const OFFICIAL_URL = 'https://developer.android.com/example/behavior-changes';
const THIRD_PARTY_URL = 'https://some-blog.example.invalid/post';
const QUOTE = 'Apps targeting the new level must declare the permission';

describe('verifyEvidence, promotion rule', () => {
  it('grants blocking when domain, quote and refetch all agree', () => {
    const result = verifyEvidence({
      proposedCriticality: Criticality.BLOCKING,
      sourceUrl: OFFICIAL_URL,
      officialDomains: TEST_OFFICIAL_DOMAINS,
      evidenceCheck: EvidenceCheck.QUOTE_FOUND,
      evidenceQuote: QUOTE,
    });

    expect(result).toEqual({
      criticality: Criticality.BLOCKING,
      trustLevel: TrustLevel.VERIFIED,
      downgraded: false,
      reason: 'evidence quote found again in the first-party source',
    });
  });

  it('downgrades when the quote cannot be found in the refetched page', () => {
    const result = verifyEvidence({
      proposedCriticality: Criticality.BLOCKING,
      sourceUrl: OFFICIAL_URL,
      officialDomains: TEST_OFFICIAL_DOMAINS,
      evidenceCheck: EvidenceCheck.QUOTE_MISSING,
      evidenceQuote: QUOTE,
    });

    expect(result.criticality).toBe(Criticality.IMPACTING);
    expect(result.trustLevel).toBe(TrustLevel.UNVERIFIED);
    expect(result.downgraded).toBe(true);
    expect(result.reason).toContain('not found in the refetched source');
  });

  it('downgrades when the domain is not whitelisted, even with a found quote', () => {
    const result = verifyEvidence({
      proposedCriticality: Criticality.BLOCKING,
      sourceUrl: THIRD_PARTY_URL,
      officialDomains: TEST_OFFICIAL_DOMAINS,
      evidenceCheck: EvidenceCheck.QUOTE_FOUND,
      evidenceQuote: QUOTE,
    });

    expect(result.criticality).toBe(Criticality.IMPACTING);
    expect(result.trustLevel).toBe(TrustLevel.UNVERIFIED);
    expect(result.downgraded).toBe(true);
    expect(result.reason).toContain('not first-party');
  });

  it('downgrades when the source could not be refetched at all', () => {
    const result = verifyEvidence({
      proposedCriticality: Criticality.BLOCKING,
      sourceUrl: OFFICIAL_URL,
      officialDomains: TEST_OFFICIAL_DOMAINS,
      evidenceCheck: EvidenceCheck.FETCH_FAILED,
      evidenceQuote: QUOTE,
    });

    expect(result.criticality).toBe(Criticality.IMPACTING);
    expect(result.trustLevel).toBe(TrustLevel.UNVERIFIED);
    expect(result.downgraded).toBe(true);
    expect(result.reason).toContain('could not be refetched');
  });

  it('downgrades a blocking proposal that comes without any quote', () => {
    const result = verifyEvidence({
      proposedCriticality: Criticality.BLOCKING,
      sourceUrl: OFFICIAL_URL,
      officialDomains: TEST_OFFICIAL_DOMAINS,
      evidenceCheck: EvidenceCheck.NOT_CHECKED,
    });

    expect(result.criticality).toBe(Criticality.IMPACTING);
    expect(result.reason).toContain('no evidence quote provided');
  });

  it('treats a blank quote as no quote at all', () => {
    const result = verifyEvidence({
      proposedCriticality: Criticality.BLOCKING,
      sourceUrl: OFFICIAL_URL,
      officialDomains: TEST_OFFICIAL_DOMAINS,
      evidenceCheck: EvidenceCheck.QUOTE_FOUND,
      evidenceQuote: '   ',
    });

    expect(result.criticality).toBe(Criticality.IMPACTING);
    expect(result.reason).toContain('no evidence quote provided');
  });

  it('downgrades a quote too short to prove anything', () => {
    const result = verifyEvidence({
      proposedCriticality: Criticality.BLOCKING,
      sourceUrl: OFFICIAL_URL,
      officialDomains: TEST_OFFICIAL_DOMAINS,
      evidenceCheck: EvidenceCheck.QUOTE_TOO_SHORT,
      evidenceQuote: 'must',
    });

    expect(result.criticality).toBe(Criticality.IMPACTING);
    expect(result.trustLevel).toBe(TrustLevel.UNVERIFIED);
    expect(result.downgraded).toBe(true);
  });

  it('never promotes an item above what the model proposed', () => {
    const result = verifyEvidence({
      proposedCriticality: Criticality.BACKGROUND,
      sourceUrl: OFFICIAL_URL,
      officialDomains: TEST_OFFICIAL_DOMAINS,
      evidenceCheck: EvidenceCheck.QUOTE_FOUND,
      evidenceQuote: QUOTE,
    });

    expect(result.criticality).toBe(Criticality.BACKGROUND);
    expect(result.trustLevel).toBe(TrustLevel.VERIFIED);
  });
});

describe('verifyEvidence, trust level of non-blocking items', () => {
  it('marks a first-party item with a found quote as verified', () => {
    const result = verifyEvidence({
      proposedCriticality: Criticality.IMPACTING,
      sourceUrl: OFFICIAL_URL,
      officialDomains: TEST_OFFICIAL_DOMAINS,
      evidenceCheck: EvidenceCheck.QUOTE_FOUND,
      evidenceQuote: QUOTE,
    });

    expect(result.trustLevel).toBe(TrustLevel.VERIFIED);
    expect(result.downgraded).toBe(false);
  });

  it('marks a first-party item whose quote is unfindable as reported', () => {
    const result = verifyEvidence({
      proposedCriticality: Criticality.IMPACTING,
      sourceUrl: OFFICIAL_URL,
      officialDomains: TEST_OFFICIAL_DOMAINS,
      evidenceCheck: EvidenceCheck.QUOTE_MISSING,
      evidenceQuote: QUOTE,
    });

    expect(result.criticality).toBe(Criticality.IMPACTING);
    expect(result.trustLevel).toBe(TrustLevel.REPORTED);
    expect(result.downgraded).toBe(false);
  });

  it('marks a first-party item with no quote at all as reported', () => {
    const result = verifyEvidence({
      proposedCriticality: Criticality.BACKGROUND,
      sourceUrl: OFFICIAL_URL,
      officialDomains: TEST_OFFICIAL_DOMAINS,
      evidenceCheck: EvidenceCheck.NOT_CHECKED,
    });

    expect(result.trustLevel).toBe(TrustLevel.REPORTED);
  });

  it('marks any third-party item as unverified, whatever the check said', () => {
    for (const check of [EvidenceCheck.QUOTE_FOUND, EvidenceCheck.QUOTE_MISSING]) {
      const result = verifyEvidence({
        proposedCriticality: Criticality.BACKGROUND,
        sourceUrl: THIRD_PARTY_URL,
        officialDomains: TEST_OFFICIAL_DOMAINS,
        evidenceCheck: check,
        evidenceQuote: QUOTE,
      });

      expect(result.trustLevel).toBe(TrustLevel.UNVERIFIED);
      expect(result.criticality).toBe(Criticality.BACKGROUND);
    }
  });
});
