import { describe, expect, it } from "vitest";
import {
  deduplicateByEmail,
  normalizeInvestorRows,
  parseCsv,
} from "../src/services/investorEnrichmentImport";

describe("investor enrichment CSV import", () => {
  it("normalizes enriched rows into verified, matchable investor profiles", () => {
    const rows = parseCsv(
      [
        "first_name,last_name,email,title,company,source,website,linkedin_url,stage_focus,sector_focus,geography,thesis_keywords,check_size_min_usd,check_size_max_usd,firm_canonical,firm_enrichment_status",
        "Rohil,Bagga,rohil@example.com,Vice President,Lightspeed India,apollo,https://lsip.com,https://linkedin.com/company/lightspeed,Seed; Series A; Growth,Consumer; SaaS; Enterprise; AI,India; Southeast Asia,India-specific problems; bold builders,1000000,100000000,Lightspeed India Partners,enriched",
      ].join("\n")
    );

    const normalized = normalizeInvestorRows(rows);

    expect(normalized).toHaveLength(1);
    expect(normalized[0]!).toMatchObject({
      name: "Rohil Bagga",
      firm: "Lightspeed India Partners",
      email: "rohil@example.com",
      website: "https://lsip.com",
      linkedinUrl: "https://linkedin.com/company/lightspeed",
      stageFocus: ["SEED", "SERIES_A", "SERIES_B_PLUS"],
      sectorFocus: ["Consumer", "SaaS", "Enterprise", "AI"],
      geoFocus: ["India", "Southeast Asia"],
      thesisKeywords: ["India-specific problems", "bold builders"],
      checkSizeMinUsd: 1000000,
      checkSizeMaxUsd: 100000000,
      isVerified: true,
      needsEnrichment: false,
    });
  });

  it("keeps not-enriched rows out of matching", () => {
    const normalized = normalizeInvestorRows([
      {
        first_name: "Avelo",
        last_name: "Roy",
        email: "avelo@example.com",
        company: "Kolkata Ventures",
        firm_enrichment_status: "not_enriched",
      },
    ]);

    expect(normalized[0]!.isVerified).toBe(false);
    expect(normalized[0]!.needsEnrichment).toBe(true);
  });

  it("keeps the richer duplicate occurrence", () => {
    const errors: string[] = [];
    const deduped = deduplicateByEmail(
      normalizeInvestorRows([
        {
          first_name: "Test",
          email: "test@example.com",
          company: "Old Firm",
          firm_enrichment_status: "not_enriched",
        },
        {
          first_name: "Test",
          email: "test@example.com",
          company: "New Firm",
          firm_canonical: "Canonical Firm",
          stage_focus: "Seed",
          sector_focus: "SaaS",
          geography: "India",
          firm_enrichment_status: "enriched",
        },
      ]),
      errors
    );

    expect(deduped).toHaveLength(1);
    expect(deduped[0]!.firm).toBe("Canonical Firm");
    expect(deduped[0]!.needsEnrichment).toBe(false);
    expect(errors[0]).toMatch(/duplicate email/i);
  });
});
