const PHASE_RANGES = Object.freeze({
  hashing: [0, 5],
  preparing_ocr: [5, 8],
  rendering: [8, 25],
  ocr: [25, 45],
  uploading: [45, 55],
  parsing: [55, 68],
  vision: [68, 82],
  indexing: [82, 99],
  ready: [100, 100],
});

/**
 * @param {string} phase
 * @param {number} [current]
 * @param {number | null} [total]
 */
export function pipelineProgress(phase, current = 0, total = null) {
  const [start, end] = PHASE_RANGES[phase] ?? [0, 0];
  const ratio = total && total > 0 ? Math.max(0, Math.min(1, current / total)) : 0;
  return Math.round(start + (end - start) * ratio);
}

/**
 * @param {number} startedAt
 * @param {number} progress
 * @param {number} [now]
 * @returns {number | null}
 */
export function estimateRemainingMs(startedAt, progress, now = Date.now()) {
  if (progress < 3 || progress >= 100) return null;
  const elapsed = Math.max(0, now - startedAt);
  return Math.round((elapsed * (100 - progress)) / progress);
}
