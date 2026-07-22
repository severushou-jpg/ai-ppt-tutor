import type { ProcessingJob } from "@/lib/client-storage";
export { estimateRemainingMs, pipelineProgress } from "@/lib/processing-metrics.js";

export async function computeFileFingerprint(file: Blob): Promise<string> {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export function fileFromProcessingJob(job: ProcessingJob) {
  return new File([job.fileBlob], job.fileName, { type: job.fileType });
}
