import type { ResumeJob } from "../types";

/** Up to this many resumes are sent together with no waiting. */
export const SMALL_RUN_LIMIT = 10;
/** Larger runs are paced: this many resumes per batch... */
export const PACED_BATCH_SIZE = 5;
/** ...and one batch per this many milliseconds (Gemini free-tier friendly). */
export const PACED_INTERVAL_MS = 60_000;
/** Keep each request well under Vercel's 4.5 MB body limit. */
export const MAX_BATCH_BYTES = 3 * 1024 * 1024;

function payloadSize(job: ResumeJob): number {
  return (job.mode === "file" ? job.fileB64?.length : job.text?.length) ?? 0;
}

export interface BatchPlan {
  batches: ResumeJob[][];
  paced: boolean;
}

export function planBatches(jobs: ResumeJob[]): BatchPlan {
  const paced = jobs.length > SMALL_RUN_LIMIT;
  const maxCount = paced ? PACED_BATCH_SIZE : SMALL_RUN_LIMIT;
  const batches: ResumeJob[][] = [];
  let current: ResumeJob[] = [];
  let bytes = 0;
  for (const job of jobs) {
    const size = payloadSize(job);
    if (current.length && (current.length >= maxCount || bytes + size > MAX_BATCH_BYTES)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(job);
    bytes += size;
  }
  if (current.length) batches.push(current);
  return { batches, paced };
}
