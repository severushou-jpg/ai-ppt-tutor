import {
  appendFile,
  mkdir,
  open,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  configuredStudyRecordRoot,
  STUDY_DURATION_MS,
  STUDY_DURATION_SECONDS,
  STUDY_STATUSES,
} from "./constants.js";
import {
  sanitizeForStudyLog,
  sanitizeSessionMetadata,
  StudyError,
  validateCondition,
  validateEventType,
  validateFinalizeReason,
  validateSessionToken,
  validateStratum,
  validateStudyId,
} from "./validation.js";
import {
  applyProcedureAction,
  assertStudyStartPrerequisites,
  initialStudyProcedure,
  markStudyFinalized,
  markStudyStarted,
  normalizeStudyProtocol,
  PARTICIPANT_STAGES,
  publicStudyProcedure,
} from "./protocol.js";

const SESSION_FILE = "session.json";
const EVENT_FILE = "events.jsonl";
const MESSAGE_FILE = "messages.jsonl";
const CITATION_FILE = "citations.jsonl";
const ERROR_FILE = "errors.jsonl";
const SUMMARY_FILE = "summary.csv";

const sessionLocks = new Map();

function iso(timestamp) {
  return new Date(timestamp).toISOString();
}

function timestamp(value = Date.now()) {
  const number = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(number)) throw new TypeError("Timestamp must be finite.");
  return number;
}

function rootPath(options = {}) {
  return path.resolve(options.root || configuredStudyRecordRoot());
}

function sessionDirectory(studyId, options = {}) {
  const validated = validateStudyId(studyId);
  const root = rootPath(options);
  const directory = path.resolve(root, validated);
  if (!directory.startsWith(`${root}${path.sep}`)) {
    throw new StudyError("INVALID_STUDY_PATH", "Study record path is invalid.");
  }
  return { root, directory };
}

function filePath(studyId, file, options = {}) {
  return path.join(sessionDirectory(studyId, options).directory, file);
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function verifyToken(session, tokenValue) {
  const token = validateSessionToken(tokenValue);
  const actual = Buffer.from(tokenHash(token));
  const expected = Buffer.from(String(session.sessionTokenHash || ""));
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new StudyError("SESSION_UNAUTHORIZED", "Session token does not match this study.", 401);
  }
}

function terminalStatus(status) {
  return [
    STUDY_STATUSES.COMPLETED,
    STUDY_STATUSES.INTERRUPTED,
    STUDY_STATUSES.WITHDRAWN,
  ].includes(status);
}

function defaultCounters() {
  return {
    questions: 0,
    aiResponses: 0,
    citationClicks: 0,
    pdfPageChanges: 0,
    sourceViewMilliseconds: 0,
    windowHiddenCount: 0,
    responseLatencyMilliseconds: 0,
    responseLatencySamples: 0,
    errors: 0,
  };
}

function publicSession(session, now = Date.now()) {
  const current = timestamp(now);
  const remainingSeconds = session.status === STUDY_STATUSES.ACTIVE && session.scheduledEndAt
    ? Math.max(0, Math.ceil((Date.parse(session.scheduledEndAt) - current) / 1_000))
    : 0;
  const safe = { ...session };
  delete safe.sessionTokenHash;
  delete safe.eventSequence;
  delete safe.counters;
  delete safe.recentClientEventIds;
  delete safe.condition;
  delete safe.stratum;
  safe.procedure = publicStudyProcedure(session.procedure);
  return { ...safe, remainingSeconds };
}

async function withSessionLock(studyId, operation) {
  const validated = validateStudyId(studyId);
  const previous = sessionLocks.get(validated) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  sessionLocks.set(validated, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (sessionLocks.get(validated) === tail) sessionLocks.delete(validated);
  }
}

async function atomicWriteJson(target, value) {
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  await rename(temporary, target);
}

async function ensureEmptyFile(target) {
  const handle = await open(target, "wx", 0o600);
  await handle.close();
}

async function readSession(studyId, options = {}) {
  try {
    const raw = await readFile(filePath(studyId, SESSION_FILE, options), "utf8");
    const session = JSON.parse(raw);
    if (!session || session.studyId !== studyId) throw new Error("Study ID mismatch");
    return normalizeStudyProtocol(session);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new StudyError("SESSION_NOT_FOUND", "Study session was not found.", 404);
    }
    if (error instanceof StudyError) throw error;
    throw new StudyError("SESSION_CORRUPTED", "Study session data could not be read.", 500);
  }
}

async function writeSession(session, options = {}) {
  await atomicWriteJson(filePath(session.studyId, SESSION_FILE, options), session);
}

function safeDuration(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
}

function updateCounters(session, event) {
  const counters = session.counters || defaultCounters();
  const data = event.data || {};
  if (event.type === "question_submitted") counters.questions += 1;
  if (event.type === "answer_shown") {
    counters.aiResponses += 1;
    const latency = safeDuration(data.latencyMs);
    if (latency > 0) {
      counters.responseLatencyMilliseconds += latency;
      counters.responseLatencySamples += 1;
    }
  }
  if (event.type === "citation_clicked") counters.citationClicks += 1;
  if (event.type === "manual_pdf_page_changed" || event.type === "pdf_page_changed") {
    counters.pdfPageChanges += 1;
  }
  if (event.type === "source_view_closed") {
    counters.sourceViewMilliseconds += safeDuration(data.durationMs);
  }
  if (event.type === "window_hidden") counters.windowHiddenCount += 1;
  if (event.type.includes("error") || event.type === "answer_failed") counters.errors += 1;
  session.counters = counters;
}

function categoryFiles(event) {
  const files = [];
  if (
    event.type.startsWith("question_") ||
    event.type.startsWith("answer_") ||
    event.type === "initial_explanation_shown"
  ) files.push(MESSAGE_FILE);
  if (event.type.startsWith("citation_") || event.type.startsWith("source_")) {
    files.push(CITATION_FILE);
  }
  if (event.type.includes("error") || event.type === "answer_failed") files.push(ERROR_FILE);
  return files;
}

async function appendEventLine(session, event, options = {}) {
  const line = `${JSON.stringify(event)}\n`;
  await appendFile(filePath(session.studyId, EVENT_FILE, options), line, { encoding: "utf8", mode: 0o600 });
  for (const file of categoryFiles(event)) {
    await appendFile(filePath(session.studyId, file, options), line, { encoding: "utf8", mode: 0o600 });
  }
  session.eventSequence = event.sequence;
  updateCounters(session, event);
}

function clientEventIdFromInput(input) {
  const value = input?.data?.clientEventId;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(trimmed)) return null;
  return trimmed;
}

async function findEventByClientEventId(studyId, clientEventId, options = {}) {
  if (!clientEventId) return null;
  try {
    const raw = await readFile(filePath(studyId, EVENT_FILE, options), "utf8");
    const lines = raw.trim().split("\n");
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (!lines[index]) continue;
      try {
        const event = JSON.parse(lines[index]);
        if (event?.clientEventId === clientEventId || event?.data?.clientEventId === clientEventId) {
          return event;
        }
      } catch {
        // Keep searching. Session recovery remains responsible for reporting
        // malformed persisted records.
      }
    }
    return null;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function readEventsByClientEventId(studyId, options = {}) {
  const events = new Map();
  try {
    const raw = await readFile(filePath(studyId, EVENT_FILE, options), "utf8");
    for (const line of raw.split("\n")) {
      if (!line) continue;
      try {
        const event = JSON.parse(line);
        const clientEventId = event?.clientEventId || event?.data?.clientEventId;
        if (typeof clientEventId === "string" && clientEventId) events.set(clientEventId, event);
      } catch {
        // Recovery of counters and the session marker remains independent of a
        // malformed historical line; only valid records participate here.
      }
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return events;
}

function makeEvent(session, input, now) {
  const started = session.startedAt ? Date.parse(session.startedAt) : now;
  const serverElapsed = Math.max(0, Math.min(STUDY_DURATION_MS, now - started));
  const suppliedElapsed = Number(input.elapsedMs);
  const elapsedMs = Number.isFinite(suppliedElapsed)
    ? Math.max(0, Math.min(STUDY_DURATION_MS, Math.round(suppliedElapsed)))
    : serverElapsed;
  const suppliedClientTime = typeof input.clientTimestamp === "string" && Number.isFinite(Date.parse(input.clientTimestamp))
    ? new Date(input.clientTimestamp).toISOString()
    : null;

  return {
    eventId: randomUUID(),
    clientEventId: clientEventIdFromInput(input),
    sequence: Number(session.eventSequence || 0) + 1,
    studyId: session.studyId,
    condition: session.condition,
    stratum: session.stratum,
    type: validateEventType(input.type),
    serverTimestamp: iso(now),
    clientTimestamp: suppliedClientTime,
    elapsedMs,
    data: sanitizeForStudyLog(input.data ?? {}),
  };
}

function eventFallsWithinStudyWindow(session, input, recordedEndOverride = null) {
  if (!session.startedAt || !session.scheduledEndAt) return false;
  const startedAt = Date.parse(session.startedAt);
  const deadline = Date.parse(session.scheduledEndAt);
  const recordedEnd = Number.isFinite(recordedEndOverride)
    ? Math.min(deadline, recordedEndOverride)
    : deadline;
  const maximumElapsed = Math.max(0, Math.min(STUDY_DURATION_MS, recordedEnd - startedAt));
  const elapsedMs = Number(input?.elapsedMs);
  const clientTimestamp = typeof input?.clientTimestamp === "string"
    ? Date.parse(input.clientTimestamp)
    : Number.NaN;
  return Number.isFinite(elapsedMs)
    && elapsedMs >= 0
    && elapsedMs <= maximumElapsed
    && Number.isFinite(clientTimestamp)
    && clientTimestamp >= startedAt - 2_000
    && clientTimestamp <= recordedEnd;
}

async function appendPendingFinalizeEvents(session, pendingEvents, recordedEnd, options = {}) {
  if (!Array.isArray(pendingEvents) || !session.startedAt || !Number.isFinite(recordedEnd)) return [];
  const acceptedClientEventIds = [];
  const existingEvents = await readEventsByClientEventId(session.studyId, options);
  for (const input of pendingEvents.slice(0, 500)) {
    if (!input || typeof input !== "object" || Array.isArray(input)) continue;
    const clientEventId = clientEventIdFromInput(input);
    if (!clientEventId || !eventFallsWithinStudyWindow(session, input, recordedEnd)) continue;
    const duplicate = existingEvents.get(clientEventId);
    if (duplicate) {
      acceptedClientEventIds.push(clientEventId);
      continue;
    }
    try {
      const event = makeEvent(session, input, recordedEnd);
      await appendEventLine(session, event, options);
      existingEvents.set(clientEventId, event);
      acceptedClientEventIds.push(clientEventId);
    } catch (error) {
      if (!(error instanceof StudyError)) throw error;
    }
  }
  return acceptedClientEventIds;
}

async function rebuildCountersFromEventLog(session, options = {}) {
  const counters = defaultCounters();
  let eventSequence = 0;
  try {
    const raw = await readFile(filePath(session.studyId, EVENT_FILE, options), "utf8");
    session.counters = counters;
    for (const line of raw.split("\n")) {
      if (!line) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      updateCounters(session, event);
      const sequence = Number(event?.sequence);
      if (Number.isFinite(sequence)) eventSequence = Math.max(eventSequence, sequence);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    session.counters = counters;
  }
  session.eventSequence = eventSequence;
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function buildSummary(session) {
  const counters = session.counters || defaultCounters();
  const started = session.startedAt ? Date.parse(session.startedAt) : null;
  const ended = session.endedAt ? Date.parse(session.endedAt) : null;
  const actualLearningSeconds = started !== null && ended !== null
    ? Math.max(0, Math.round((ended - started) / 1_000))
    : 0;
  const meanLatency = counters.responseLatencySamples > 0
    ? Math.round(counters.responseLatencyMilliseconds / counters.responseLatencySamples)
    : 0;
  return {
    study_id: session.studyId,
    condition: session.condition,
    stratum: session.stratum,
    status: session.status,
    completion_reason: session.completionReason || "",
    started_at: session.startedAt || "",
    ended_at: session.endedAt || "",
    planned_learning_seconds: STUDY_DURATION_SECONDS,
    actual_learning_seconds: actualLearningSeconds,
    total_questions: counters.questions,
    total_ai_responses: counters.aiResponses,
    total_citation_clicks: counters.citationClicks,
    total_pdf_page_changes: counters.pdfPageChanges,
    total_source_view_seconds: Math.round(counters.sourceViewMilliseconds / 1_000),
    window_hidden_count: counters.windowHiddenCount,
    mean_response_latency_ms: meanLatency,
    error_count: counters.errors,
  };
}

async function writeSummary(session, options = {}) {
  const summary = buildSummary(session);
  const headers = Object.keys(summary);
  const csv = `${headers.map(csvCell).join(",")}\n${headers.map((key) => csvCell(summary[key])).join(",")}\n`;
  await writeFile(filePath(session.studyId, SUMMARY_FILE, options), csv, {
    encoding: "utf8",
    mode: 0o600,
  });
  return summary;
}

async function completeTerminalPersistence(session, now, options = {}) {
  if (!terminalStatus(session.status)) {
    throw new StudyError("SESSION_NOT_FINISHED", "The study session is not ready to be finalized.", 409);
  }

  // Persist an explicit incomplete marker before touching summary.csv. If the
  // summary write or the final atomic session write fails, recovery must repair
  // the record instead of exposing post-study forms.
  session.finalizationCompleteAt = null;
  session.updatedAt = iso(now);
  await rebuildCountersFromEventLog(session, options);
  await writeSession(session, options);

  const summary = await writeSummary(session, options);
  session.finalizationCompleteAt = iso(now);
  await writeSession(session, options);
  return summary;
}

function finalizeStatus(reason) {
  if (reason === "participant_withdrawal") return STUDY_STATUSES.WITHDRAWN;
  if (reason === "technical_failure" || reason === "researcher_stop") return STUDY_STATUSES.INTERRUPTED;
  return STUDY_STATUSES.COMPLETED;
}

async function findOpenSourceView(session, options = {}) {
  try {
    const raw = await readFile(filePath(session.studyId, EVENT_FILE, options), "utf8");
    let opened = null;
    for (const line of raw.split("\n")) {
      if (!line) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event.type === "source_view_opened") opened = event;
      if (event.type === "source_view_closed") opened = null;
    }
    return opened;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function closeOpenSourceAt(session, recordedEnd, reason, options = {}) {
  const opened = await findOpenSourceView(session, options);
  if (!opened || !session.startedAt) return;
  const endElapsed = Math.max(
    0,
    Math.min(STUDY_DURATION_MS, recordedEnd - Date.parse(session.startedAt)),
  );
  const durationMs = Math.max(0, endElapsed - safeDuration(opened.elapsedMs));
  const closeEvent = makeEvent(session, {
    type: "source_view_closed",
    elapsedMs: endElapsed,
    data: {
      anchorId: opened.data?.anchorId ?? null,
      durationMs,
      synthetic: true,
      closureReason: reason,
    },
  }, recordedEnd);
  await appendEventLine(session, closeEvent, options);
}

async function finalizeLocked(session, reason, now, options = {}, recordedEndOverride = null) {
  if (terminalStatus(session.status)) {
    return { session, summary: await completeTerminalPersistence(session, now, options) };
  }
  if (session.status !== STUDY_STATUSES.ACTIVE || !session.startedAt || !session.scheduledEndAt) {
    throw new StudyError("SESSION_NOT_STARTED", "The study session has not started.", 409);
  }

  const deadline = Date.parse(session.scheduledEndAt);
  if (reason === "time_limit" && now < deadline) {
    throw new StudyError(
      "STUDY_TIME_REMAINING",
      "The 25-minute learning period has not ended yet.",
      409,
      { remainingSeconds: Math.ceil((deadline - now) / 1_000) },
    );
  }
  const recordedEnd = reason === "time_limit"
    ? deadline
    : Number.isFinite(recordedEndOverride)
      ? recordedEndOverride
      : now;
  await closeOpenSourceAt(session, recordedEnd, reason, options);
  const endEvent = makeEvent(session, {
    type: "study_ended",
    elapsedMs: recordedEnd - Date.parse(session.startedAt),
    data: { reason },
  }, recordedEnd);
  await appendEventLine(session, endEvent, options);
  session.status = finalizeStatus(reason);
  session.completionReason = reason;
  session.endedAt = iso(recordedEnd);
  session.updatedAt = iso(now);
  session.finalizationCompleteAt = null;
  markStudyFinalized(session, reason, recordedEnd);
  await writeSession(session, options);
  const summary = await completeTerminalPersistence(session, now, options);
  return { session, summary };
}

async function expireIfNeeded(session, now, options = {}) {
  if (
    session.status === STUDY_STATUSES.ACTIVE &&
    session.scheduledEndAt &&
    now >= Date.parse(session.scheduledEndAt)
  ) {
    return (await finalizeLocked(session, "time_limit", now, options)).session;
  }
  return session;
}

export async function createStudySession(input, options = {}) {
  const studyId = validateStudyId(input?.studyId);
  const condition = validateCondition(input?.condition);
  const stratum = validateStratum(input?.stratum);
  const metadata = sanitizeSessionMetadata(input?.metadata);
  const now = timestamp(options.now);
  const { root, directory } = sessionDirectory(studyId, options);
  await mkdir(root, { recursive: true, mode: 0o700 });

  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new StudyError("DUPLICATE_STUDY_ID", "A record already exists for this Study ID.", 409);
    }
    throw error;
  }

  const sessionToken = randomBytes(32).toString("hex");
  const session = {
    schemaVersion: 2,
    studyId,
    condition,
    stratum,
    status: STUDY_STATUSES.PREPARED,
    createdAt: iso(now),
    updatedAt: iso(now),
    startedAt: null,
    scheduledEndAt: null,
    endedAt: null,
    durationSeconds: STUDY_DURATION_SECONDS,
    completionReason: null,
    finalizationCompleteAt: null,
    participantStage: PARTICIPANT_STAGES.INFORMATION_SHEET,
    procedure: initialStudyProcedure(),
    metadata,
    sessionTokenHash: tokenHash(sessionToken),
    eventSequence: 0,
    counters: defaultCounters(),
  };

  await atomicWriteJson(path.join(directory, SESSION_FILE), session);
  await Promise.all([
    ensureEmptyFile(path.join(directory, EVENT_FILE)),
    ensureEmptyFile(path.join(directory, MESSAGE_FILE)),
    ensureEmptyFile(path.join(directory, CITATION_FILE)),
    ensureEmptyFile(path.join(directory, ERROR_FILE)),
  ]);

  return { session: publicSession(session, now), sessionToken, directory };
}

export async function startStudySession(input, options = {}) {
  const studyId = validateStudyId(input?.studyId);
  const now = timestamp(options.now);
  return withSessionLock(studyId, async () => {
    const session = await readSession(studyId, options);
    verifyToken(session, input?.sessionToken);
    if (session.status === STUDY_STATUSES.ACTIVE) {
      const active = await expireIfNeeded(session, now, options);
      if (active.status !== STUDY_STATUSES.ACTIVE) {
        throw new StudyError("STUDY_TIME_ENDED", "The 25-minute learning period has ended.", 409);
      }
      return { session: publicSession(active, now), directory: sessionDirectory(studyId, options).directory };
    }
    if (session.status !== STUDY_STATUSES.PREPARED) {
      throw new StudyError("SESSION_ALREADY_FINISHED", "This study session can no longer be started.", 409);
    }

    assertStudyStartPrerequisites(session);
    markStudyStarted(session, now);
    session.status = STUDY_STATUSES.ACTIVE;
    session.startedAt = iso(now);
    session.scheduledEndAt = iso(now + STUDY_DURATION_MS);
    session.updatedAt = iso(now);
    const event = makeEvent(session, { type: "study_started", elapsedMs: 0, data: {} }, now);
    await appendEventLine(session, event, options);
    await writeSession(session, options);
    return { session: publicSession(session, now), directory: sessionDirectory(studyId, options).directory };
  });
}

/**
 * Advances the participant-facing study procedure without writing a learning
 * event. Procedure timestamps live only in session.json so the 25-minute
 * behavioural event stream and summary counters remain uncontaminated.
 */
export async function advanceStudyProcedure(input, options = {}) {
  const studyId = validateStudyId(input?.studyId);
  const now = timestamp(options.now);
  return withSessionLock(studyId, async () => {
    const session = await readSession(studyId, options);
    verifyToken(session, input?.sessionToken);
    if (terminalStatus(session.status) && !session.finalizationCompleteAt) {
      await completeTerminalPersistence(session, now, options);
    }
    const transition = applyProcedureAction(session, input?.action, now);
    if (transition.changed) {
      session.updatedAt = iso(now);
      await writeSession(session, options);
    }
    return {
      session: publicSession(session, now),
      action: transition.action,
      idempotent: transition.idempotent,
      directory: sessionDirectory(studyId, options).directory,
    };
  });
}

export async function appendStudyEvent(input, options = {}) {
  const studyId = validateStudyId(input?.studyId);
  const now = timestamp(options.now);
  return withSessionLock(studyId, async () => {
    let session = await readSession(studyId, options);
    verifyToken(session, input?.sessionToken);
    if (!input?.event || typeof input.event !== "object" || Array.isArray(input.event)) {
      throw new StudyError("INVALID_EVENT", "A study event is required.");
    }

    // The browser retries an event after a lost response using the same
    // clientEventId. Search the append-only record before checking the
    // deadline so an already-committed retry remains an acknowledged success.
    const clientEventId = clientEventIdFromInput(input.event);
    const duplicate = await findEventByClientEventId(studyId, clientEventId, options);
    if (duplicate) {
      return {
        accepted: true,
        duplicate: true,
        eventId: duplicate.eventId,
        sequence: duplicate.sequence,
        serverTimestamp: duplicate.serverTimestamp,
      };
    }

    const deadline = session.scheduledEndAt ? Date.parse(session.scheduledEndAt) : Number.NaN;
    if (
      session.status === STUDY_STATUSES.ACTIVE
      && Number.isFinite(deadline)
      && now >= deadline
      && eventFallsWithinStudyWindow(session, input.event)
    ) {
      const event = makeEvent(session, input.event, deadline);
      await appendEventLine(session, event, options);
      session.updatedAt = iso(now);
      const finalized = await finalizeLocked(session, "time_limit", now, options);
      return {
        accepted: true,
        eventId: event.eventId,
        sequence: event.sequence,
        serverTimestamp: event.serverTimestamp,
        finalized: true,
        summary: finalized.summary,
      };
    }

    session = await expireIfNeeded(session, now, options);
    if (session.status !== STUDY_STATUSES.ACTIVE) {
      const code = session.completionReason === "time_limit" ? "STUDY_TIME_ENDED" : "SESSION_NOT_ACTIVE";
      throw new StudyError(code, "The study session is not accepting new events.", 409);
    }
    const event = makeEvent(session, input.event, now);
    await appendEventLine(session, event, options);
    session.updatedAt = iso(now);
    await writeSession(session, options);
    return {
      accepted: true,
      eventId: event.eventId,
      sequence: event.sequence,
      serverTimestamp: event.serverTimestamp,
    };
  });
}

export async function finalizeStudySession(input, options = {}) {
  const studyId = validateStudyId(input?.studyId);
  const reason = validateFinalizeReason(input?.reason);
  const now = timestamp(options.now);
  return withSessionLock(studyId, async () => {
    const session = await readSession(studyId, options);
    verifyToken(session, input?.sessionToken);
    const wasTerminal = terminalStatus(session.status);
    const deadline = session.scheduledEndAt ? Date.parse(session.scheduledEndAt) : Number.NaN;
    if (reason === "time_limit" && session.status === STUDY_STATUSES.ACTIVE && now < deadline) {
      throw new StudyError(
        "STUDY_TIME_REMAINING",
        "The 25-minute learning period has not ended yet.",
        409,
        { remainingSeconds: Math.ceil((deadline - now) / 1_000) },
      );
    }
    let recordedEnd = wasTerminal && session.endedAt
      ? Date.parse(session.endedAt)
      : reason === "time_limit" && Number.isFinite(deadline)
        ? deadline
        : now;
    if (reason === "early_completion" && session.status === STUDY_STATUSES.ACTIVE && input?.clientEndedAt !== undefined) {
      const clientEndedAt = typeof input.clientEndedAt === "string"
        ? Date.parse(input.clientEndedAt)
        : Number.NaN;
      const startedAt = session.startedAt ? Date.parse(session.startedAt) : Number.NaN;
      if (
        !Number.isFinite(clientEndedAt)
        || !Number.isFinite(startedAt)
        || !Number.isFinite(deadline)
        || clientEndedAt < startedAt
        || clientEndedAt > deadline
        || clientEndedAt > now + 2_000
      ) {
        throw new StudyError(
          "INVALID_EARLY_COMPLETION_TIME",
          "The early-completion timestamp is outside the active learning period.",
        );
      }
      recordedEnd = Math.min(clientEndedAt, now);
    }
    if (wasTerminal) {
      // Make a terminal retry visibly incomplete before accepting any durable
      // late-arriving client events. Recovery can then reconstruct counters
      // from the append-only log if this request is interrupted mid-flight.
      session.finalizationCompleteAt = null;
      session.updatedAt = iso(now);
      await writeSession(session, options);
    }
    const acceptedClientEventIds = await appendPendingFinalizeEvents(
      session,
      input?.pendingEvents,
      recordedEnd,
      options,
    );
    const result = await finalizeLocked(session, reason, now, options, recordedEnd);
    return {
      session: publicSession(result.session, now),
      summary: result.summary,
      acceptedClientEventIds,
    };
  });
}

export async function recoverStudySession(input, options = {}) {
  const studyId = validateStudyId(input?.studyId);
  const now = timestamp(options.now);
  return withSessionLock(studyId, async () => {
    let session = await readSession(studyId, options);
    verifyToken(session, input?.sessionToken);
    session = await expireIfNeeded(session, now, options);
    if (terminalStatus(session.status) && !session.finalizationCompleteAt) {
      await completeTerminalPersistence(session, now, options);
    }
    return {
      session: publicSession(session, now),
      directory: sessionDirectory(studyId, options).directory,
    };
  });
}

/**
 * Authenticates a study request without exposing the persisted token hash. This
 * is the only reader the answer-generation route should use: it also enforces
 * the deadline before returning the immutable condition metadata.
 */
export async function authorizeStudySession(input, options = {}) {
  const studyId = validateStudyId(input?.studyId);
  const now = timestamp(options.now);
  return withSessionLock(studyId, async () => {
    let session = await readSession(studyId, options);
    verifyToken(session, input?.sessionToken);
    session = await expireIfNeeded(session, now, options);
    if (options.requireActive && session.status !== STUDY_STATUSES.ACTIVE) {
      const code = session.completionReason === "time_limit" ? "STUDY_TIME_ENDED" : "SESSION_NOT_ACTIVE";
      throw new StudyError(code, "The study session is not active.", 409);
    }
    return Object.freeze({
      ...publicSession(session, now),
      // Server-only factor metadata. Route handlers must never serialize this
      // object directly to the participant browser.
      condition: session.condition,
      stratum: session.stratum,
    });
  });
}

export const studyRecorderInternals = Object.freeze({
  buildSummary,
  publicSession,
  sanitizeForStudyLog,
});
