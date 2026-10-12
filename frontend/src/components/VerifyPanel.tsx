import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Mapping, ResumeJob, TableRow, TrackerInfo } from "../types";
import { buildEvidence, highlightTerms, type EvidenceStatus, type FieldEvidence } from "../lib/evidence";
import ResumeViewer, { type Focus } from "./ResumeViewer";
import TrackerViewer, { type CellFocus } from "./TrackerViewer";
import { Avatar } from "./ui";
import {
  IconAlert, IconArrowRight, IconCheck, IconCheckCircle, IconFileText, IconInfo, IconSheet, IconX, IconXCircle,
} from "./icons";

const STATUS_STYLE: Record<EvidenceStatus, { rail: string; icon: ReactNode; chip: string }> = {
  ok: { rail: "bg-emerald-400", icon: <IconCheckCircle size={15} className="text-emerald-500" />, chip: "bg-emerald-50 text-emerald-700" },
  warn: { rail: "bg-gold-500", icon: <IconAlert size={15} className="text-gold-600" />, chip: "bg-gold-300/30 text-gold-600" },
  info: { rail: "bg-brand-300", icon: <IconInfo size={15} className="text-brand-500" />, chip: "bg-brand-50 text-brand-700" },
  missing: { rail: "bg-rose-400", icon: <IconXCircle size={15} className="text-rose-500" />, chip: "bg-rose-50 text-rose-700" },
};

const SOURCE_LABEL: Record<FieldEvidence["source"], string> = {
  resume: "Resume",
  tracker: "Tracker",
  calculated: "Calculated",
  none: "No source",
};

const ROW_STATUS: Record<TableRow["status"], { label: string; cls: string }> = {
  matched: { label: "Matched", cls: "bg-emerald-400/20 text-emerald-200 ring-emerald-300/30" },
  check: { label: "Check", cls: "bg-gold-400/20 text-gold-300 ring-gold-300/30" },
  unmatched: { label: "Unmatched", cls: "bg-rose-400/20 text-rose-200 ring-rose-300/30" },
  failed: { label: "Not read", cls: "bg-rose-400/20 text-rose-200 ring-rose-300/30" },
};

function FieldCard({ e, active, onLocate, onLocateCells }: {
  e: FieldEvidence;
  active: boolean;
  onLocate: () => void;
  onLocateCells: (refs: string[]) => void;
}) {
  const st = STATUS_STYLE[e.status];
  const inResume = e.terms.length > 0 && e.source === "resume";
  const locatable = inResume || e.cells.length > 0;
  const locate = () => (inResume ? onLocate() : onLocateCells(e.cells.map((c) => c.ref)));
  return (
    <div
      role={locatable ? "button" : undefined}
      tabIndex={locatable ? 0 : undefined}
      onClick={locatable ? locate : undefined}
      onKeyDown={(ev) => locatable && ev.key === "Enter" && locate()}
      className={`group relative overflow-hidden rounded-2xl border bg-white pl-4 pr-4 py-3.5 transition-all duration-200 ${
        active ? "border-brand-300 shadow-[0_8px_30px_-12px_rgba(47,107,255,0.45)] ring-2 ring-brand-500/15" : "border-slate-200/80 hover:border-brand-200 hover:shadow-md"
      } ${locatable ? "cursor-pointer" : ""}`}
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${st.rail}`} />
      <div className="flex items-start justify-between gap-3">
        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">{e.column}</span>
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.chip}`}>
          {e.source === "tracker" ? <IconSheet size={11} /> : e.source === "resume" ? <IconFileText size={11} /> : null}
          {SOURCE_LABEL[e.source]}
        </span>
      </div>
      <div className="mt-1.5 whitespace-pre-wrap text-[14.5px] font-medium leading-relaxed text-navy-900">
        {e.value || <span className="italic text-slate-300">empty</span>}
      </div>

      {e.cells.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {e.cells.map((c) => (
            <button
              key={c.ref}
              type="button"
              onClick={(ev) => {
                ev.stopPropagation();
                onLocateCells([c.ref]);
              }}
              className="inline-flex max-w-full items-stretch overflow-hidden rounded-lg border border-slate-200 bg-slate-50 text-xs transition hover:border-navy-700 hover:shadow-sm"
              title={`${c.header} - show in tracker`}
            >
              <span className="flex items-center bg-navy-900 px-1.5 font-mono text-[10.5px] font-semibold text-brand-100">{c.ref}</span>
              <span className="truncate px-2 py-1 text-slate-600">
                <span className="text-slate-400">{c.header.length > 26 ? c.header.slice(0, 26) + "…" : c.header}:</span>{" "}
                <span className="font-semibold text-navy-800">{c.value || "—"}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="flex items-start gap-1.5 text-xs text-slate-500">
          <span className="mt-px shrink-0">{st.icon}</span>
          {e.detail}
        </span>
        {locatable && (
          <span className="shrink-0 text-[11px] font-semibold text-brand-500 opacity-0 transition group-hover:opacity-100">
            {inResume ? "Show in resume →" : "Show in tracker →"}
          </span>
        )}
      </div>
    </div>
  );
}

export default function VerifyPanel({ rows, index, setIndex, jobs, tracker, mapping, onSetVerified, onClose }: {
  rows: TableRow[];
  index: number;
  setIndex: (i: number) => void;
  jobs: ResumeJob[];
  tracker: TrackerInfo | null;
  mapping: Mapping | null;
  onSetVerified: (id: string, verified: boolean) => void;
  onClose: () => void;
}) {
  const row = rows[index];
  const job = useMemo(() => jobs.find((j) => j.id === row?.id), [jobs, row?.id]);
  const evidence = useMemo(() => (row ? buildEvidence(row, job, tracker, mapping) : []), [row, job, tracker, mapping]);
  const terms = useMemo(() => highlightTerms(evidence), [evidence]);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [cellFocus, setCellFocus] = useState<CellFocus | null>(null);
  const [tab, setTab] = useState<"resume" | "tracker">("resume");
  const [closing, setClosing] = useState(false);
  const used = useMemo(() => {
    const map: Record<string, string[]> = {};
    // Frame only the cells whose output value was taken from the tracker
    // (CTC, expected CTC, notice/offer, comments), not the ones that come from
    // the resume and are merely cross-checked against the tracker.
    for (const e of evidence) {
      if (e.source !== "tracker") continue;
      for (const c of e.cells) (map[c.ref] ??= []).push(e.column);
    }
    return map;
  }, [evidence]);

  const verifiedCount = rows.filter((r) => r.verified).length;
  const counts = evidence.reduce((acc, e) => ({ ...acc, [e.status]: (acc[e.status] ?? 0) + 1 }), {} as Record<EvidenceStatus, number>);

  useEffect(() => {
    setFocus(null);
    setCellFocus(null);
    setTab(job ? "resume" : "tracker");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const locateResume = (column: string) => {
    setTab("resume");
    setFocus({ column, nonce: Date.now() });
  };
  const locateCells = (refs: string[]) => {
    setTab("tracker");
    setCellFocus({ refs, nonce: Date.now() });
  };

  const close = () => {
    setClosing(true);
    setTimeout(onClose, 180);
  };
  const go = (d: number) => setIndex(Math.min(rows.length - 1, Math.max(0, index + d)));
  const toggleVerified = () => {
    if (!row) return;
    const next = !row.verified;
    onSetVerified(row.id, next);
    if (next) {
      // Move on to the next candidate still waiting for a check.
      const after = rows.findIndex((r, i) => i > index && !r.verified);
      const target = after >= 0 ? after : rows.findIndex((r, i) => i !== index && !r.verified);
      if (target >= 0) setTimeout(() => setIndex(target), 380);
    }
  };

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const el = ev.target as HTMLElement;
      if (el?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el?.tagName)) return;
      if (ev.key === "Escape") close();
      else if (ev.key === "ArrowRight") go(1);
      else if (ev.key === "ArrowLeft") go(-1);
      else if (ev.key.toLowerCase() === "v") toggleVerified();
      else if (ev.key.toLowerCase() === "t") setTab((t) => (t === "resume" ? "tracker" : "resume"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (!row) return null;
  const pct = rows.length ? (verifiedCount / rows.length) * 100 : 0;
  const status = ROW_STATUS[row.status];
  const trackerRowNumber = row.tracker_row !== null && tracker ? tracker.row_numbers?.[row.tracker_row] ?? row.tracker_row + 2 : null;

  return (
    <div className={`fixed inset-0 z-50 flex ${closing ? "verify-out" : ""}`} role="dialog" aria-modal="true" aria-label={`Verify ${row.values["Name"]}`}>
      <div className="verify-backdrop absolute inset-0 bg-navy-950/55 backdrop-blur-md" onClick={close} />

      <div className="verify-panel relative m-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px] bg-[#f6f8fe] shadow-[0_40px_120px_-30px_rgba(6,15,51,0.65)] ring-1 ring-white/40 sm:m-4 lg:m-6">
        {/* ------------------------------------------------ header */}
        <header className="hero-bg relative shrink-0 px-6 pb-4 pt-5 text-white">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3.5">
              <div className="rounded-full ring-2 ring-white/30">
                <Avatar name={row.values["Name"] || "?"} size={44} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 key={row.id} className="font-display anim-rise truncate text-xl font-bold">{row.values["Name"] || "Unnamed candidate"}</h2>
                  {row.verified && (
                    <span className="anim-pop inline-flex items-center gap-1 rounded-full bg-emerald-400 px-2 py-0.5 text-[11px] font-bold text-navy-950">
                      <IconCheck size={11} strokeWidth={3} /> Verified
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-brand-100/90">
                  <span className={`rounded-full px-2 py-0.5 font-semibold ring-1 ring-inset ${status.cls}`}>{status.label}</span>
                  {trackerRowNumber && <span className="rounded-full bg-white/10 px-2 py-0.5 ring-1 ring-white/15">Tracker row {trackerRowNumber}</span>}
                  {row.match && (
                    <span className="rounded-full bg-white/10 px-2 py-0.5 ring-1 ring-white/15">
                      Matched on {[row.match.phone && "phone", row.match.email && "email"].filter(Boolean).join(" + ") || "name"} · name {row.match.name}%
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-5">
              <div className="hidden w-48 md:block">
                <div className="flex items-baseline justify-between text-xs">
                  <span className="font-semibold text-brand-100">Verified</span>
                  <span className="font-display text-sm font-bold tabular-nums">{verifiedCount}<span className="text-brand-100/70"> / {rows.length}</span></span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/15">
                  <div className="h-full rounded-full bg-gradient-to-r from-emerald-300 to-cyan-brand transition-all duration-500" style={{ width: `${pct}%` }} />
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => go(-1)} disabled={index === 0} className="nav-btn" aria-label="Previous candidate">
                  <IconArrowRight size={17} className="rotate-180" />
                </button>
                <span className="min-w-[3.5rem] text-center text-xs font-semibold tabular-nums text-brand-100">{index + 1} of {rows.length}</span>
                <button onClick={() => go(1)} disabled={index === rows.length - 1} className="nav-btn" aria-label="Next candidate">
                  <IconArrowRight size={17} />
                </button>
              </div>
              <button onClick={close} className="nav-btn" aria-label="Close">
                <IconX size={17} />
              </button>
            </div>
          </div>

          {/* candidate strip */}
          <div className="mt-4 flex gap-1.5 overflow-x-auto pb-1">
            {rows.map((r, i) => (
              <button
                key={r.id}
                onClick={() => setIndex(i)}
                title={r.values["Name"]}
                className={`flex shrink-0 items-center gap-1.5 rounded-full py-1 pl-1 pr-3 text-xs font-medium transition-all ${
                  i === index ? "bg-white text-navy-900 shadow-lg" : "bg-white/10 text-brand-100 hover:bg-white/20"
                }`}
              >
                <Avatar name={r.values["Name"] || "?"} size={20} />
                <span className="max-w-[9rem] truncate">{r.values["Name"] || "—"}</span>
                {r.verified && <IconCheck size={12} strokeWidth={3} className={i === index ? "text-emerald-600" : "text-emerald-300"} />}
              </button>
            ))}
          </div>
        </header>

        {/* ------------------------------------------------ body */}
        <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)] lg:grid-rows-1">
          <section className="flex min-h-0 flex-col border-b border-navy-900/5 lg:border-b-0 lg:border-r">
            <div className="flex shrink-0 items-center gap-1 border-b border-navy-900/5 bg-white px-4 pt-2.5">
              {([
                ["resume", "Resume", <IconFileText key="r" size={15} />, job ? "" : "none"],
                ["tracker", "Tracker sheet", <IconSheet key="t" size={15} />, row.tracker_row !== null ? `Row ${trackerRowNumber}` : "no row"],
              ] as const).map(([key, label, icon, hint]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`relative inline-flex items-center gap-2 rounded-t-xl px-4 pb-2.5 pt-2 text-sm font-semibold transition ${
                    tab === key ? "text-navy-900" : "text-slate-400 hover:text-navy-800"
                  }`}
                >
                  {icon} {label}
                  {hint && <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${tab === key ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-400"}`}>{hint}</span>}
                  <span className={`absolute inset-x-3 -bottom-px h-[3px] rounded-full bg-gradient-to-r from-brand-500 to-cyan-brand transition-all duration-300 ${tab === key ? "opacity-100" : "opacity-0"}`} />
                </button>
              ))}
            </div>
            <div className="relative min-h-0 flex-1">
              <div className={`absolute inset-0 transition-opacity duration-200 ${tab === "resume" ? "opacity-100" : "pointer-events-none opacity-0"}`}>
                <ResumeViewer file={job?.file ?? null} scanned={job?.mode === "file"} terms={terms} focus={focus} />
              </div>
              <div className={`absolute inset-0 transition-opacity duration-200 ${tab === "tracker" ? "opacity-100" : "pointer-events-none opacity-0"}`}>
                <TrackerViewer tracker={tracker} mapping={mapping} rowIndex={row.tracker_row} used={used} focus={cellFocus} />
              </div>
            </div>
          </section>

          <section className="flex min-h-0 flex-col">
            <div className="flex items-center justify-between gap-3 px-6 pt-4 pb-2">
              <div>
                <h3 className="font-display text-[15px] font-semibold text-navy-900">Output vs source</h3>
                <p className="text-xs text-slate-500">Click a card or a cell chip to find it in the resume or the tracker.</p>
              </div>
              <div className="flex gap-1.5 text-[11px] font-semibold">
                {(["ok", "warn", "info", "missing"] as EvidenceStatus[]).filter((k) => counts[k]).map((k) => (
                  <span key={k} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${STATUS_STYLE[k].chip}`}>
                    {STATUS_STYLE[k].icon} {counts[k]}
                  </span>
                ))}
              </div>
            </div>

            <div key={row.id} className="min-h-0 flex-1 space-y-2.5 overflow-auto px-6 pb-4 pt-1">
              {evidence.map((e, i) => (
                <div key={e.column} className="anim-rise" style={{ animationDelay: `${i * 0.03}s` }}>
                  <FieldCard
                    e={e}
                    active={(tab === "resume" && focus?.column === e.column) || (tab === "tracker" && !!cellFocus && e.cells.some((c) => cellFocus.refs.includes(c.ref)))}
                    onLocate={() => locateResume(e.column)}
                    onLocateCells={locateCells}
                  />
                </div>
              ))}
              {row.notes.length > 0 && (
                <div className="rounded-2xl border border-gold-400/40 bg-gold-300/15 px-4 py-3">
                  <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-gold-600">Notes from matching</div>
                  <ul className="space-y-1 text-xs text-navy-800">
                    {row.notes.map((n, i) => <li key={i} className="flex gap-1.5"><IconAlert size={12} className="mt-0.5 shrink-0 text-gold-600" />{n}</li>)}
                  </ul>
                </div>
              )}
            </div>

            <footer className="shrink-0 border-t border-navy-900/5 bg-white/80 px-6 py-3.5 backdrop-blur">
              <div className="flex items-center justify-between gap-4">
                <p className="hidden text-xs text-slate-400 sm:block">
                  <kbd className="kbd">←</kbd> <kbd className="kbd">→</kbd> move · <kbd className="kbd">T</kbd> resume / tracker · <kbd className="kbd">V</kbd> verify · <kbd className="kbd">Esc</kbd> close
                </p>
                <button
                  onClick={toggleVerified}
                  className={`ml-auto inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition-all duration-300 ${
                    row.verified
                      ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100"
                      : "bg-gradient-to-r from-emerald-500 to-emerald-400 text-white shadow-lg shadow-emerald-500/30 hover:-translate-y-px hover:shadow-emerald-500/50"
                  }`}
                >
                  <IconCheckCircle size={18} />
                  {row.verified ? "Verified — undo" : "Mark as verified"}
                </button>
              </div>
            </footer>
          </section>
        </div>
      </div>
    </div>
  );
}
