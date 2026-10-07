import { useRef, useState, type DragEvent, type ReactNode } from "react";
import type { FieldKey, Mapping, TrackerInfo } from "../types";
import { uploadTracker } from "../lib/api";
import { isResumeFile } from "../lib/readFile";
import { Alert, Avatar, Badge, Button, Card } from "./ui";
import {
  IconArrowRight, IconCheckCircle, IconClock, IconColumns, IconFileText, IconFolder,
  IconLoader, IconSheet, IconTrash, IconUpload, IconUsers, IconX,
} from "./icons";

export const MIN_RESUMES = 2;
export const MAX_RESUMES = 50;

function DropZone({ title, hint, accept, multiple, onFiles, compact, children }: {
  title: ReactNode;
  hint: string;
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  compact?: boolean;
  children?: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    onFiles(Array.from(e.dataTransfer.files));
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={`dropzone group relative cursor-pointer rounded-2xl border-2 border-dashed text-center transition-all duration-300 ${
        compact ? "px-4 py-5" : "flex flex-1 flex-col items-center justify-center px-6 py-9"
      } ${over ? "dropzone-active border-brand-500 bg-brand-50" : "border-brand-200 bg-gradient-to-b from-white to-brand-50/60 hover:border-brand-400"}`}
    >
      <div className={`drop-icon mx-auto flex items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-cyan-brand text-white shadow-lg shadow-brand-500/30 ${compact ? "h-10 w-10" : "h-14 w-14"}`}>
        <IconUpload size={compact ? 20 : 26} />
      </div>
      <p className={`font-semibold text-navy-900 ${compact ? "mt-2 text-sm" : "mt-4 text-[15px]"}`}>{title}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
      {children && <div className="mt-4" onClick={(e) => e.stopPropagation()}>{children}</div>}
      <input
        ref={input}
        type="file"
        className="hidden"
        accept={accept}
        multiple={multiple}
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
    </div>
  );
}

function MappingTable({ tracker, mapping, onChange }: {
  tracker: TrackerInfo;
  mapping: Mapping;
  onChange: (m: Mapping) => void;
}) {
  const keys = Object.keys(tracker.fields) as FieldKey[];
  return (
    <div className="anim-rise overflow-hidden rounded-xl border border-brand-100 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-navy-900 text-left text-xs uppercase tracking-wider text-brand-100">
          <tr>
            <th className="px-3 py-2.5 font-semibold">Needed for</th>
            <th className="px-3 py-2.5 font-semibold">Tracker column</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-brand-50">
          {keys.map((key) => {
            const missing = mapping[key] === null;
            const required = tracker.required.includes(key);
            return (
              <tr key={key} className={missing && required ? "bg-rose-50/70" : "hover:bg-brand-50/50"}>
                <td className="px-3 py-2 text-navy-800">
                  <span className="flex items-center gap-2">
                    {missing && required
                      ? <IconX size={14} className="text-rose-500" />
                      : missing ? <span className="h-3.5 w-3.5 rounded-full border border-slate-300" />
                      : <IconCheckCircle size={14} className="text-emerald-500" />}
                    {tracker.fields[key]}
                    {!required && <span className="text-xs text-slate-400">(optional)</span>}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <select
                    value={mapping[key] ?? ""}
                    onChange={(e) =>
                      onChange({ ...mapping, [key]: e.target.value === "" ? null : Number(e.target.value) })
                    }
                    className={`w-full rounded-lg border bg-white px-2 py-1.5 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 ${
                      missing && required ? "border-rose-300 text-rose-700" : "border-slate-200"
                    }`}
                  >
                    <option value="">— not in tracker —</option>
                    {tracker.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {String.fromCharCode(65 + (i % 26))}: {h.length > 60 ? h.slice(0, 60) + "…" : h || "(blank)"}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FileIcon({ name }: { name: string }) {
  const pdf = /\.pdf$/i.test(name);
  return (
    <span
      className={`flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-lg text-[9px] font-bold ring-1 ring-inset ${
        pdf ? "bg-rose-50 text-rose-600 ring-rose-200" : "bg-brand-50 text-brand-600 ring-brand-200"
      }`}
    >
      <IconFileText size={15} />
      {pdf ? "PDF" : "DOCX"}
    </span>
  );
}

function Stat({ icon, label, value, tone }: { icon: ReactNode; label: string; value: ReactNode; tone: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone}`}>{icon}</span>
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
        <div className="font-display text-lg font-bold text-navy-900">{value}</div>
      </div>
    </div>
  );
}

export default function UploadStep({ tracker, setTracker, mapping, setMapping, files, setFiles, onStart, quotaLeft }: {
  tracker: TrackerInfo | null;
  setTracker: (t: TrackerInfo | null) => void;
  mapping: Mapping | null;
  setMapping: (m: Mapping) => void;
  files: File[];
  setFiles: (f: File[]) => void;
  onStart: () => void;
  quotaLeft: number | null;
}) {
  const [trackerError, setTrackerError] = useState<string | null>(null);
  const [trackerBusy, setTrackerBusy] = useState(false);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [showMapping, setShowMapping] = useState(false);
  const folderInput = useRef<HTMLInputElement>(null);

  const onTracker = async (list: File[]) => {
    const file = list.find((f) => /\.xlsx?m?$/i.test(f.name));
    if (!file) {
      setTrackerError("Please choose the tracker Excel file (.xlsx).");
      return;
    }
    setTrackerBusy(true);
    setTrackerError(null);
    try {
      const info = await uploadTracker(file);
      setTracker(info);
      setMapping(info.mapping);
      setShowMapping(info.required.some((k) => info.mapping[k] === null));
    } catch (e) {
      setTracker(null);
      setTrackerError((e as Error).message);
    } finally {
      setTrackerBusy(false);
    }
  };

  const addResumes = (list: File[]) => {
    const good = list.filter(isResumeFile);
    setSkipped(list.filter((f) => !isResumeFile(f)).map((f) => f.name));
    const seen = new Set(files.map((f) => `${f.name}:${f.size}`));
    const merged = [...files];
    for (const f of good) {
      const key = `${f.name}:${f.size}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(f);
      }
    }
    setFiles(merged);
  };

  const missingRequired = tracker && mapping ? tracker.required.filter((k) => mapping[k] === null) : [];
  const tooFew = files.length < MIN_RESUMES;
  const tooMany = files.length > MAX_RESUMES;
  const canStart = !!tracker && !!mapping && missingRequired.length === 0 && !tooFew && !tooMany;
  const minutes = files.length > 10 ? Math.ceil(files.length / 5) : 1;
  const totalKb = files.reduce((a, f) => a + f.size, 0) / 1024;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="anim-rise h-full" style={{ animationDelay: "0.05s" }}>
          <Card
            className="h-full"
            title="Recruiter tracker"
            subtitle="The Excel with CTC, notice period and offers"
            icon={<IconSheet size={22} />}
            right={tracker && <Badge tone="green" icon={<IconUsers size={12} />}>{tracker.rows.length} candidates</Badge>}
          >
            {!tracker || trackerBusy ? (
              <DropZone
                title={trackerBusy ? <span className="inline-flex items-center gap-2"><IconLoader size={16} className="anim-spin" /> Reading tracker…</span> : <>Drop the tracker here, or <span className="text-brand-600 underline decoration-brand-300 underline-offset-4">browse</span></>}
                hint="Excel file (.xlsx)"
                accept=".xlsx,.xlsm"
                onFiles={onTracker}
              />
            ) : (
              <div className="space-y-3">
                <div className="anim-rise flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3.5 py-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500 text-white anim-pop">
                    <IconSheet size={20} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-navy-900">{tracker.fileName}</p>
                    <p className="text-xs text-slate-500">Sheet “{tracker.sheet}” · {tracker.rows.length} candidates · {tracker.headers.length} columns</p>
                  </div>
                  <Button variant="ghost" onClick={() => setTracker(null)}>Replace</Button>
                </div>

                {missingRequired.length > 0 && (
                  <Alert tone="red">
                    Could not find these columns: <b>{missingRequired.map((k) => tracker.fields[k]).join(", ")}</b>. Pick them below.
                  </Alert>
                )}

                <button
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm font-medium text-brand-700 transition hover:bg-brand-50"
                  onClick={() => setShowMapping((s) => !s)}
                >
                  <span className="flex items-center gap-2"><IconColumns size={16} /> {showMapping ? "Hide column check" : "Check detected columns"}</span>
                  <Badge tone={missingRequired.length ? "red" : "green"}>
                    {missingRequired.length ? `${missingRequired.length} missing` : "All found"}
                  </Badge>
                </button>
                {showMapping && mapping && <MappingTable tracker={tracker} mapping={mapping} onChange={setMapping} />}

                <div className="max-h-56 overflow-auto rounded-xl border border-brand-100 bg-white">
                  <ul className="divide-y divide-brand-50 text-sm">
                    {tracker.rows.map((r, i) => {
                      const name = mapping && mapping.name !== null ? r[mapping.name] : `Row ${i + 1}`;
                      return (
                        <li key={i} className="anim-rise flex items-center gap-3 px-3 py-2" style={{ animationDelay: `${Math.min(i, 12) * 0.03}s` }}>
                          <Avatar name={name} />
                          <span className="flex-1 truncate font-medium text-navy-900">{name}</span>
                          <span className="text-xs tabular-nums text-slate-400">{mapping && mapping.phone !== null ? r[mapping.phone] : ""}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            )}
            {trackerError && <div className="mt-3"><Alert tone="red">{trackerError}</Alert></div>}
          </Card>
        </div>

        <div className="anim-rise h-full" style={{ animationDelay: "0.12s" }}>
          <Card
            className="h-full"
            title="Candidate resumes"
            subtitle={`PDF or Word (.docx) · ${MIN_RESUMES}–${MAX_RESUMES} files`}
            icon={<IconFileText size={22} />}
            right={files.length > 0 && <Badge tone={tooMany ? "red" : "blue"}>{files.length} selected</Badge>}
          >
            <DropZone
              title={<>Drop resumes here, or <span className="text-brand-600 underline decoration-brand-300 underline-offset-4">browse</span></>}
              hint="Select many files at once — scanned PDFs are fine"
              accept=".pdf,.docx"
              multiple
              compact={files.length > 0}
              onFiles={addResumes}
            >
              <Button variant="secondary" onClick={() => folderInput.current?.click()}>
                <IconFolder size={16} /> Choose a whole folder
              </Button>
              <input
                ref={folderInput}
                type="file"
                className="hidden"
                multiple
                // @ts-expect-error non-standard but supported by all modern browsers
                webkitdirectory=""
                onChange={(e) => {
                  addResumes(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
            </DropZone>

            {skipped.length > 0 && (
              <div className="mt-3">
                <Alert tone="amber">Skipped {skipped.length} file(s) that are not PDF/DOCX: {skipped.slice(0, 5).join(", ")}{skipped.length > 5 ? "…" : ""}</Alert>
              </div>
            )}
            {tooMany && <div className="mt-3"><Alert tone="red">Maximum is {MAX_RESUMES} resumes per run. Remove {files.length - MAX_RESUMES}.</Alert></div>}

            {files.length > 0 && (
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-500">{files.length} file(s) · {totalKb > 1024 ? `${(totalKb / 1024).toFixed(1)} MB` : `${totalKb.toFixed(0)} KB`}</span>
                  <button className="inline-flex items-center gap-1 font-medium text-slate-500 transition hover:text-rose-600" onClick={() => setFiles([])}>
                    <IconTrash size={13} /> Clear all
                  </button>
                </div>
                <div className="max-h-72 overflow-auto rounded-xl border border-brand-100 bg-white">
                  <ul className="divide-y divide-brand-50 text-sm">
                    {files.map((f, i) => (
                      <li key={`${f.name}:${f.size}`} className="anim-rise group flex items-center gap-3 px-3 py-2" style={{ animationDelay: `${Math.min(i, 12) * 0.03}s` }}>
                        <FileIcon name={f.name} />
                        <span className="min-w-0 flex-1 truncate font-medium text-navy-900">{f.name}</span>
                        <span className="text-xs tabular-nums text-slate-400">{(f.size / 1024).toFixed(0)} KB</span>
                        <button
                          className="rounded-md p-1 text-slate-300 transition hover:bg-rose-50 hover:text-rose-600"
                          aria-label={`Remove ${f.name}`}
                          onClick={() => setFiles(files.filter((_, j) => j !== i))}
                        >
                          <IconX size={15} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>

      <div className="glass card-glow anim-rise flex flex-wrap items-center justify-between gap-6 rounded-2xl border border-white/70 px-6 py-4" style={{ animationDelay: "0.2s" }}>
        <div className="flex flex-wrap items-center gap-8">
          <Stat icon={<IconUsers size={19} />} label="Tracker" value={tracker ? `${tracker.rows.length} candidates` : "—"} tone="bg-emerald-50 text-emerald-600" />
          <Stat icon={<IconFileText size={19} />} label="Resumes" value={files.length || "—"} tone="bg-brand-50 text-brand-600" />
          <Stat icon={<IconClock size={19} />} label="Est. time" value={files.length ? `~${minutes} min` : "—"} tone="bg-gold-300/30 text-gold-600" />
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {quotaLeft !== null && files.length > quotaLeft && (
            <Badge tone={quotaLeft === 0 ? "red" : "amber"}>
              {quotaLeft === 0 ? "Gemini quota used up for today" : `Only ~${quotaLeft} resumes left in today's quota`}
            </Badge>
          )}
          <Button size="lg" onClick={onStart} disabled={!canStart}>
            Build table <IconArrowRight size={18} />
          </Button>
          <p className="text-xs text-slate-500">
            {!tracker ? "Upload the tracker to begin" : missingRequired.length ? "Fix the tracker columns first" : tooFew ? `Add at least ${MIN_RESUMES} resumes` : tooMany ? `Max ${MAX_RESUMES} resumes` : files.length > 10 ? "Large run: 5 resumes per minute (free tier)" : "Ready when you are"}
          </p>
        </div>
      </div>
    </div>
  );
}
