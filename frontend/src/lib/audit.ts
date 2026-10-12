import type { FieldKey, Mapping, ResumeJob, TableRow, TrackerInfo } from "../types";


export const AUDIT_COLUMNS = [
  "Candidate",
  "Resume file",
  "Read as",
  "Match",
  "Match evidence",
  "Tracker row",
  "Tracker: Current CTC",
  "Tracker: Variable",
  "Tracker: Expected CTC",
  "Tracker: Notice Period",
  "Tracker: Offer status",
  "Tracker: Total experience",
  "Experience source",
  "Gemini model",
  "Verified",
  "Notes",
];

const STATUS_TEXT: Record<TableRow["status"], string> = {
  matched: "Matched",
  check: "Check",
  unmatched: "Unmatched",
  failed: "Resume not read",
};

/** One row of the "Verification" sheet: where each value came from. */
export function auditRows(rows: TableRow[], jobs: ResumeJob[], tracker: TrackerInfo | null, mapping: Mapping | null) {
  const byId = new Map(jobs.map((j) => [j.id, j]));
  return rows.map((r) => {
    const job = byId.get(r.id);
    const raw = (f: FieldKey) => {
      if (!tracker || !mapping || r.tracker_row === null) return "";
      const col = mapping[f];
      return col === null || col === undefined ? "" : tracker.rows[r.tracker_row]?.[col] ?? "";
    };
    const nameCol = mapping?.name ?? 0;
    const trackerRef = tracker && r.tracker_row !== null
      ? `Row ${tracker.row_numbers?.[r.tracker_row] ?? r.tracker_row + 2} (${tracker.rows[r.tracker_row]?.[nameCol] ?? ""})`
      : "—";
    const evidence = r.match
      ? [r.match.phone && "phone", r.match.email && "email", `name ${r.match.name}% similar`].filter(Boolean).join(" + ")
      : r.status === "failed" && r.tracker_row !== null ? "file name" : "—";
    return {
      Candidate: r.values["Name"] ?? "",
      "Resume file": r.source,
      "Read as": r.read_mode === "file" ? "Scanned / image PDF" : r.read_mode === "text" ? "Text" : "—",
      Match: STATUS_TEXT[r.status],
      "Match evidence": evidence,
      "Tracker row": trackerRef,
      "Tracker: Current CTC": raw("current_ctc"),
      "Tracker: Variable": raw("variable"),
      "Tracker: Expected CTC": raw("expected_ctc"),
      "Tracker: Notice Period": raw("notice"),
      "Tracker: Offer status": raw("offer"),
      "Tracker: Total experience": raw("total_exp"),
      "Experience source": r.experience_source || "—",
      "Gemini model": String((job?.data as Record<string, unknown> | null)?._model ?? "—"),
      Verified: r.verified ? "Yes" : "No",
      Notes: r.notes.join("\n"),
    } as Record<string, string>;
  });
}
