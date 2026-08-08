import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import {
  deduplicateByEmail,
  normalizeInvestorRows,
  parseCsv,
} from "../src/services/investorEnrichmentImport";

dotenv.config();

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: npx tsx scripts/importInvestors.ts path/to/vc_contacts.csv");
    process.exit(1);
    return;
  }

  const resolvedPath = path.resolve(inputPath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`File not found: ${resolvedPath}`);
    process.exit(1);
    return;
  }

  const rawRows = parseCsv(fs.readFileSync(resolvedPath, "utf-8"));
  const errors: string[] = [];
  const normalized = normalizeInvestorRows(rawRows, errors);
  const deduped = deduplicateByEmail(normalized, errors);
  const enrichedRows = deduped.filter((row) => row.isVerified && !row.needsEnrichment);
  const rowsToImport = enrichedRows.length > 0 ? enrichedRows : deduped;
  const { pool } = await import("../src/lib/db");

  let inserted = 0;
  let updated = 0;
  let enriched = 0;
  let stillNeedsEnrichment = 0;

  for (const row of rowsToImport) {
    const result = await pool.query(
      `INSERT INTO investors
        (name, firm, email, title, linkedin_url, website, source, stage_focus, sector_focus, geo_focus,
         check_size_min_usd, check_size_max_usd, thesis_keywords, is_verified, needs_enrichment, source_verified_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now())
       ON CONFLICT (email) DO UPDATE SET
         name = EXCLUDED.name,
         firm = EXCLUDED.firm,
         title = COALESCE(EXCLUDED.title, investors.title),
         linkedin_url = COALESCE(EXCLUDED.linkedin_url, investors.linkedin_url),
         website = COALESCE(EXCLUDED.website, investors.website),
         source = COALESCE(EXCLUDED.source, investors.source),
         stage_focus = CASE
           WHEN cardinality(EXCLUDED.stage_focus) > 0 THEN EXCLUDED.stage_focus
           ELSE investors.stage_focus
         END,
         sector_focus = CASE
           WHEN cardinality(EXCLUDED.sector_focus) > 0 THEN EXCLUDED.sector_focus
           ELSE investors.sector_focus
         END,
         geo_focus = CASE
           WHEN cardinality(EXCLUDED.geo_focus) > 0 THEN EXCLUDED.geo_focus
           ELSE investors.geo_focus
         END,
         check_size_min_usd = COALESCE(EXCLUDED.check_size_min_usd, investors.check_size_min_usd),
         check_size_max_usd = COALESCE(EXCLUDED.check_size_max_usd, investors.check_size_max_usd),
         thesis_keywords = CASE
           WHEN cardinality(EXCLUDED.thesis_keywords) > 0 THEN EXCLUDED.thesis_keywords
           ELSE investors.thesis_keywords
         END,
         is_verified = investors.is_verified OR EXCLUDED.is_verified,
         needs_enrichment = investors.needs_enrichment AND EXCLUDED.needs_enrichment,
         source_verified_at = CASE
           WHEN EXCLUDED.is_verified THEN now()
           ELSE investors.source_verified_at
         END
       RETURNING (xmax = 0) AS inserted, is_verified, needs_enrichment`,
      [
        row.name,
        row.firm,
        row.email,
        row.title,
        row.linkedinUrl,
        row.website,
        row.source,
        row.stageFocus,
        row.sectorFocus,
        row.geoFocus,
        row.checkSizeMinUsd,
        row.checkSizeMaxUsd,
        row.thesisKeywords,
        row.isVerified,
        row.needsEnrichment,
      ]
    );

    const saved = result.rows[0];
    if (saved.inserted) inserted++;
    else updated++;
    if (saved.is_verified && !saved.needs_enrichment) enriched++;
    else stillNeedsEnrichment++;
  }

  const summary = await pool.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE is_verified = true AND needs_enrichment = false)::int AS matchable,
       COUNT(*) FILTER (WHERE needs_enrichment = true)::int AS needs_enrichment
     FROM investors`
  );

  console.log("\n--- Import summary ---");
  console.log(`Rows read:              ${rawRows.length}`);
  console.log(`Valid, deduped:         ${deduped.length}`);
  console.log(`Rows imported:          ${rowsToImport.length}`);
  if (enrichedRows.length > 0) {
    console.log(`Skipped unenriched:     ${deduped.length - enrichedRows.length}`);
  }
  console.log(`Inserted:               ${inserted}`);
  console.log(`Updated:                ${updated}`);
  console.log(`Matchable in this file: ${enriched}`);
  console.log(`Still needs enrichment: ${stillNeedsEnrichment}`);
  console.log(`Warnings/errors:        ${errors.length}`);
  console.log("\n--- Database summary ---");
  console.log(`Total investors:        ${summary.rows[0].total}`);
  console.log(`Matchable investors:    ${summary.rows[0].matchable}`);
  console.log(`Needs enrichment:       ${summary.rows[0].needs_enrichment}`);

  if (errors.length > 0) {
    console.log("\n--- First 20 warnings ---");
    errors.slice(0, 20).forEach((error) => console.log(`  ${error}`));
    if (errors.length > 20) console.log(`  ...and ${errors.length - 20} more`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
