import { useEffect, useRef, useState } from "react";
import type { Mapping, ResumeJob, TableResult, TrackerInfo, UsageSummary } from "./types";
import { buildTable, exportExcel, extractBatch, fetchUsage } from "./lib/api";
import { fileStem, readResume } from "./lib/readFile";
import { PACED_INTERVAL_MS, planBatches } from "./lib/batches";
import UploadStep from "./components/UploadStep";
import ProcessStep, { type RunState } from "./components/ProcessStep";
import ReviewStep from "./components/ReviewStep";
import UsageBar from "./components/UsageBar";
import { Alert, Button } from "./components/ui";
import { IconCheck, IconImage, IconRefresh, IconShield, IconSparkles, IconZap } from "./components/icons";

type Step = "upload" | "process" | "review";

const STEPS: { key: Step; label: string }[] = [
  { key: "upload", label: "Upload" },
  { key: "process", label: "Extract & match" },
  { key: "review", label: "Review & download" },
];

class Cancelled extends Error {}

function timestampName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.xlsx`;
}

export default function App() {
  const [step, setStep] = useState<Step>("upload");
  const [tracker, setTracker] = useState<TrackerInfo | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [jobs, setJobs] = useState<ResumeJob[]>([]);
  const [run, setRun] = useState<RunState>({ phase: "reading", batch: 0, totalBatches: 0, nextBatchAt: null });
  const [table, setTable] = useState<TableResult | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [usageLoading, setUsageLoading] = useState(true);

  // Gemini quota: refresh when the home page shows (e.g. after a run) and every minute.
  useEffect(() => {
    if (step !== "upload") return;
    let alive = true;
    const load = () =>
      fetchUsage()
        .then((u) => alive && setUsage(u))
        .catch(() => undefined)
        .finally(() => alive && setUsageLoading(false));
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [step]);

  const patchJob = (id: string, patch: Partial<ResumeJob>) =>
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));

  const wait = (ms: number) =>
    new Promise<void>((resolve, reject) => {
      const end = Date.now() + ms;
      const tick = () => {
        if (cancelled.current) return reject(new Cancelled());
        if (Date.now() >= end) return resolve();
        setTimeout(tick, 250);
      };
      tick();
    });

  const start = async () => {
    if (!tracker || !mapping) return;
    cancelled.current = false;
    setError(null);
    setStep("process");

    // Local working copy; React state mirrors it for the progress view.
    const work: ResumeJob[] = files.map((file, i) => ({
      id: `r${i}-${file.name}`,
      file,
      stem: fileStem(file.name),
      status: "queued",
    }));
    setJobs(work);

    try {
      // 1. Read every file in the browser and decide text vs. image mode.
      setRun({ phase: "reading", batch: 0, totalBatches: 0, nextBatchAt: null });
      for (const job of work) {
        if (cancelled.current) throw new Cancelled();
        patchJob(job.id, { status: "reading" });
        try {
          Object.assign(job, await readResume(job.file), { status: "ready" });
        } catch (e) {
          Object.assign(job, { status: "failed", error: (e as Error).message, data: null });
        }
        patchJob(job.id, { ...job });
      }

      // 2. Send to Gemini in batches, paced for the free tier.
      const readable = work.filter((j) => j.status === "ready");
      const { batches, paced } = planBatches(readable);
      let lastStart = 0;
      for (let b = 0; b < batches.length; b++) {
        if (paced && b > 0) {
          const nextAt = lastStart + PACED_INTERVAL_MS;
          setRun({ phase: "waiting", batch: b, totalBatches: batches.length, nextBatchAt: nextAt });
          await wait(nextAt - Date.now());
        }
        if (cancelled.current) throw new Cancelled();
        lastStart = Date.now();
        setRun({ phase: "extracting", batch: b + 1, totalBatches: batches.length, nextBatchAt: null, batchStart: Date.now(), batchSize: batches[b].length });
        batches[b].forEach((j) => patchJob(j.id, { status: "extracting" }));
        try {
          const results = await extractBatch(batches[b]);
          for (const r of results) {
            const job = work.find((j) => j.id === r.id)!;
            Object.assign(job, { data: r.data, error: r.error, status: r.data ? "done" : "failed" });
            patchJob(job.id, { ...job });
          }
        } catch (e) {
          for (const job of batches[b]) {
            Object.assign(job, { status: "failed", error: (e as Error).message, data: null });
            patchJob(job.id, { ...job });
          }
        }
      }

      // 3. Match with the tracker and build the table.
      setRun({ phase: "building", batch: batches.length, totalBatches: batches.length, nextBatchAt: null, batchStart: Date.now() });
      const result = await buildTable(work, tracker, mapping);
      // Let the progress ring finish its sweep to 100% before showing the table.
      setRun({ phase: "done", batch: batches.length, totalBatches: batches.length, nextBatchAt: null });
      await wait(1900);
      setTable(result);
      setStep("review");
    } catch (e) {
      if (e instanceof Cancelled) {
        setStep("upload");
        return;
      }
      setError((e as Error).message);
      setRun((r) => ({ ...r, phase: "error", message: (e as Error).message }));
    }
  };

  const download = async () => {
    if (!table) return;
    setDownloading(true);
    setError(null);
    try {
      const blob = await exportExcel(table.columns, table.rows);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = timestampName();
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDownloading(false);
    }
  };

  const restart = () => {
    cancelled.current = true;
    setStep("upload");
    setFiles([]);
    setJobs([]);
    setTable(null);
    setError(null);
  };

  const stepIndex = STEPS.findIndex((s) => s.key === step);

  return (
    <div className="min-h-screen">
      <div className="app-bg" aria-hidden="true">
        <div className="blob h-[420px] w-[420px] bg-brand-400/40" style={{ top: "-8%", left: "-6%" }} />
        <div className="blob h-[360px] w-[360px] bg-cyan-brand/35" style={{ top: "40%", right: "-8%", animationDelay: "-6s" }} />
        <div className="blob h-[300px] w-[300px] bg-gold-300/40" style={{ bottom: "-10%", left: "30%", animationDelay: "-12s" }} />
      </div>

      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-xl border-b border-white/60 shadow-[0_1px_0_rgba(10,26,79,0.06)]">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-6 px-6 py-3">
          <div className="flex items-center gap-4">
            <img src="/logo.webp" alt="infinyty" className="h-9 w-auto select-none" draggable={false} />
            <span className="hidden h-8 w-px bg-navy-900/10 sm:block" />
            <div className="hidden whitespace-nowrap md:block">
              <p className="font-display text-[15px] font-semibold leading-tight text-navy-900">Candidate Table Builder</p>
              <p className="text-xs text-slate-500">Resumes + tracker → client-ready Excel</p>
            </div>
          </div>

          <ol className="hidden items-center gap-1 xl:flex">
            {STEPS.map((s, i) => {
              const done = i < stepIndex;
              const active = i === stepIndex;
              return (
                <li key={s.key} className="flex items-center">
                  <div
                    className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm transition-all duration-300 ${
                      active ? "bg-navy-900 text-white shadow-lg shadow-navy-900/20" : done ? "text-emerald-700" : "text-slate-400"
                    }`}
                  >
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold transition-all duration-300 ${
                        active ? "bg-gradient-to-br from-brand-400 to-cyan-brand text-white" : done ? "bg-emerald-500 text-white anim-pop" : "bg-slate-200 text-slate-500"
                      }`}
                    >
                      {done ? <IconCheck size={14} strokeWidth={3} /> : i + 1}
                    </span>
                    <span className="whitespace-nowrap font-medium">{s.label}</span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <span className="mx-1 h-0.5 w-8 overflow-hidden rounded-full bg-slate-200">
                      <span className={`block h-full bg-gradient-to-r from-emerald-400 to-brand-500 transition-all duration-700 ${done ? "w-full" : "w-0"}`} />
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] space-y-6 px-6 py-8">
        {step === "upload" && <Hero />}
        {step === "upload" && <UsageBar usage={usage} loading={usageLoading} />}

        {error && step !== "process" && <Alert tone="red">{error}</Alert>}

        {step === "upload" && (
          <UploadStep
            tracker={tracker}
            setTracker={setTracker}
            mapping={mapping}
            setMapping={setMapping}
            files={files}
            setFiles={setFiles}
            onStart={start}
            quotaLeft={usage?.remaining ?? null}
          />
        )}

        {step === "process" && (
          <>
            <ProcessStep jobs={jobs} run={run} onCancel={() => { cancelled.current = true; setStep("upload"); }} />
            {run.phase === "error" && (
              <div className="flex justify-end">
                <Button onClick={start}>
                  <IconRefresh size={16} /> Try again
                </Button>
              </div>
            )}
          </>
        )}

        {step === "review" && table && (
          <ReviewStep table={table} setTable={setTable} onDownload={download} downloading={downloading} onRestart={restart} />
        )}
      </main>

      <footer className="mx-auto max-w-[1600px] px-6 pb-8 pt-2 text-center text-xs text-slate-400">
        <span className="inline-flex items-center gap-2">
          <img src="/mark.png" alt="" className="h-4 w-4 opacity-70" /> infinyty · Candidate Table Builder
        </span>
      </footer>
    </div>
  );
}

const FEATURES = [
  { icon: <IconImage size={16} />, text: "Reads text & scanned PDFs, Word files" },
  { icon: <IconShield size={16} />, text: "Cross-checks phone, email & name" },
  { icon: <IconSparkles size={16} />, text: "Client-ready Excel in one click" },
];

function Hero() {
  return (
    <section className="hero-bg anim-rise relative overflow-hidden rounded-3xl px-8 py-9 text-white shadow-2xl shadow-navy-900/25">
      <img src="/mark.png" alt="" aria-hidden="true" className="pointer-events-none absolute -right-6 -top-10 h-64 w-64 opacity-[0.12] blur-[1px]" />
      <div className="relative max-w-3xl">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide text-gold-300 ring-1 ring-white/20">
          <IconZap size={13} /> AI-powered candidate summaries
        </span>
        <h1 className="font-display mt-4 text-3xl font-bold leading-tight sm:text-4xl">
          Turn resumes into a <span className="bg-gradient-to-r from-gold-300 to-gold-500 bg-clip-text text-transparent">client-ready table</span> in minutes
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-brand-100/90">
          Upload the recruiter tracker and the candidates' resumes. We extract experience, education and companies,
          match every resume to the right tracker row, and hand you a formatted Excel.
        </p>
        <div className="mt-6 flex flex-wrap gap-2.5">
          {FEATURES.map((f, i) => (
            <span
              key={f.text}
              className="anim-rise inline-flex items-center gap-2 rounded-xl bg-white/10 px-3.5 py-2 text-sm font-medium ring-1 ring-white/15 backdrop-blur"
              style={{ animationDelay: `${0.15 + i * 0.1}s` }}
            >
              <span className="text-cyan-brand">{f.icon}</span>
              {f.text}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
