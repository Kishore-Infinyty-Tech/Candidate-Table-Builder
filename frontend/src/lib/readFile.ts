import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import mammoth from "mammoth";
import type { ReadMode } from "../types";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** A page with fewer readable characters than this is treated as an image page. */
const MIN_CHARS_PER_PAGE = 200;

export interface ReadResult {
  mode: ReadMode;
  text?: string;
  fileB64?: string;
  mimeType?: string;
}

function cleanText(text: string): string {
  return text
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function pdfText(buffer: ArrayBuffer): Promise<{ text: string; pages: number }> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let pageText = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      pageText += item.str + (item.hasEOL ? "\n" : " ");
    }
    pages.push(pageText);
  }
  const count = doc.numPages;
  await doc.destroy();
  return { text: cleanText(pages.join("\n\n")), pages: count };
}

/**
 * Decide per file how Gemini should read it:
 *  - DOCX, or a PDF with real text  -> send the text (small and fast)
 *  - PDF that is scanned / image    -> send the PDF itself
 */
export async function readResume(file: File): Promise<ReadResult> {
  const name = file.name.toLowerCase();
  const buffer = await file.arrayBuffer();

  if (name.endsWith(".docx")) {
    const { value } = await mammoth.extractRawText({ arrayBuffer: buffer });
    const text = cleanText(value);
    if (text.replace(/\s/g, "").length < MIN_CHARS_PER_PAGE) {
      throw new Error("This Word file has almost no readable text. Save it as PDF and upload again.");
    }
    return { mode: "text", text };
  }

  if (name.endsWith(".pdf")) {
    try {
      const { text, pages } = await pdfText(buffer);
      const readable = text.replace(/\s/g, "").length;
      if (readable / Math.max(pages, 1) >= MIN_CHARS_PER_PAGE) {
        return { mode: "text", text };
      }
    } catch {
      // Damaged or protected PDF: let Gemini try the file itself.
    }
    return { mode: "file", fileB64: toBase64(buffer), mimeType: "application/pdf" };
  }

  throw new Error("Only PDF and DOCX resumes are supported.");
}

export function isResumeFile(file: File): boolean {
  return /\.(pdf|docx)$/i.test(file.name);
}

export function fileStem(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();
}
