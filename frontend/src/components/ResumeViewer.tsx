import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import mammoth from "mammoth";
import { norm, type HighlightTerm } from "../lib/evidence";
import { IconAlert, IconImage, IconLoader } from "./icons";

export interface Focus {
  column: string;
  nonce: number;
}

type Term = HighlightTerm;

/** Words too common on resumes to highlight on their own. */
const GENERIC = new Set([
  "data", "engineer", "engineering", "senior", "junior", "lead", "manager", "analyst", "developer", "consultant",
  "years", "year", "experience", "science", "technology", "technologies", "institute", "university", "college",
  "management", "services", "solutions", "limited", "private", "india", "software", "systems", "system",
  "business", "analytics", "school", "global", "group", "associate", "present",
]);

/** Mark an element as a highlight for the given columns. */
function tag(el: HTMLElement, columns: string[]) {
  el.classList.add("hl");
  el.dataset.cols = Array.from(new Set([...(el.dataset.cols ?? "").split("|").filter(Boolean), ...columns])).join("|");
}

/** Which columns a text fragment belongs to. Matches whole terms inside the
 *  fragment, and fragments that are part of a longer term (PDF text is split
 *  into many small pieces). */
function columnsFor(fragment: string, terms: Term[]): string[] {
  const f = norm(fragment);
  const fd = fragment.replace(/\D/g, "");
  if (!f) return [];
  const cols: string[] = [];
  for (const { term, column, partial } of terms) {
    const t = norm(term);
    if (!t) continue;
    if (/^\d{7,}$/.test(t)) {
      if (fd.length >= 7 && (fd.includes(t) || t.includes(fd))) cols.push(column);
    } else if (f.includes(t)) {
      cols.push(column);
    } else if (partial && f.length >= 5 && t.includes(f) && f.split(" ").some((w) => w.length >= 4 && !GENERIC.has(w))) {
      cols.push(column);
    }
  }
  return cols;
}

async function renderPdf(container: HTMLElement, data: ArrayBuffer, width: number, zoom: number, terms: Term[], isCancelled: () => boolean) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) }).promise;
  let anyText = false;
  for (let p = 1; p <= doc.numPages; p++) {
    if (isCancelled()) break;
    const page = await doc.getPage(p);
    const base = page.getViewport({ scale: 1 });
    const scale = (width / base.width) * zoom;
    const viewport = page.getViewport({ scale });

    const wrap = document.createElement("div");
    wrap.className = "pdf-page anim-rise";
    wrap.style.width = `${viewport.width}px`;
    wrap.style.height = `${viewport.height}px`;
    wrap.style.setProperty("--scale-factor", String(scale));

    const ratio = window.devicePixelRatio || 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    wrap.appendChild(canvas);

    const layer = document.createElement("div");
    layer.className = "textLayer";
    wrap.appendChild(layer);
    container.appendChild(wrap);

    await page.render({
      canvasContext: canvas.getContext("2d")!,
      viewport,
      transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
    }).promise;

    const content = await page.getTextContent();
    if (content.items.some((i) => "str" in i && i.str.trim())) anyText = true;
    const textLayer = new pdfjs.TextLayer({ textContentSource: content, container: layer, viewport });
    await textLayer.render();
    layer.querySelectorAll("span").forEach((span) => {
      const cols = columnsFor(span.textContent ?? "", terms);
      if (cols.length) tag(span as HTMLElement, cols);
    });
  }
  await doc.destroy();
  return anyText;
}

async function renderDocx(container: HTMLElement, data: ArrayBuffer, terms: Term[]) {
  const { value } = await mammoth.convertToHtml({ arrayBuffer: data });
  const paper = document.createElement("div");
  paper.className = "docx-page anim-rise";
  paper.innerHTML = value;
  container.appendChild(paper);

  // Wrap each matching term in a <mark>, longest terms first.
  for (const { term, column } of terms) {
    const needle = term.trim();
    if (needle.length < 3) continue;
    const walker = document.createTreeWalker(paper, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    for (const node of nodes) {
      if (node.parentElement?.closest("mark")) continue;
      const idx = node.data.toLowerCase().indexOf(needle.toLowerCase());
      if (idx < 0) continue;
      const hit = node.splitText(idx);
      hit.splitText(needle.length);
      const mark = document.createElement("mark");
      hit.parentNode!.replaceChild(mark, hit);
      mark.appendChild(hit);
      tag(mark, [column]);
    }
  }
}

export default function ResumeViewer({ file, scanned, terms, focus }: {
  file: File | null;
  scanned: boolean;
  terms: Term[];
  focus: Focus | null;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const pages = useRef<HTMLDivElement>(null);
  const lastFile = useRef<File | null>(null);
  const [zoom, setZoom] = useState(1);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [noText, setNoText] = useState(false);
  const [width, setWidth] = useState(0);
  const termKey = JSON.stringify(terms);

  // Fit pages to the panel width. The scroller reserves space for its scrollbar
  // (scrollbar-gutter: stable) and small changes are ignored; otherwise drawing
  // the pages adds a scrollbar, the width shrinks, the pages redraw, the
  // scrollbar goes away... and the viewer blinks forever.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => {
      const next = Math.max(320, Math.min(el.clientWidth - 48, 980));
      setWidth((prev) => (prev && Math.abs(prev - next) < 24 ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const container = pages.current;
    if (!container || !width) return;
    if (!file) {
      container.innerHTML = "";
      return;
    }
    let cancelled = false;
    // A different resume replaces the old one straight away.
    if (lastFile.current !== file) {
      container.innerHTML = "";
      lastFile.current = file;
    }
    // Draw into a hidden host and swap it in when finished, so a redraw (zoom,
    // resize) never shows an empty page. A cancelled draw just drops its host.
    const host = document.createElement("div");
    host.className = "flex flex-col items-center gap-5";
    host.style.display = "none";
    container.appendChild(host);
    const hasOld = container.children.length > 1;
    if (!hasOld) setState("loading");
    setNoText(false);
    (async () => {
      try {
        const data = await file.arrayBuffer();
        let anyText = true;
        if (/\.docx$/i.test(file.name)) {
          await renderDocx(host, data, terms);
        } else {
          anyText = await renderPdf(host, data, width, zoom, terms, () => cancelled);
        }
        if (cancelled) return;
        Array.from(container.children).forEach((c) => c !== host && c.remove());
        host.style.display = "";
        setNoText(!anyText);
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
      if (host.style.display === "none") host.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, width, zoom, termKey]);

  // Jump to the first highlight of the focused column.
  useEffect(() => {
    if (!focus || !pages.current) return;
    const hits = Array.from(pages.current.querySelectorAll<HTMLElement>(".hl")).filter((el) =>
      (el.dataset.cols ?? "").split("|").includes(focus.column),
    );
    pages.current.querySelectorAll(".hl-focus").forEach((el) => el.classList.remove("hl-focus"));
    if (!hits.length) return;
    hits.forEach((el) => el.classList.add("hl-focus"));
    hits[0].scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focus]);

  const isDocx = !!file && /\.docx$/i.test(file.name);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-navy-900/5 bg-white/70 px-5 py-2.5 backdrop-blur">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${isDocx ? "bg-brand-50 text-brand-600" : "bg-rose-50 text-rose-600"}`}>
            {isDocx ? "DOCX" : "PDF"}
          </span>
          <span className="truncate font-medium text-navy-900" title={file?.name}>{file?.name ?? "No resume"}</span>
          {scanned && (
            <span className="inline-flex items-center gap-1 rounded-full bg-gold-300/30 px-2 py-0.5 text-[11px] font-semibold text-gold-600">
              <IconImage size={11} /> Scanned
            </span>
          )}
        </div>
        {!isDocx && file && (
          <div className="flex items-center gap-1 rounded-lg bg-navy-900/5 p-0.5 text-sm">
            <button className="rounded-md px-2 py-0.5 font-semibold text-navy-800 hover:bg-white" onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.15).toFixed(2)))} aria-label="Zoom out">−</button>
            <button className="min-w-[3.2rem] rounded-md px-1 py-0.5 text-xs font-semibold tabular-nums text-slate-500 hover:bg-white" onClick={() => setZoom(1)} title="Fit width">
              {Math.round(zoom * 100)}%
            </button>
            <button className="rounded-md px-2 py-0.5 font-semibold text-navy-800 hover:bg-white" onClick={() => setZoom((z) => Math.min(2.2, +(z + 0.15).toFixed(2)))} aria-label="Zoom in">+</button>
          </div>
        )}
      </div>

      {(noText || (scanned && state === "ready")) && (
        <div className="mx-5 mt-3 flex items-center gap-2 rounded-xl border border-gold-400/40 bg-gold-300/15 px-3 py-2 text-xs text-navy-800">
          <IconAlert size={14} className="shrink-0 text-gold-600" />
          This is a scanned / image resume, so text can't be highlighted. Compare the values by eye.
        </div>
      )}

      <div ref={scroller} className="viewer-bg relative min-h-0 flex-1 overflow-auto" style={{ scrollbarGutter: "stable" }}>
        {!file && <div className="flex h-full items-center justify-center text-sm text-slate-400">No resume for this candidate — tracker values only.</div>}
        {file && state === "loading" && (
          <div className="pointer-events-none absolute inset-x-0 top-24 z-10 flex justify-center">
            <span className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-navy-800 shadow-lg">
              <IconLoader size={16} className="anim-spin text-brand-500" /> Opening resume…
            </span>
          </div>
        )}
        {state === "error" && <div className="p-10 text-center text-sm text-rose-600">This file could not be displayed.</div>}
        <div ref={pages} className="flex flex-col items-center gap-5 px-6 py-6" />
      </div>
    </div>
  );
}
