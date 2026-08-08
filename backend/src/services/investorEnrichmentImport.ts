const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface RawInvestorCsvRow {
  [key: string]: string | undefined;
}

export interface NormalizedInvestorImportRow {
  name: string;
  firm: string;
  email: string;
  title: string | null;
  source: string | null;
  website: string | null;
  linkedinUrl: string | null;
  stageFocus: string[];
  sectorFocus: string[];
  geoFocus: string[];
  thesisKeywords: string[];
  checkSizeMinUsd: number | null;
  checkSizeMaxUsd: number | null;
  isVerified: boolean;
  needsEnrichment: boolean;
}

const STAGE_ALIASES: Record<string, string> = {
  idea: "IDEA",
  preseed: "PRE_SEED",
  "pre seed": "PRE_SEED",
  "pre-seed": "PRE_SEED",
  seed: "SEED",
  "series a": "SERIES_A",
  seriesa: "SERIES_A",
  "series b": "SERIES_B_PLUS",
  "series b+": "SERIES_B_PLUS",
  "series b plus": "SERIES_B_PLUS",
  "series c": "SERIES_B_PLUS",
  "series d": "SERIES_B_PLUS",
  growth: "SERIES_B_PLUS",
  late: "SERIES_B_PLUS",
};

export function parseCsv(content: string): RawInvestorCsvRow[] {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const headerLine = lines[0];
  if (!headerLine) return [];

  const headers = parseCsvLine(headerLine).map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row: RawInvestorCsvRow = {};
    headers.forEach((header, i) => {
      row[header] = cells[i] ?? "";
    });
    return row;
  });
}

export function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current.trim());
  return cells;
}

export function normalizeInvestorRows(rawRows: RawInvestorCsvRow[], errors: string[] = []): NormalizedInvestorImportRow[] {
  return rawRows.flatMap((row, idx) => {
    const lineNumber = idx + 2;
    const firstName = value(row.first_name_clean) || value(row.first_name);
    const lastName = value(row.last_name);
    const email = value(row.email).toLowerCase();
    const firm = value(row.firm_canonical) || value(row.company);

    if (!firstName || !email || !firm) {
      errors.push(`Line ${lineNumber}: missing required field (first_name/email/company) - skipped`);
      return [];
    }
    if (!EMAIL_REGEX.test(email)) {
      errors.push(`Line ${lineNumber}: invalid email "${row.email}" - skipped`);
      return [];
    }

    const stageFocus = splitList(row.stage_focus).map(normalizeStage).filter((stage): stage is string => !!stage);
    const sectorFocus = splitList(row.sector_focus);
    const geoFocus = splitList(row.geography);
    const thesisKeywords = splitList(row.thesis_keywords);
    const checkSizeMinUsd = parsePositiveInteger(row.check_size_min_usd);
    const checkSizeMaxUsd = parsePositiveInteger(row.check_size_max_usd);
    const enrichmentStatus = value(row.firm_enrichment_status).toLowerCase();
    const hasEnrichment =
      enrichmentStatus === "enriched" ||
      stageFocus.length > 0 ||
      sectorFocus.length > 0 ||
      geoFocus.length > 0 ||
      thesisKeywords.length > 0 ||
      checkSizeMinUsd != null ||
      checkSizeMaxUsd != null;

    return [
      {
        name: lastName ? `${firstName} ${lastName}` : firstName,
        firm,
        email,
        title: value(row.title) || null,
        source: value(row.source) || null,
        website: value(row.website) || null,
        linkedinUrl: value(row.linkedin_url) || null,
        stageFocus,
        sectorFocus,
        geoFocus,
        thesisKeywords,
        checkSizeMinUsd,
        checkSizeMaxUsd,
        isVerified: hasEnrichment,
        needsEnrichment: !hasEnrichment,
      },
    ];
  });
}

export function deduplicateByEmail(rows: NormalizedInvestorImportRow[], errors: string[] = []): NormalizedInvestorImportRow[] {
  const seen = new Map<string, NormalizedInvestorImportRow>();
  for (const row of rows) {
    const existing = seen.get(row.email);
    if (!existing) {
      seen.set(row.email, row);
      continue;
    }
    errors.push(`Duplicate email "${row.email}" - kept richer occurrence`);
    seen.set(row.email, chooseRicherInvestorRow(existing, row));
  }
  return [...seen.values()];
}

function chooseRicherInvestorRow(a: NormalizedInvestorImportRow, b: NormalizedInvestorImportRow): NormalizedInvestorImportRow {
  return richnessScore(b) > richnessScore(a) ? b : a;
}

function richnessScore(row: NormalizedInvestorImportRow): number {
  return (
    row.stageFocus.length * 3 +
    row.sectorFocus.length * 3 +
    row.geoFocus.length * 2 +
    row.thesisKeywords.length +
    (row.checkSizeMinUsd != null ? 2 : 0) +
    (row.checkSizeMaxUsd != null ? 2 : 0) +
    (row.website ? 1 : 0) +
    (row.linkedinUrl ? 1 : 0)
  );
}

function splitList(input: string | undefined): string[] {
  return (input ?? "")
    .split(/[;|]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, all) => all.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index);
}

function normalizeStage(input: string): string | null {
  const key = input.toLowerCase().replace(/[_]+/g, " ").trim();
  return STAGE_ALIASES[key] ?? null;
}

function parsePositiveInteger(input: string | undefined): number | null {
  const normalized = value(input).replace(/[$,\s]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed);
}

function value(input: string | undefined): string {
  return (input ?? "").trim();
}
