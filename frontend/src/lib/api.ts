import type { Mapping, ResumeJob, TableResult, TableRow, TrackerInfo, UsageSummary } from "../types";

async function errorText(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.detail === "string") return body.detail;
    return JSON.stringify(body?.detail ?? body);
  } catch {
    return `${res.status} ${res.statusText}`;
  }
}

export async function uploadTracker(file: File): Promise<TrackerInfo> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/tracker", { method: "POST", body: form });
  if (!res.ok) throw new Error(await errorText(res));
  const data = await res.json();
  return { ...data, fileName: file.name };
}

export interface ExtractResult {
  id: string;
  data: Record<string, unknown> | null;
  error: string | null;
}

export async function extractBatch(jobs: ResumeJob[]): Promise<ExtractResult[]> {
  const res = await fetch("/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      resumes: jobs.map((j) => ({
        id: j.id,
        filename: j.file.name,
        mode: j.mode,
        text: j.mode === "text" ? j.text : null,
        file_b64: j.mode === "file" ? j.fileB64 : null,
        mime_type: j.mimeType ?? "application/pdf",
      })),
    }),
  });
  if (!res.ok) throw new Error(await errorText(res));
  const body = await res.json();
  return body.results as ExtractResult[];
}

export async function buildTable(jobs: ResumeJob[], tracker: TrackerInfo, mapping: Mapping): Promise<TableResult> {
  const res = await fetch("/api/build", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      resumes: jobs.map((j) => ({
        id: j.id,
        filename: j.file.name,
        file_stem: j.stem,
        mode: j.mode ?? null,
        text: j.mode === "text" ? j.text : null,
        data: j.data ?? null,
        error: j.error ?? null,
      })),
      tracker: { headers: tracker.headers, rows: tracker.rows },
      mapping,
    }),
  });
  if (!res.ok) throw new Error(await errorText(res));
  const body = await res.json();
  return {
    columns: body.columns,
    rows: body.rows.map((r: Omit<TableRow, "highlight">) => ({
      ...r,
      highlight: r.status === "unmatched" || r.status === "failed",
    })),
  };
}

export async function exportExcel(columns: string[], rows: TableRow[]): Promise<Blob> {
  const res = await fetch("/api/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      columns,
      rows: rows.map((r) => ({ values: r.values, highlight: r.highlight })),
    }),
  });
  if (!res.ok) throw new Error(await errorText(res));
  return res.blob();
}

export async function fetchUsage(): Promise<UsageSummary> {
  const res = await fetch("/api/usage");
  if (!res.ok) throw new Error(await errorText(res));
  return res.json();
}
