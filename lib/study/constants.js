import os from "node:os";
import path from "node:path";

export const STUDY_DURATION_SECONDS = 25 * 60;
export const STUDY_DURATION_MS = STUDY_DURATION_SECONDS * 1_000;

export const STUDY_STRATA = Object.freeze(["novice", "experienced"]);

export const STUDY_STATUSES = Object.freeze({
  PREPARED: "prepared",
  ACTIVE: "active",
  COMPLETED: "completed",
  INTERRUPTED: "interrupted",
  WITHDRAWN: "withdrawn",
});

export const FINALIZE_REASONS = Object.freeze([
  "time_limit",
  "early_completion",
  "researcher_stop",
  "technical_failure",
  "participant_withdrawal",
]);

export function configuredStudyRecordRoot() {
  const configured = process.env.STUDY_RECORD_ROOT?.trim();
  return path.resolve(configured || path.join(os.homedir(), "Desktop", "research_record"));
}
