import type { FieldKey, Mapping, ResumeJob, TableRow, TrackerInfo } from "../types";

/** Where a value in the output table came from, and whether it checks out. */
export type EvidenceStatus = "ok" | "warn" | "info" | "missing";

export interface TrackerCell {
  ref: string; // e.g. "E5"
  header: string;
  value: string;
}

export interface FieldEvidence {
  column: string;
  value: string;
  source: "resume" | "tracker" | "calculated" | "none";
  status: EvidenceStatus;
  detail: string;
  /** Words to highlight in the resume and jump to when the card is clicked. */
  terms: string[];
  cells: TrackerCell[];
}

// ------------------------------------------------------------------ text matching

export function norm(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/[^a-z0-9@.+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const FILLER = new Set(["pvt", "ltd", "limited", "private", "inc", "llp", "llc", "the", "and", "of", "co", "corp", "india", "technologies", "solutions", "services"]);

/** True when `needle` appears in `haystack` (already normalised), allowing for
 *  small formatting differences by falling back to "all key words present". */
export function found(haystack: string, needle: string): boolean {
  const n = norm(needle);
  if (!n) return false;
  if (haystack.includes(n)) return true;
  const words = n.split(" ").filter((w) => w.length >= 3 && !FILLER.has(w));
  return words.length > 0 && words.every((w) => haystack.includes(w));
}

function digits(text: string): string {
  return (text || "").replace(/\D/g, "");
}

// ------------------------------------------------------------------ helpers

const LEVEL_RANK: Record<string, number> = { phd: 5, masters: 4, bachelors: 3, diploma: 2, other: 1, school: 0 };

interface Edu { level?: string; degree?: string | null; branch?: string | null; institute?: string | null; year?: string | null }
interface Role { company?: string; title?: string | null; is_client_project?: boolean }

function highestEducation(list: Edu[]): Edu | null {
  const usable = (list || []).filter((e) => (e.degree || e.institute));
  if (!usable.length) return null;
  const year = (e: Edu) => parseInt(String(e.year || "").match(/(19|20)\d{2}/)?.[0] ?? "0", 10);
  return usable.reduce((best, e) => {
    const a = [LEVEL_RANK[e.level ?? "other"] ?? 1, year(e)];
    const b = [LEVEL_RANK[best.level ?? "other"] ?? 1, year(best)];
    return a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]) ? e : best;
  });
}

/** "1. Tata Consultancy Services – System Engineer | Jun 2022 – Apr 2025" -> company + title */
function parseCompanyLines(value: string): { company: string; title: string }[] {
  return value
    .split("\n")
    .map((line) => line.replace(/^\s*\d+\.\s*/, "").split(" | ")[0])
    .filter(Boolean)
    .map((head) => {
      const [company, ...rest] = head.split(" – ");
      return { company: company.trim(), title: rest.join(" – ").trim() };
    });
}

export function columnLetter(index: number): string {
  let s = "";
  let n = index + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function trackerCell(tracker: TrackerInfo | null, mapping: Mapping | null, rowIndex: number | null, field: FieldKey): TrackerCell | null {
  if (!tracker || !mapping || rowIndex === null || rowIndex === undefined) return null;
  const col = mapping[field];
  if (col === null || col === undefined) return null;
  const rowNumber = tracker.row_numbers?.[rowIndex] ?? rowIndex + 2;
  return {
    ref: `${columnLetter(col)}${rowNumber}`,
    header: tracker.headers[col] || tracker.fields[field],
    value: tracker.rows[rowIndex]?.[col] ?? "",
  };
}

// ------------------------------------------------------------------ main

export function buildEvidence(row: TableRow, job: ResumeJob | undefined, tracker: TrackerInfo | null, mapping: Mapping | null): FieldEvidence[] {
  const data = (job?.data ?? null) as Record<string, unknown> | null;
  const text = norm(job?.mode === "text" ? job?.text ?? "" : "");
  const textDigits = digits(job?.mode === "text" ? job?.text ?? "" : "");
  const scanned = job?.mode === "file";
  const v = row.values;
  const t = (f: FieldKey) => trackerCell(tracker, mapping, row.tracker_row, f);
  const cells = (...fields: FieldKey[]) => fields.map(t).filter((c): c is TrackerCell => !!c);

  /** Status for a resume value: verified in text, or visual check for scanned PDFs. */
  const resumeCheck = (ok: boolean, okText: string, warnText: string): Pick<FieldEvidence, "status" | "detail"> => {
    if (!data) return { status: "missing", detail: "Resume could not be read - fill in by hand." };
    if (scanned) return { status: "info", detail: "Scanned PDF - compare with the highlighted page visually." };
    return ok ? { status: "ok", detail: okText } : { status: "warn", detail: warnText };
  };

  const out: FieldEvidence[] = [];

  // Name
  {
    const name = String(data?.name ?? "");
    const tc = cells("name");
    const check = resumeCheck(found(text, name || v["Name"]), "Found in the resume.", "Name not found word-for-word in the resume.");
    out.push({ column: "Name", value: v["Name"], source: data ? "resume" : tc.length ? "tracker" : "none", ...(!data && tc.length ? { status: "ok" as const, detail: "Taken from the tracker." } : check), terms: name ? [name] : [], cells: tc });
  }

  // Years of experience
  {
    const stated = String(data?.stated_total_experience ?? "");
    const src = row.experience_source;
    if (src === "stated in resume") {
      out.push({ column: "No. of Years of Experience", value: v["No. of Years of Experience"], source: "resume", ...resumeCheck(found(text, stated), `Resume says "${stated}".`, `Expected the phrase "${stated}" in the resume.`), terms: stated ? [stated] : [], cells: cells("total_exp") });
    } else if (src === "calculated from resume dates") {
      out.push({ column: "No. of Years of Experience", value: v["No. of Years of Experience"], source: "calculated", status: "info", detail: "Calculated from the job dates (overlaps merged, gaps skipped). Tracker value shown for comparison.", terms: [], cells: cells("total_exp") });
    } else if (src === "from tracker") {
      out.push({ column: "No. of Years of Experience", value: v["No. of Years of Experience"], source: "tracker", status: "ok", detail: "Taken from the tracker.", terms: [], cells: cells("total_exp") });
    } else {
      out.push({ column: "No. of Years of Experience", value: v["No. of Years of Experience"], source: "none", status: "missing", detail: "No experience found.", terms: [], cells: cells("total_exp") });
    }
  }

  // Education
  {
    const edu = highestEducation((data?.education as Edu[]) ?? []);
    const parts = [edu?.institute, edu?.degree, edu?.branch, edu?.year].map((x) => String(x ?? "").trim()).filter(Boolean);
    const instOk = !edu?.institute || found(text, String(edu.institute));
    const yearOk = !edu?.year || text.includes(String(edu.year));
    out.push({
      column: "Education (Highest)", value: v["Education (Highest)"], source: data ? "resume" : "none",
      ...resumeCheck(!!edu && instOk && yearOk, "Institute and year found in the resume.", !instOk ? "Institute not found word-for-word in the resume." : "Graduation year not found in the resume."),
      terms: parts, cells: [],
    });
  }

  // Companies
  {
    const lines = parseCompanyLines(v["Companies (Last 3)"] || "");
    const missing = lines.filter((l) => !found(text, l.company)).map((l) => l.company);
    const roles = ((data?.experience as Role[]) ?? []).filter((r) => !r.is_client_project);
    const terms = Array.from(new Set([...lines.map((l) => l.company), ...roles.map((r) => r.company ?? "")].filter((x) => x && x.length > 2)));
    out.push({
      column: "Companies (Last 3)", value: v["Companies (Last 3)"], source: data ? "resume" : "none",
      ...resumeCheck(lines.length > 0 && missing.length === 0, `All ${lines.length} companies found in the resume. Check the order and dates.`, missing.length ? `Not found word-for-word: ${missing.join(", ")}.` : "No companies extracted."),
      terms, cells: [],
    });
  }

  // Contact
  {
    const tc = cells("phone");
    const phone = digits(v["Contact No"]);
    const inResume = !!phone && textDigits.includes(phone);
    const trackerSame = tc.some((c) => digits(c.value).endsWith(phone) && phone.length === 10);
    const status: EvidenceStatus = !phone ? "missing" : inResume || trackerSame ? "ok" : scanned ? "info" : "warn";
    out.push({
      column: "Contact No", value: v["Contact No"], source: inResume || scanned ? "resume" : "tracker", status,
      detail: inResume && trackerSame ? "Same number in the resume and the tracker." : inResume ? "Found in the resume (tracker differs - resume wins)." : trackerSame ? "Matches the tracker." : scanned ? "Scanned PDF - compare visually." : "Not found in the resume or the tracker.",
      terms: phone ? [phone] : [], cells: tc,
    });
  }

  // Email
  {
    const tc = cells("email");
    const email = (v["Email id"] || "").toLowerCase().replace(/\s/g, "");
    const rawText = (job?.mode === "text" ? job?.text ?? "" : "").toLowerCase().replace(/\s/g, "");
    const inResume = !!email && rawText.includes(email);
    const trackerSame = tc.some((c) => c.value.toLowerCase().replace(/\s/g, "") === email);
    out.push({
      column: "Email id", value: v["Email id"], source: inResume || scanned ? "resume" : "tracker",
      status: !email ? "missing" : inResume || trackerSame ? "ok" : scanned ? "info" : "warn",
      detail: inResume && trackerSame ? "Same email in the resume and the tracker." : inResume ? "Found in the resume (tracker differs - resume wins)." : trackerSame ? "Matches the tracker." : scanned ? "Scanned PDF - compare visually." : "Not found in the resume or the tracker.",
      terms: email ? [email] : [], cells: tc,
    });
  }

  // Tracker-only columns: show the raw cells next to the formatted value.
  const fromTracker = (column: string, fields: FieldKey[], rule: string) => {
    const tc = cells(...fields);
    out.push({
      column, value: v[column], source: tc.length ? "tracker" : "none",
      status: tc.length ? "ok" : "missing",
      detail: tc.length ? rule : "No tracker row matched.",
      terms: [], cells: tc,
    });
  };
  fromTracker("Current CTC (Fixed) + Any variable", ["current_ctc", "variable"], "Fixed + variable from the tracker (no variable = fixed amount only).");
  fromTracker("Expected CTC (Fixed)", ["expected_ctc"], "Copied from the tracker.");
  fromTracker("Notice Period/Offer status", ["notice", "offer"], "Notice period, plus “| offer & DOJ” only when there is an offer (LWD removed from the offer cell).");
  fromTracker("Recruiter_Comments", ["comments"], "Copied from the tracker.");

  return out;
}

export interface HighlightTerm {
  term: string;
  column: string;
  /** Long names (companies, institutes) may be split across PDF text pieces,
   *  so their pieces are highlighted too. Everything else must match whole. */
  partial: boolean;
}

/** Every resume term, tagged with the column it belongs to (for highlighting). */
export function highlightTerms(evidence: FieldEvidence[]): HighlightTerm[] {
  const out: HighlightTerm[] = [];
  for (const e of evidence) {
    if (e.source !== "resume" && e.column !== "Name") continue;
    for (const term of e.terms) {
      if (!term || term.trim().length < 3) continue;
      const long = term.trim().split(/\s+/).length >= 2 && term.trim().length >= 10;
      out.push({ term, column: e.column, partial: e.column === "Name" || (long && (e.column === "Companies (Last 3)" || e.column === "Education (Highest)")) });
    }
  }
  // Longest first, so "Tata Consultancy Services" wins over "Services".
  return out.sort((a, b) => b.term.length - a.term.length);
}
