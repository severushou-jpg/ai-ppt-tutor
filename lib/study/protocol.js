import { STUDY_STATUSES } from "./constants.js";
import { StudyError } from "./validation.js";
import { STUDY_FORMS, STUDY_INFORMATION_SHEET } from "./protocol-config.js";

export { STUDY_FORMS, STUDY_INFORMATION_SHEET } from "./protocol-config.js";

export const STUDY_PROTOCOL_VERSION = "AI-PPT-TUTOR-STUDY-PROTOCOL-2026-08-09-v1";
export const STUDY_PROTOCOL_MANIFEST_PUBLIC_PATH = "/study/protocol/manifest.json";

export const PARTICIPANT_STAGES = Object.freeze({
  INFORMATION_SHEET: "information_sheet",
  WRITTEN_CONSENT: "written_consent",
  FORM1: "form1",
  READY: "ready",
  LEARNING: "learning",
  QUIZ: "form3",
  FORM2: "form2",
  DONE: "done",
  HALTED: "halted",
});

export const PROCEDURE_ACTIONS = Object.freeze({
  ACKNOWLEDGE_INFORMATION_SHEET: "acknowledge_information_sheet",
  CONFIRM_WRITTEN_CONSENT: "confirm_written_consent",
  CONFIRM_FORM1: "confirm_form1",
  CONFIRM_FORM3: "confirm_form3",
  CONFIRM_FORM2: "confirm_form2",
});

export const STUDY_PROTOCOL_ASSETS = Object.freeze([
  Object.freeze({
    id: "informationSheet",
    kind: "informationSheet",
    publicPath: STUDY_INFORMATION_SHEET.publicPath,
    expectedSha256: STUDY_INFORMATION_SHEET.expectedSha256,
    version: STUDY_INFORMATION_SHEET.version,
  }),
  ...STUDY_INFORMATION_SHEET.previewPages.map((preview) => Object.freeze({
    id: `informationSheetPreview${preview.page}`,
    kind: "informationSheetPreview",
    page: preview.page,
    publicPath: preview.publicPath,
    expectedSha256: preview.expectedSha256,
    width: preview.width,
    height: preview.height,
  })),
  ...Object.entries(STUDY_FORMS).map(([id, form]) => Object.freeze({
    id,
    kind: "form",
    publicPath: form.publicPath,
    expectedSha256: form.expectedSha256,
    url: form.url,
  })),
]);

const PROCEDURE_TIMESTAMP_KEYS = Object.freeze([
  "informationSheetAcknowledgedAt",
  "writtenConsentConfirmedAt",
  "form1ConfirmedAt",
  "learningStartedAt",
  "learningEndedAt",
  "form3ConfirmedAt",
  "form2ConfirmedAt",
  "procedureCompletedAt",
  "haltedAt",
]);

const NORMAL_COMPLETION_REASONS = new Set(["time_limit", "early_completion"]);

const ACTION_RULES = Object.freeze({
  [PROCEDURE_ACTIONS.ACKNOWLEDGE_INFORMATION_SHEET]: Object.freeze({
    from: PARTICIPANT_STAGES.INFORMATION_SHEET,
    to: PARTICIPANT_STAGES.WRITTEN_CONSENT,
    timestamp: "informationSheetAcknowledgedAt",
    status: STUDY_STATUSES.PREPARED,
  }),
  [PROCEDURE_ACTIONS.CONFIRM_WRITTEN_CONSENT]: Object.freeze({
    from: PARTICIPANT_STAGES.WRITTEN_CONSENT,
    to: PARTICIPANT_STAGES.FORM1,
    timestamp: "writtenConsentConfirmedAt",
    status: STUDY_STATUSES.PREPARED,
  }),
  [PROCEDURE_ACTIONS.CONFIRM_FORM1]: Object.freeze({
    from: PARTICIPANT_STAGES.FORM1,
    to: PARTICIPANT_STAGES.READY,
    timestamp: "form1ConfirmedAt",
    status: STUDY_STATUSES.PREPARED,
  }),
  [PROCEDURE_ACTIONS.CONFIRM_FORM3]: Object.freeze({
    from: PARTICIPANT_STAGES.QUIZ,
    to: PARTICIPANT_STAGES.FORM2,
    timestamp: "form3ConfirmedAt",
    status: STUDY_STATUSES.COMPLETED,
  }),
  [PROCEDURE_ACTIONS.CONFIRM_FORM2]: Object.freeze({
    from: PARTICIPANT_STAGES.FORM2,
    to: PARTICIPANT_STAGES.DONE,
    timestamp: "form2ConfirmedAt",
    status: STUDY_STATUSES.COMPLETED,
  }),
});

function iso(now) {
  const value = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(value)) throw new TypeError("Timestamp must be finite.");
  return new Date(value).toISOString();
}

export function initialStudyProcedure() {
  return {
    version: STUDY_PROTOCOL_VERSION,
    informationSheetVersion: STUDY_INFORMATION_SHEET.version,
    informationSheetAcknowledgedAt: null,
    writtenConsentConfirmedAt: null,
    form1ConfirmedAt: null,
    learningStartedAt: null,
    learningEndedAt: null,
    form3ConfirmedAt: null,
    form2ConfirmedAt: null,
    procedureCompletedAt: null,
    haltedAt: null,
  };
}

function inferredStage(session) {
  if (session.status === STUDY_STATUSES.ACTIVE) return PARTICIPANT_STAGES.LEARNING;
  if (session.status === STUDY_STATUSES.COMPLETED && NORMAL_COMPLETION_REASONS.has(session.completionReason)) {
    return PARTICIPANT_STAGES.QUIZ;
  }
  if ([STUDY_STATUSES.COMPLETED, STUDY_STATUSES.INTERRUPTED, STUDY_STATUSES.WITHDRAWN].includes(session.status)) {
    return PARTICIPANT_STAGES.HALTED;
  }
  return PARTICIPANT_STAGES.INFORMATION_SHEET;
}

/**
 * Adds protocol fields to legacy local sessions without weakening the start
 * gate for a prepared record. This function only mutates the in-memory object;
 * the recorder persists it during the next authenticated transition.
 */
export function normalizeStudyProtocol(session) {
  if (!session || typeof session !== "object") return session;
  const defaults = initialStudyProcedure();
  session.procedure = session.procedure && typeof session.procedure === "object"
    ? { ...defaults, ...session.procedure }
    : defaults;
  if (!Object.values(PARTICIPANT_STAGES).includes(session.participantStage)) {
    session.participantStage = inferredStage(session);
  }
  return session;
}

export function publicStudyProcedure(procedure) {
  const safe = {
    version: typeof procedure?.version === "string" ? procedure.version : STUDY_PROTOCOL_VERSION,
    informationSheetVersion: typeof procedure?.informationSheetVersion === "string"
      ? procedure.informationSheetVersion
      : STUDY_INFORMATION_SHEET.version,
  };
  for (const key of PROCEDURE_TIMESTAMP_KEYS) {
    safe[key] = typeof procedure?.[key] === "string" ? procedure[key] : null;
  }
  return safe;
}

export function validateProcedureAction(value) {
  if (typeof value !== "string") {
    throw new StudyError("INVALID_PROCEDURE_ACTION", "Procedure action must be a string.");
  }
  const action = value.trim().toLowerCase();
  if (!Object.values(PROCEDURE_ACTIONS).includes(action)) {
    throw new StudyError("INVALID_PROCEDURE_ACTION", "Procedure action is not supported.");
  }
  return action;
}

export function isPostStudyEligible(session) {
  return session?.status === STUDY_STATUSES.COMPLETED
    && NORMAL_COMPLETION_REASONS.has(session?.completionReason);
}

export function applyProcedureAction(session, actionValue, now = Date.now()) {
  normalizeStudyProtocol(session);
  const action = validateProcedureAction(actionValue);
  const rule = ACTION_RULES[action];

  // A lost HTTP response may cause a retry after a subsequent step has already
  // completed. The timestamp is the durable idempotency marker: never regress.
  if (session.procedure[rule.timestamp]) {
    return { action, changed: false, idempotent: true };
  }

  if (rule.status === STUDY_STATUSES.COMPLETED && !isPostStudyEligible(session)) {
    throw new StudyError(
      "POST_STUDY_NOT_ELIGIBLE",
      "Post-study forms are available only after a normal timed or early completion.",
      409,
    );
  }
  if (session.status !== rule.status || session.participantStage !== rule.from) {
    throw new StudyError(
      "PROCEDURE_OUT_OF_ORDER",
      `The ${action} step is not available at the current stage.`,
      409,
      { participantStage: session.participantStage },
    );
  }

  const occurredAt = iso(now);
  session.procedure[rule.timestamp] = occurredAt;
  session.participantStage = rule.to;
  if (action === PROCEDURE_ACTIONS.CONFIRM_FORM2) {
    session.procedure.procedureCompletedAt = occurredAt;
  }
  return { action, changed: true, idempotent: false };
}

export function assertStudyStartPrerequisites(session) {
  normalizeStudyProtocol(session);
  const missing = [];
  if (!session.procedure.informationSheetAcknowledgedAt) missing.push("information_sheet");
  if (!session.procedure.writtenConsentConfirmedAt) missing.push("written_consent");
  if (!session.procedure.form1ConfirmedAt) missing.push("form1");
  if (session.participantStage !== PARTICIPANT_STAGES.READY || missing.length > 0) {
    throw new StudyError(
      "STUDY_PREREQUISITES_INCOMPLETE",
      "The participant information, written-consent confirmation, and Form 1 steps must be completed before learning starts.",
      409,
      { participantStage: session.participantStage, missing },
    );
  }
}

export function markStudyStarted(session, now = Date.now()) {
  assertStudyStartPrerequisites(session);
  const occurredAt = iso(now);
  session.participantStage = PARTICIPANT_STAGES.LEARNING;
  session.procedure.learningStartedAt = occurredAt;
}

export function markStudyFinalized(session, reason, now = Date.now()) {
  normalizeStudyProtocol(session);
  const occurredAt = iso(now);
  session.procedure.learningEndedAt ||= occurredAt;
  if (NORMAL_COMPLETION_REASONS.has(reason) && session.status === STUDY_STATUSES.COMPLETED) {
    session.participantStage = PARTICIPANT_STAGES.QUIZ;
    return;
  }
  session.participantStage = PARTICIPANT_STAGES.HALTED;
  session.procedure.haltedAt ||= occurredAt;
}

export function validateStudyProtocolConfiguration() {
  const errors = [];
  for (const [id, form] of Object.entries(STUDY_FORMS)) {
    try {
      const url = new URL(form.url);
      if (url.protocol !== "https:" || url.hostname !== "forms.cloud.microsoft") {
        errors.push(`${id} must use the approved Microsoft Forms HTTPS host`);
      }
    } catch {
      errors.push(`${id} URL is invalid`);
    }
  }
  for (const asset of STUDY_PROTOCOL_ASSETS) {
    if (!asset.publicPath.startsWith("/study/") || asset.publicPath.includes("..")) {
      errors.push(`${asset.id} public path is invalid`);
    }
    if (asset.expectedSha256 !== null && !/^[a-f0-9]{64}$/i.test(asset.expectedSha256)) {
      errors.push(`${asset.id} expected SHA-256 is invalid`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export const studyProtocolInternals = Object.freeze({ ACTION_RULES, NORMAL_COMPLETION_REASONS });
