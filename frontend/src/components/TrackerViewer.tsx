import { useEffect, useMemo, useRef } from "react";
import type { Mapping, TrackerInfo } from "../types";
import { columnLetter } from "../lib/evidence";

export interface CellFocus {
  refs: string[];
  nonce: number;
}

/** The whole tracker sheet next to the output. The candidate's row is
 *  highlighted, and every cell whose value went into the output gets a thick
 *  border, so it is easy to compare and to spot a mixed-up row. */
export default function TrackerViewer({ tracker, mapping, rowIndex, used, focus }: {
  tracker: TrackerInfo | null;
  mapping: Mapping | null;
  rowIndex: number | null;
  /** cell ref (e.g. "E5") -> output columns it fed */
  used: Record<string, string[]>;
  focus: CellFocus | null;
}) {
  const box = useRef<HTMLDivElement>(null);

  const rowNumber = (i: number) => tracker?.row_numbers?.[i] ?? i + 2;
  const nameCol = mapping?.name ?? null;
  const row = tracker && rowIndex !== null ? tracker.rows[rowIndex] : null;
  const candidate = row && nameCol !== null ? row[nameCol] : "";
  const usedCount = Object.keys(used).length;

  // Scroll to the focused cells, or to the candidate's row.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.querySelectorAll(".cell-focus").forEach((c) => c.classList.remove("cell-focus"));
    const targets = (focus?.refs ?? [])
      .map((ref) => el.querySelector<HTMLElement>(`[data-ref="${ref}"]`))
      .filter((x): x is HTMLElement => !!x);
    if (targets.length) {
      void el.offsetWidth; // restart the pulse animation
      targets.forEach((t) => t.classList.add("cell-focus"));
      targets[0].scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    } else {
      el.querySelector<HTMLElement>("[data-current-row]")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [focus, rowIndex]);

  const usedCols = useMemo(() => {
    const s = new Set<number>();
    if (mapping) Object.values(mapping).forEach((c) => c !== null && s.add(c));
    return s;
  }, [mapping]);

  if (!tracker) {
    return <div className="flex h-full items-center justify-center text-sm text-slate-400">No tracker loaded.</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-navy-900/5 bg-white/70 px-5 py-2.5 backdrop-blur">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">XLSX</span>
          <span className="truncate font-medium text-navy-900" title={tracker.fileName}>{tracker.fileName}</span>
          {rowIndex !== null ? (
            <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">
              Row {rowNumber(rowIndex)} · {candidate}
            </span>
          ) : (
            <span className="shrink-0 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">No matching row</span>
          )}
        </div>
        {usedCount > 0 && (
          <span className="inline-flex items-center gap-2 text-xs font-medium text-slate-500">
            <span className="h-3.5 w-5 rounded-[3px] border-[2.5px] border-navy-700 bg-gold-300/40" />
            {usedCount} cells taken from the tracker
          </span>
        )}
      </div>

      <div ref={box} className="viewer-bg min-h-0 flex-1 overflow-auto">
        {rowIndex === null && (
          <div className="mx-4 mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-800">
            This resume did not match any tracker row. Look for the candidate in the sheet below.
          </div>
        )}
        <div className="p-4">
          <div className="anim-rise inline-block min-w-full overflow-hidden rounded-xl bg-white shadow-[0_1px_2px_rgba(10,26,79,0.08),0_18px_40px_-18px_rgba(10,26,79,0.35)]">
            <table className="border-collapse text-[12.5px]">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-30 border-b border-r border-slate-200 bg-slate-100 px-2 py-1.5" />
                  {tracker.headers.map((_, ci) => (
                    <th key={ci} className={`sticky top-0 z-20 border-b border-r border-slate-200 px-2 py-1 text-center font-mono text-[11px] font-bold ${usedCols.has(ci) ? "bg-navy-900 text-white" : "bg-slate-100 text-slate-500"}`}>
                      {columnLetter(ci)}
                    </th>
                  ))}
                </tr>
                <tr>
                  <th className="sticky left-0 z-20 border-b border-r border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-400">1</th>
                  {tracker.headers.map((h, ci) => (
                    <th key={ci} className={`max-w-[14rem] border-b border-r border-slate-200 px-2.5 py-1.5 text-left text-[11px] font-semibold ${usedCols.has(ci) ? "bg-brand-50 text-navy-800" : "bg-slate-50 text-slate-500"}`} title={h}>
                      <span className="line-clamp-2">{h}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tracker.rows.map((r, ri) => {
                  const current = ri === rowIndex;
                  return (
                    <tr key={ri} data-current-row={current ? "" : undefined} className={current ? "bg-gold-300/45" : ri % 2 ? "bg-white" : "bg-slate-50/50"}>
                      <td className={`sticky left-0 z-10 border-b border-r border-slate-200 px-2 py-2 text-center text-[11px] font-semibold ${current ? "bg-gold-500 text-navy-900" : "bg-slate-50 text-slate-400"}`}>
                        {rowNumber(ri)}
                      </td>
                      {tracker.headers.map((_, ci) => {
                        const ref = `${columnLetter(ci)}${rowNumber(ri)}`;
                        const feeds = current ? used[ref] ?? [] : [];
                        return (
                          <td
                            key={ci}
                            data-ref={ref}
                            title={feeds.length ? `${ref} → ${feeds.join(", ")}` : ref}
                            className={`tracker-cell max-w-[14rem] truncate border-b border-r border-slate-200 px-2.5 py-2 ${
                              feeds.length ? "used-cell font-semibold text-navy-900" : current ? "text-navy-900" : "text-slate-500"
                            }`}
                          >
                            {r[ci] ?? ""}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
