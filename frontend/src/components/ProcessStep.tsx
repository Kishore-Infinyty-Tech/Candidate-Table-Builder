import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ResumeJob } from "../types";
import { Badge, Button } from "./ui";
import { IconCheck, IconClock, IconFileText, IconImage, IconLoader, IconX } from "./icons";

export interface RunState {
  phase: "reading" | "extracting" | "waiting" | "building" | "done" | "error";
  batch: number;
  totalBatches: number;
  nextBatchAt: number | null;
  message?: string;
  /** When the current batch was sent, and how many resumes it holds (for smooth progress). */
  batchStart?: number;
  batchSize?: number;
}

const TIPS: Record<RunState["phase"], string[]> = {
  reading: ["Opening each file in your browser…", "Checking which PDFs are scanned images…", "Pulling the text out of Word files…"],
  extracting: [
    "Reading work history and dates…",
    "Finding the highest qualification…",
    "Separating employers from client projects…",
    "Picking up phone numbers and emails…",
    "Reading scanned pages image by image…",
  ],
  waiting: ["Pausing briefly to stay inside the free Gemini limit…", "Next batch starts automatically — keep this tab open."],
  building: ["Matching every resume to its tracker row…", "Cross-checking phone, email and name…", "Formatting CTC, notice period and offers…"],
  done: ["Opening your table…"],
  error: [""],
};

function useNow(interval = 500) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(t);
  }, [interval]);
  return now;
}

function RotatingTip({ phase }: { phase: RunState["phase"] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    setI(0);
    const t = setInterval(() => setI((x) => x + 1), 2800);
    return () => clearInterval(t);
  }, [phase]);
  const tips = TIPS[phase];
  const tip = tips[i % tips.length];
  return (
    <p key={`${phase}-${i}`} className="anim-rise h-5 text-sm text-slate-500">
      {tip}
    </p>
  );
}

function CountdownRing({ at, total = 60_000 }: { at: number; total?: number }) {
  const now = useNow(250);
  const left = Math.max(0, at - now);
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-14 w-14">
      <svg viewBox="0 0 56 56" className="h-14 w-14 -rotate-90">
        <circle cx="28" cy="28" r={r} fill="none" stroke="#e6edfb" strokeWidth="5" />
        <circle
          cx="28" cy="28" r={r} fill="none" stroke="url(#ring)" strokeWidth="5" strokeLinecap="round"
          strokeDasharray={c}
          style={{ strokeDashoffset: c * (1 - left / total) }}
        />
        <defs>
          <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f5b82e" />
            <stop offset="100%" stopColor="#ffd977" />
          </linearGradient>
        </defs>
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-display text-sm font-bold text-navy-900">
        {Math.ceil(left / 1000)}s
      </span>
    </div>
  );
}

/** Moves the shown value toward the target at a steady speed, so jumps
 *  (e.g. 53% -> 100% when a batch returns) play as a visible sweep. */
function useAnimatedNumber(target: number, perSecond = 60): number {
  const [value, setValue] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    // Timer-based (not requestAnimationFrame) so it keeps moving in background tabs.
    let last = performance.now();
    let timer = 0;
    const step = () => {
      const t = performance.now();
      const dt = (t - last) / 1000;
      last = t;
      const diff = target - current.current;
      if (Math.abs(diff) < 0.05) {
        current.current = target;
        setValue(target);
        return;
      }
      const move = Math.sign(diff) * Math.min(Math.abs(diff), Math.max(perSecond * dt, Math.abs(diff) * 0.08));
      current.current += move;
      setValue(current.current);
      timer = window.setTimeout(step, 30);
    };
    timer = window.setTimeout(step, 30);
    return () => clearTimeout(timer);
  }, [target, perSecond]);
  return value;
}

function ProgressRing({ pct, active, complete }: { pct: number; active: boolean; complete: boolean }) {
  const size = 188;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const animated = useAnimatedNumber(pct);
  const shown = Math.max(animated, active ? 2 : 0);
  return (
    <div className="relative" style={{ width: size, height: size }}>
      {active && <div className="absolute inset-3 rounded-full bg-cyan-brand/20 blur-2xl anim-pulse" />}
      <svg viewBox={`0 0 ${size} ${size}`} className="relative -rotate-90" width={size} height={size}>
        <defs>
          <linearGradient id="progress-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#22c3f3" />
            <stop offset="60%" stopColor="#5a8dff" />
            <stop offset="100%" stopColor="#f5b82e" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke="url(#progress-ring)" strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={c}
          style={{ strokeDashoffset: c * (1 - shown / 100) }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-5xl font-bold tabular-nums">{Math.round(animated)}<span className="text-2xl text-brand-100">%</span></span>
        {complete && animated >= 99.5 && (
          <span className="anim-pop mt-2 flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-white">
            <IconCheck size={16} strokeWidth={3} />
          </span>
        )}
      </div>
    </div>
  );
}

/** Smooth overall progress: reading 5%, Gemini extraction 85%, matching 10%.
 *  While a batch is with Gemini its share fills gradually (capped below 100%)
 *  so the ring keeps moving even though results arrive all at once. */
function estimateProgress(jobs: ResumeJob[], run: RunState, now: number): number {
  const total = jobs.length || 1;
  if (run.phase === "done") return 100;
  const read = jobs.filter((j) => j.mode || j.status === "failed").length;
  const finished = jobs.filter((j) => j.status === "done" || j.status === "failed").length;
  let extracted = finished;
  if (run.phase === "extracting" && run.batchStart && run.batchSize) {
    const elapsed = now - run.batchStart;
    const inBatchDone = jobs.filter((j) => j.status === "extracting").length === 0 ? run.batchSize : 0;
    extracted += (run.batchSize - inBatchDone) * 0.92 * (1 - Math.exp(-elapsed / 15000));
  }
  let pct = 5 * (read / total) + 85 * (Math.min(extracted, total) / total);
  if (run.phase === "building") pct = 90 + 8 * (1 - Math.exp(-(now - (run.batchStart ?? now)) / 3000));
  return Math.min(99, pct);
}

const STATUS: Record<ResumeJob["status"], { label: string; tone: "slate" | "blue" | "green" | "red" | "gold"; icon: ReactNode }> = {
  queued: { label: "Queued", tone: "slate", icon: <IconClock size={15} className="text-slate-400" /> },
  reading: { label: "Reading", tone: "blue", icon: <IconLoader size={15} className="anim-spin text-brand-500" /> },
  ready: { label: "Ready", tone: "slate", icon: <span className="h-2 w-2 rounded-full bg-brand-300" /> },
  extracting: { label: "Extracting", tone: "blue", icon: <IconLoader size={15} className="anim-spin text-brand-500" /> },
  done: { label: "Done", tone: "green", icon: <span className="anim-pop flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white"><IconCheck size={12} strokeWidth={3} /></span> },
  failed: { label: "Failed", tone: "red", icon: <span className="anim-pop flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-white"><IconX size={12} strokeWidth={3} /></span> },
};

export default function ProcessStep({ jobs, run, onCancel }: {
  jobs: ResumeJob[];
  run: RunState;
  onCancel: () => void;
}) {
  const done = jobs.filter((j) => j.status === "done").length;
  const failed = jobs.filter((j) => j.status === "failed").length;
  const finished = done + failed;
  const now = useNow(200);
  const best = useRef(0);
  const estimate = run.phase === "error" ? best.current : estimateProgress(jobs, run, now);
  best.current = Math.max(best.current, estimate);
  const pct = Math.round(best.current);
  const scanned = jobs.filter((j) => j.mode === "file").length;

  const headline = {
    reading: "Reading resume files",
    extracting: `Extracting details · batch ${run.batch} of ${run.totalBatches}`,
    waiting: `Batch ${run.batch} of ${run.totalBatches} complete`,
    building: "Matching with the tracker",
    done: "All done!",
    error: "Something went wrong",
  }[run.phase];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <section className="hero-bg anim-rise relative flex flex-col items-center justify-center overflow-hidden rounded-3xl px-8 py-10 text-center text-white shadow-2xl shadow-navy-900/25">
        <ProgressRing pct={pct} active={run.phase !== "error"} complete={run.phase === "done"} />
        <p className="mt-3 text-sm font-medium text-brand-100">{finished} of {jobs.length} resumes</p>
        <h2 className="font-display mt-5 text-2xl font-bold">{headline}</h2>
        <div className="mt-2 [&_p]:text-brand-100/90">
          {run.phase === "error" ? <p className="text-sm text-rose-200">{run.message}</p> : <RotatingTip phase={run.phase} />}
        </div>

        {run.phase === "waiting" && run.nextBatchAt && (
          <div className="anim-rise mt-6 flex items-center gap-4 rounded-2xl bg-white/10 px-5 py-3 ring-1 ring-white/20">
            <CountdownRing at={run.nextBatchAt} />
            <div className="text-left">
              <p className="text-sm font-semibold">Next batch starting soon</p>
              <p className="text-xs text-brand-100/80">Free-tier pacing · 5 resumes per minute</p>
            </div>
          </div>
        )}

        <p className="mt-6 text-xs text-brand-100/70">Keep this tab open until the table is ready.</p>
      </section>

      <section className="glass card-glow anim-rise flex flex-col rounded-3xl border border-white/70" style={{ animationDelay: "0.08s" }}>
        <header className="flex flex-wrap items-center justify-between gap-3 px-6 pt-5 pb-4">
          <div>
            <h3 className="font-display text-[17px] font-semibold text-navy-900">Resume queue</h3>
            <p className="mt-0.5 text-sm text-slate-500">Each file is read as text, or as an image if it's a scanned PDF.</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="green">{done} done</Badge>
            {failed > 0 && <Badge tone="red">{failed} failed</Badge>}
            {scanned > 0 && <Badge tone="gold" icon={<IconImage size={12} />}>{scanned} scanned</Badge>}
            <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          </div>
        </header>
        <div className="max-h-[60vh] flex-1 overflow-auto px-4 pt-1 pb-4">
          <ul className="space-y-1.5">
            {jobs.map((j, i) => {
              const s = STATUS[j.status];
              const active = j.status === "extracting" || j.status === "reading";
              return (
                <li
                  key={j.id}
                  className={`anim-rise flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-all duration-300 ${
                    active ? "border-brand-200 bg-brand-50" : j.status === "done" ? "border-emerald-100 bg-emerald-50/50" : j.status === "failed" ? "border-rose-200 bg-rose-50/70" : "border-slate-100 bg-white/60"
                  }`}
                  style={{ animationDelay: `${Math.min(i, 15) * 0.03}s` }}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center">{s.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-navy-900" title={j.file.name}>{j.file.name}</span>
                    {j.error && <span className="block truncate text-xs text-rose-600" title={j.error}>{j.error}</span>}
                  </span>
                  {j.mode && (
                    <span className="hidden items-center gap-1 text-xs text-slate-500 sm:inline-flex">
                      {j.mode === "text" ? <IconFileText size={13} /> : <IconImage size={13} />}
                      {j.mode === "text" ? "Text" : "Scanned"}
                    </span>
                  )}
                  <Badge tone={s.tone}>{s.label}</Badge>
                </li>
              );
            })}
          </ul>
        </div>
      </section>
    </div>
  );
}
