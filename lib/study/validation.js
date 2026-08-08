import { FINALIZE_REASONS, STUDY_STRATA } from "./constants.js";
import { STUDY_CONDITIONS } from "./conditions.js";

export const STUDY_ID_PATTERN = /^APTT-\d{3}$/;
const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9_:-]{0,79}$/;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/i;

const ALLOWED_METADATA_KEYS = new Set([
  "answerPackVersion",
  "appVersion",
  "buildCommit",
  "citationMapVersion",
  "materialHash",
  "materialVersion",
  "modelVersion",
  "promptVersion",
]);

const SECRET_KEY_PATTERN = /(?:api[_-]?key|authorization|cookie|password|secret|session[_-]?token|access[_-]?token)/i;
const SECRET_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\bsk-[A-Za-z0-9_-]{8,}/gi,
];

const MAX_STRING_LENGTH = 100_000;
const MAX_ARRAY_LENGTH = 1_000;
const MAX_OBJECT_KEYS = 200;
const MAX_DEPTH = 8;

export class StudyError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.name = "StudyError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function requireString(value, code, label) {
  if (typeof value !== "string") {
    throw new StudyError(code, `${label} must be a string.`);
  }
  return value.trim();
}

export function validateStudyId(value) {
  const studyId = requireString(value, "INVALID_STUDY_ID", "Study ID");
  if (!STUDY_ID_PATTERN.test(studyId)) {
    throw new StudyError("INVALID_STUDY_ID", "Study ID must match APTT-###.");
  }
  return studyId;
}

export function validateCondition(value) {
  const condition = requireString(value, "INVALID_CONDITION", "Condition").toUpperCase();
  if (!Object.values(STUDY_CONDITIONS).includes(condition)) {
    throw new StudyError("INVALID_CONDITION", "Condition must be A, B, C, or D.");
  }
  return condition;
}

export function validateStratum(value) {
  const stratum = requireString(value, "INVALID_STRATUM", "Prior database experience").toLowerCase();
  if (!STUDY_STRATA.includes(stratum)) {
    throw new StudyError("INVALID_STRATUM", "Prior database experience must be novice or experienced.");
  }
  return stratum;
}

export function validateSessionToken(value) {
  const token = requireString(value, "INVALID_SESSION_TOKEN", "Session token");
  if (!TOKEN_PATTERN.test(token)) {
    throw new StudyError("INVALID_SESSION_TOKEN", "Session token is invalid.", 401);
  }
  return token.toLowerCase();
}

export function validateFinalizeReason(value) {
  const reason = value === undefined
    ? "time_limit"
    : requireString(value, "INVALID_FINALIZE_REASON", "Finalize reason").toLowerCase();
  if (!FINALIZE_REASONS.includes(reason)) {
    throw new StudyError("INVALID_FINALIZE_REASON", "Finalize reason is not supported.");
  }
  return reason;
}

export function validateEventType(value) {
  const type = requireString(value, "INVALID_EVENT_TYPE", "Event type").toLowerCase();
  if (!EVENT_TYPE_PATTERN.test(type)) {
    throw new StudyError("INVALID_EVENT_TYPE", "Event type contains unsupported characters.");
  }
  return type;
}

function redactSecrets(value) {
  let result = value.slice(0, MAX_STRING_LENGTH);
  for (const pattern of SECRET_VALUE_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

/**
 * Produces JSON-safe logging data while removing common credential fields and
 * credential-shaped strings. The study intentionally stores submitted tutor
 * questions, but it must never persist application credentials.
 */
export function sanitizeForStudyLog(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return redactSecrets(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return String(value);
  if (typeof value !== "object") return String(value).slice(0, MAX_STRING_LENGTH);
  if (depth >= MAX_DEPTH) return "[MAX_DEPTH]";
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);

  if (Array.isArray(value)) {
    const sanitized = value
      .slice(0, MAX_ARRAY_LENGTH)
      .map((item) => sanitizeForStudyLog(item, depth + 1, seen));
    seen.delete(value);
    return sanitized;
  }

  const result = {};
  for (const [key, entry] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
    const safeKey = String(key).slice(0, 120);
    result[safeKey] = SECRET_KEY_PATTERN.test(safeKey)
      ? "[REDACTED]"
      : sanitizeForStudyLog(entry, depth + 1, seen);
  }
  seen.delete(value);
  return result;
}

export function sanitizeSessionMetadata(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new StudyError("INVALID_METADATA", "Session metadata must be an object.");
  }

  const metadata = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!ALLOWED_METADATA_KEYS.has(key)) continue;
    if (typeof entry !== "string" && typeof entry !== "number" && typeof entry !== "boolean") continue;
    metadata[key] = sanitizeForStudyLog(entry);
  }
  return metadata;
}
