import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { RowStatus, TableResult, TableRow } from "../types";
import { Alert, Avatar, Badge, Button } from "./ui";
import {
  IconAlert, IconCheckCircle, IconDownload, IconEdit, IconFileText, IconImage, IconLoader,
  IconRefresh, IconSparkles, IconTrash, IconXCircle,
} from "./icons";

const STATUS: Record<RowStatus, { label: string; tone: "green" | "amber" | "red"; icon: ReactNode; card: string }> = {
  matched: { label: "Matched", tone: "green", icon: <IconCheckCircle size={22} />, card: "from-emerald-500 to-emerald-400 shadow-emerald-500/30" },
  check: { label: "Check", tone: "amber", icon: <IconAlert size={22} />, card: "from-gold-500 to-gold-400 shadow-gold-500/30" },
  unmatched: { label: "Unmatched", tone: "red", icon: <IconXCircle size={22} />, card: "from-rose-500 to-rose-400 shadow-rose-500/30" },
  failed: { label: "Not read", tone: "red", icon: <IconFileText size={22} />, card: "from-slate-500 to-slate-400 shadow-slate-500/30" },
};

const WIDTH: Record<string, string> = {
  Name: "min-w-[150px]",
  "No. of Years of Experience": "min-w-[105px]",
  "Education (Highest)": "min-w-[240px]",
  "Companies (Last 3)": "min-w-[380px]",
  "Contact No": "min-w-[120px]",
  "Email id": "min-w-[210px]",
  "Current CTC (Fixed) + Any variable": "min-w-[175px]",
  "Expected CTC (Fixed)": "min-w-[115px]",
  "Notice Period/Offer status": "min-w-[250px]",
  Recruiter_Comments: "min-w-[190px]",
};

function CountUp({ value }: { value: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 700);
      setN(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{n}</>;
}

const CONFETTI_COLORS = ["#2f6bff", "#22c3f3", "#f5b82e", "#1e4fd8", "#ffd977", "#10b981"];

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => {
        const angle = (i / 36) * Math.PI * 2;
        const dist = 90 + (i % 5) * 28;
        return {
          dx: `${Math.cos(angle) * dist}px`,
          dy: `${Math.sin(angle) * dist * 0.6 + 40}px`,
          rot: `${(i * 47) % 360}deg`,
          color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          w: 6 + (i % 3) * 2,
          delay: `${(i % 6) * 0.02}s`,
        };
      }),
    [],
  );
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2" aria-hidden="true">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti-piece absolute block rounded-sm"
          style={{
            width: p.w, height: p.w * 0.45, background: p.color, animationDelay: p.delay,
            ["--dx" as string]: p.dx, ["--dy" as string]: p.dy, ["--rot" as string]: p.rot,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

export default function ReviewStep({ table, setTable, onDownload, downloading, onRestart }: {
  table: TableResult;
  setTable: (t: TableResult) => void;
  onDownload: () => void;
  downloading: boolean;
  onRestart: () => void;
}) {
  const [filter, setFilter] = useState<"all" | "issues">("all");

  const counts = useMemo(() => {
    const c: Record<RowStatus, number> = { matched: 0, check: 0, unmatched: 0, failed: 0 };
    table.rows.forEach((r) => c[r.status]++);
    return c;
  }, [table]);

  const issueRows = table.rows.filter((r) => r.status !== "matched" || r.notes.length);
  const rows = filter === "issues" ? issueRows : table.rows;
  const allClear = counts.check + counts.unmatched + counts.failed === 0;

  const update = (id: string, patch: Partial<TableRow>) =>
    setTable({ ...table, rows: table.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) });

  const setCell = (row: TableRow, col: string, value: string) => {
    if (row.values[col] === value) return;
    update(row.id, { values: { ...row.values, [col]: value } });
  };

  const remove = (id: string) => setTable({ ...table, rows: table.rows.filter((r) => r.id !== id) });

  return (
    <div className="space-y-6">
      <section className="hero-bg anim-rise relative flex flex-wrap items-center justify-between gap-6 overflow-hidden rounded-3xl px-8 py-7 text-white shadow-2xl shadow-navy-900/25">
        <Confetti />
        <div className="relative flex items-center gap-4">
          <span className="anim-pop flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25">
            <IconSparkles size={28} className="text-gold-300" />
          </span>
          <div>
            <h2 className="font-display text-2xl font-bold">Your table is ready</h2>
            <p className="mt-0.5 text-sm text-brand-100/90">
              {table.rows.length} candidates, sorted by experience.{" "}
              {allClear ? "Everything matched cleanly." : "A few rows need a quick look before you download."}
            </p>
          </div>
        </div>
        <div className="relative flex flex-wrap items-center gap-3">
          <button
            onClick={onRestart}
            className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold ring-1 ring-white/25 transition hover:bg-white/20"
          >
            <IconRefresh size={16} /> Start over
          </button>
          <Button variant="gold" size="lg" onClick={onDownload} disabled={downloading || !table.rows.length}>
            {downloading ? <IconLoader size={18} className="anim-spin" /> : <IconDownload size={18} />}
            {downloading ? "Preparing…" : "Download Excel"}
          </Button>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {(Object.keys(STATUS) as RowStatus[]).map((s, i) => (
          <div
            key={s}
            className="glass card-glow anim-rise flex items-center gap-4 rounded-2xl border border-white/70 px-5 py-4"
            style={{ animationDelay: `${0.05 + i * 0.06}s` }}
          >
            <span className={`flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-lg ${STATUS[s].card}`}>
              {STATUS[s].icon}
            </span>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">{STATUS[s].label}</div>
              <div className="font-display text-3xl font-bold text-navy-900"><CountUp value={counts[s]} /></div>
            </div>
          </div>
        ))}
      </div>

      {!allClear && (
        <Alert tone="amber">
          Review rows marked <b>Check</b>, <b>Unmatched</b> or <b>Not read</b>. Click any cell to edit it. Rows with
          “Red in Excel” ticked are coloured red in the downloaded file.
        </Alert>
      )}

      <section className="glass card-glow anim-rise rounded-3xl border border-white/70" style={{ animationDelay: "0.2s" }}>
        <header className="flex flex-wrap items-center justify-between gap-4 px-6 pt-5 pb-4">
          <div>
            <h3 className="font-display text-[17px] font-semibold text-navy-900">Review table</h3>
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-500">
              <IconEdit size={14} /> Every cell is editable — changes go straight into the Excel.
            </p>
          </div>
          <div className="inline-flex rounded-xl bg-navy-900/5 p-1">
            {([["all", `All (${table.rows.length})`], ["issues", `Needs attention (${issueRows.length})`]] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-all ${
                  filter === key ? "bg-white text-navy-900 shadow" : "text-slate-500 hover:text-navy-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </header>

        <div className="px-4 pb-5">
          <div className="overflow-auto rounded-2xl border border-navy-900/10 bg-white">
            <table className="border-collapse text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-20 border-b border-r border-white/10 bg-navy-950 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-brand-100">
                    Review
                  </th>
                  {table.columns.map((c) => (
                    <th key={c} className={`border-b border-r border-white/10 bg-gradient-to-b from-navy-800 to-navy-900 px-3 py-3 text-center text-xs font-semibold text-white ${WIDTH[c] ?? ""}`}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => {
                  const red = row.highlight;
                  const rowBg = red ? "bg-rose-50" : row.status === "check" ? "bg-amber-50/70" : idx % 2 ? "bg-brand-50/40" : "bg-white";
                  return (
                    <tr key={row.id} className={`row-enter group transition-colors ${rowBg} hover:bg-brand-50`} style={{ animationDelay: `${Math.min(idx, 15) * 0.035}s` }}>
                      <td className={`sticky left-0 z-10 w-72 min-w-[18rem] border-b border-r border-slate-200 px-4 py-3 align-top ${rowBg} group-hover:bg-brand-50`}>
                        <div className="flex items-center gap-2.5">
                          <Avatar name={row.values["Name"] || "?"} size={30} />
                          <div className="min-w-0 flex-1">
                            <Badge tone={STATUS[row.status].tone}>{STATUS[row.status].label}</Badge>
                            <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-500" title={row.source}>
                              {row.read_mode === "file" ? <IconImage size={12} /> : <IconFileText size={12} />}
                              <span className="truncate">{row.source}</span>
                            </div>
                          </div>
                          <button
                            className="rounded-md p-1.5 text-slate-300 opacity-0 transition group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-600"
                            onClick={() => remove(row.id)}
                            title="Remove row"
                          >
                            <IconTrash size={15} />
                          </button>
                        </div>
                        {row.experience_source && (
                          <div className="mt-1.5 text-xs text-slate-400">Experience {row.experience_source}</div>
                        )}
                        {row.notes.length > 0 && (
                          <ul className="mt-1.5 space-y-1">
                            {row.notes.map((n, i) => (
                              <li key={i} className="flex gap-1.5 rounded-lg bg-amber-100/60 px-2 py-1 text-xs text-amber-900">
                                <IconAlert size={12} className="mt-0.5 shrink-0 text-amber-600" /> {n}
                              </li>
                            ))}
                          </ul>
                        )}
                        <label className="mt-2 inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 accent-rose-600"
                            checked={red}
                            onChange={(e) => update(row.id, { highlight: e.target.checked })}
                          />
                          Red in Excel
                        </label>
                      </td>
                      {table.columns.map((c) => (
                        <td
                          key={c}
                          className={`border-b border-r border-slate-200 px-3 py-3 text-center align-middle whitespace-pre-wrap leading-relaxed ${red ? "text-rose-800" : "text-navy-900"} ${WIDTH[c] ?? ""}`}
                        >
                          <div
                            key={row.values[c]}
                            className="cell-edit min-h-[1.25rem] rounded-md px-1 transition hover:bg-white/80 hover:ring-1 hover:ring-brand-200"
                            contentEditable
                            suppressContentEditableWarning
                            onBlur={(e) => setCell(row, c, e.currentTarget.innerText.replace(/\n$/, ""))}
                          >
                            {row.values[c]}
                          </div>
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={table.columns.length + 1} className="px-6 py-12 text-center text-sm text-slate-500">
                      <IconCheckCircle size={28} className="mx-auto mb-2 text-emerald-500" />
                      Nothing needs attention.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
