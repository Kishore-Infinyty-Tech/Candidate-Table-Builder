export type FieldKey =
  | "name"
  | "phone"
  | "email"
  | "current_ctc"
  | "variable"
  | "expected_ctc"
  | "notice"
  | "offer"
  | "total_exp"
  | "comments";

export type Mapping = Record<FieldKey, number | null>;

export interface TrackerInfo {
  fileName: string;
  sheet: string;
  headers: string[];
  rows: string[][];
  /** Excel row number of each tracker row (for "row 5, column E" references). */
  row_numbers: number[];
  mapping: Mapping;
  fields: Record<FieldKey, string>;
  required: FieldKey[];
}

export type ReadMode = "text" | "file";

export type JobStatus = "queued" | "reading" | "ready" | "extracting" | "done" | "failed";

export interface ResumeJob {
  id: string;
  file: File;
  stem: string;
  status: JobStatus;
  mode?: ReadMode;
  text?: string;
  fileB64?: string;
  mimeType?: string;
  data?: Record<string, unknown> | null;
  error?: string | null;
}

export type RowStatus = "matched" | "check" | "unmatched" | "failed";

export interface MatchInfo {
  tracker_row: number;
  phone: boolean;
  email: boolean;
  name: number;
}

export interface TableRow {
  id: string;
  /** Index into TrackerInfo.rows, or null when no tracker row was matched. */
  tracker_row: number | null;
  match: MatchInfo | null;
  verified: boolean;
  source: string;
  read_mode: ReadMode | null;
  status: RowStatus;
  notes: string[];
  experience_source: string;
  values: Record<string, string>;
  highlight: boolean;
}

export interface TableResult {
  columns: string[];
  rows: TableRow[];
}

export interface ModelUsage {
  model: string;
  used: number;
  limit: number;
  exhausted: boolean;
  limit_confirmed: boolean;
}

export interface UsageSummary {
  models: ModelUsage[];
  used: number;
  limit: number;
  remaining: number;
  percent_used: number;
  resets_at: string;
  resets_in_seconds: number;
  storage: "local" | "shared";
}
