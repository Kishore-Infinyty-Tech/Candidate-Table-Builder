import { useEffect, useState } from "react";
import type { UsageSummary } from "../types";
import { IconClock, IconInfo, IconZap } from "./icons";

function prettyModel(model: string): string {
  // "gemini-3.1-flash-lite" -> "Flash-Lite 3.1"
  const m = model.match(/gemini-([\d.]+)-(flash(?:-lite)?)/i);
  if (!m) return model;
  const kind = m[2].toLowerCase() === "flash-lite" ? "Flash-Lite" : "Flash";
  return `${kind} ${m[1]}`;
}

function level(percent: number) {
  if (percent >= 85) return { bar: "from-rose-500 to-rose-400", text: "text-rose-600", chip: "bg-rose-50 text-rose-700 ring-rose-600/20", label: "Almost used up" };
  if (percent >= 60) return { bar: "from-gold-500 to-gold-400", text: "text-gold-600", chip: "bg-amber-50 text-amber-800 ring-amber-500/30", label: "Running low" };
  return { bar: "from-emerald-500 to-cyan-brand", text: "text-emerald-600", chip: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", label: "Plenty left" };
}

function useCountdown(seconds: number) {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, seconds - Math.floor((now - start) / 1000));
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function UsageBar({ usage, loading }: { usage: UsageSummary | null; loading: boolean }) {
  const resetsIn = useCountdown(usage?.resets_in_seconds ?? 0);

  if (!usage) {
    return (
      <div className="glass card-glow flex h-[118px] items-center gap-3 rounded-2xl border border-white/70 px-6 text-sm text-slate-400">
        <IconZap size={18} className={loading ? "anim-pulse" : ""} /> {loading ? "Checking Gemini quota…" : "Gemini quota unavailable"}
      </div>
    );
  }

  const lv = level(usage.percent_used);
  const resetTime = new Date(usage.resets_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const anyGuess = usage.models.some((m) => !m.limit_confirmed);

  return (
    <section className="glass card-glow anim-rise rounded-2xl border border-white/70 px-6 py-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-navy-800 to-brand-500 text-white shadow-lg shadow-brand-500/30">
            <IconZap size={21} />
          </span>
          <div>
            <h2 className="font-display text-[17px] font-semibold text-navy-900">Gemini free quota · today</h2>
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-500">
              <IconClock size={14} /> Resets at {resetTime} · in {resetsIn}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-5">
          <span className={`hidden rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset sm:inline-flex ${lv.chip}`}>{lv.label}</span>
          <div className="text-right">
            <div className="font-display text-3xl font-bold leading-none text-navy-900">
              ~{usage.remaining}
              <span className="ml-1.5 text-sm font-semibold text-slate-400">resumes left</span>
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {usage.used} of ~{usage.limit} used · <span className={`font-semibold ${lv.text}`}>{usage.percent_used}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* One segment per model, sized by its daily limit, filled by its usage. */}
      <div className="mt-4 flex h-3.5 gap-1 overflow-hidden rounded-full">
        {usage.models.map((m) => (
          <div
            key={m.model}
            className="relative h-full overflow-hidden rounded-full bg-slate-200/80"
            style={{ flexGrow: m.limit, flexBasis: 0 }}
            title={`${prettyModel(m.model)}: ${m.used}/${m.limit}${m.exhausted ? " (used up)" : ""}`}
          >
            <div
              className={`h-full rounded-full bg-gradient-to-r transition-all duration-700 ${m.exhausted ? "from-slate-400 to-slate-300" : lv.bar}`}
              style={{ width: `${Math.min(100, (100 * m.used) / Math.max(1, m.limit))}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-1">
        {usage.models.map((m) => (
          <div key={m.model} className="min-w-0 text-xs" style={{ flexGrow: m.limit, flexBasis: 0 }}>
            <div className="truncate font-medium text-navy-800">{prettyModel(m.model)}</div>
            <div className="truncate text-slate-400">
              {m.exhausted ? <span className="font-semibold text-slate-500">used up</span> : `${m.used}/${m.limit_confirmed ? "" : "~"}${m.limit}`}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-400">
        <IconInfo size={13} className="mt-px shrink-0" />
        Approximate: counted by this app (1 resume = 1 request). Models are used in order; when one is used up the next takes over.
        {anyGuess && " Limits marked ~ are estimates until Google confirms them."}
      </p>
    </section>
  );
}
