import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  appendStudyEvent,
  authorizeStudySession,
  createStudySession,
  finalizeStudySession,
  recoverStudySession,
  startStudySession,
} from "../lib/study/recorder.js";
import {
  sanitizeForStudyLog,
  StudyError,
  validateStratum,
  validateStudyId,
} from "../lib/study/validation.js";

async function temporaryRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-ppt-study-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function createStartedSession(t, overrides = {}) {
  const root = await temporaryRoot(t);
  const createdAt = overrides.createdAt ?? Date.UTC(2026, 7, 9, 8, 0, 0);
  const created = await createStudySession({
    studyId: overrides.studyId ?? "APTT-001",
    condition: overrides.condition ?? "D",
    stratum: overrides.stratum ?? "novice",
    metadata: overrides.metadata,
  }, { root, now: createdAt });
  const started = await startStudySession({
    studyId: created.session.studyId,
    sessionToken: created.sessionToken,
  }, { root, now: createdAt + 1_000 });
  return { root, created, started, startedAt: createdAt + 1_000 };
}

test("Study IDs are strict and cannot be used for path traversal", () => {
  assert.equal(validateStudyId("APTT-042"), "APTT-042");
  for (const value of ["APTT-42", "aptt-042", "../APTT-042", "APTT-042/..", "APTT-0000"]) {
    assert.throws(() => validateStudyId(value), (error) => {
      assert.equal(error instanceof StudyError, true);
      assert.equal(error.code, "INVALID_STUDY_ID");
      return true;
    });
  }
});

test("Prior database experience accepts only the two pre-registered strata", () => {
  assert.equal(validateStratum("Novice"), "novice");
  assert.equal(validateStratum(" experienced "), "experienced");
  for (const value of ["technical", "non-technical", "beginner", "expert", ""]) {
    assert.throws(() => validateStratum(value), (error) => {
      assert.equal(error instanceof StudyError, true);
      assert.equal(error.code, "INVALID_STRATUM");
      return true;
    });
  }
});

test("Create reserves an isolated record and prevents duplicate Study IDs", async (t) => {
  const root = await temporaryRoot(t);
  const input = { studyId: "APTT-007", condition: "b", stratum: "experienced" };
  const first = await createStudySession(input, { root, now: 1_000 });

  assert.equal(first.session.studyId, "APTT-007");
  assert.equal(first.session.condition, undefined);
  assert.equal(first.session.stratum, undefined);
  assert.equal(first.session.status, "prepared");
  assert.equal(first.session.durationSeconds, 1_500);
  assert.equal(first.session.sessionTokenHash, undefined);
  assert.match(first.sessionToken, /^[a-f0-9]{64}$/);

  const files = await readdir(path.join(root, "APTT-007"));
  assert.deepEqual(files.sort(), [
    "citations.jsonl",
    "errors.jsonl",
    "events.jsonl",
    "messages.jsonl",
    "session.json",
  ]);

  await assert.rejects(createStudySession(input, { root, now: 2_000 }), (error) => {
    assert.equal(error.code, "DUPLICATE_STUDY_ID");
    assert.equal(error.status, 409);
    return true;
  });
});

test("A session records only between Start Learning and the 25-minute deadline", async (t) => {
  const { root, created, started, startedAt } = await createStartedSession(t);
  assert.equal(started.session.status, "active");
  assert.equal(started.session.remainingSeconds, 1_500);
  assert.equal(Date.parse(started.session.scheduledEndAt) - Date.parse(started.session.startedAt), 1_500_000);

  const question = await appendStudyEvent({
    studyId: "APTT-001",
    sessionToken: created.sessionToken,
    event: {
      type: "question_submitted",
      clientTimestamp: new Date(startedAt + 2_000).toISOString(),
      elapsedMs: 2_000,
      data: { question: "What is a candidate key?", apiKey: "must-never-be-written" },
    },
  }, { root, now: startedAt + 2_100 });
  assert.equal(question.accepted, true);
  assert.equal(question.sequence, 2);

  await appendStudyEvent({
    studyId: "APTT-001",
    sessionToken: created.sessionToken,
    event: {
      type: "answer_shown",
      data: { answer: "A minimal unique attribute set.", latencyMs: 850, providerKey: "sk-sensitive123456" },
    },
  }, { root, now: startedAt + 3_000 });
  await appendStudyEvent({
    studyId: "APTT-001",
    sessionToken: created.sessionToken,
    event: { type: "citation_clicked", data: { anchorId: "rm-20-a" } },
  }, { root, now: startedAt + 4_000 });
  await appendStudyEvent({
    studyId: "APTT-001",
    sessionToken: created.sessionToken,
    event: { type: "source_view_closed", data: { durationMs: 2_450 } },
  }, { root, now: startedAt + 7_000 });
  await appendStudyEvent({
    studyId: "APTT-001",
    sessionToken: created.sessionToken,
    event: { type: "manual_pdf_page_changed", data: { pdfPage: 20 } },
  }, { root, now: startedAt + 8_000 });

  await assert.rejects(finalizeStudySession({
    studyId: "APTT-001",
    sessionToken: created.sessionToken,
    reason: "time_limit",
  }, { root, now: startedAt + 10_000 }), (error) => {
    assert.equal(error.code, "STUDY_TIME_REMAINING");
    return true;
  });

  const finalized = await finalizeStudySession({
    studyId: "APTT-001",
    sessionToken: created.sessionToken,
    reason: "time_limit",
  }, { root, now: startedAt + 1_500_000 });
  assert.equal(finalized.session.status, "completed");
  assert.equal(finalized.session.remainingSeconds, 0);
  assert.equal(finalized.summary.actual_learning_seconds, 1_500);
  assert.equal(finalized.summary.total_questions, 1);
  assert.equal(finalized.summary.total_ai_responses, 1);
  assert.equal(finalized.summary.total_citation_clicks, 1);
  assert.equal(finalized.summary.total_pdf_page_changes, 1);
  assert.equal(finalized.summary.total_source_view_seconds, 2);
  assert.equal(finalized.summary.mean_response_latency_ms, 850);

  const directory = path.join(root, "APTT-001");
  const allRecords = await Promise.all((await readdir(directory)).map((name) => readFile(path.join(directory, name), "utf8")));
  const persisted = allRecords.join("\n");
  assert.equal(persisted.includes(created.sessionToken), false);
  assert.equal(persisted.includes("must-never-be-written"), false);
  assert.equal(persisted.includes("sk-sensitive123456"), false);
  assert.match(persisted, /\[REDACTED\]/);

  await assert.rejects(appendStudyEvent({
    studyId: "APTT-001",
    sessionToken: created.sessionToken,
    event: { type: "question_submitted", data: { question: "Too late" } },
  }, { root, now: startedAt + 1_500_001 }), (error) => {
    assert.equal(error.code, "STUDY_TIME_ENDED");
    return true;
  });
});

test("Early completion immediately finalizes with actual duration and cannot be resumed", async (t) => {
  const { root, created, startedAt } = await createStartedSession(t, { studyId: "APTT-014" });
  const endedAt = startedAt + 312_400;

  const finalized = await finalizeStudySession({
    studyId: "APTT-014",
    sessionToken: created.sessionToken,
    reason: "early_completion",
    clientEndedAt: new Date(endedAt).toISOString(),
  }, { root, now: endedAt + 2_000 });

  assert.equal(finalized.session.status, "completed");
  assert.equal(finalized.session.completionReason, "early_completion");
  assert.equal(Date.parse(finalized.session.endedAt), endedAt);
  assert.equal(finalized.session.remainingSeconds, 0);
  assert.equal(finalized.summary.completion_reason, "early_completion");
  assert.equal(finalized.summary.planned_learning_seconds, 1_500);
  assert.equal(finalized.summary.actual_learning_seconds, 312);

  const events = (await readFile(path.join(root, "APTT-014", "events.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.equal(events.at(-1).type, "study_ended");
  assert.equal(events.at(-1).data.reason, "early_completion");
  assert.equal(events.at(-1).elapsedMs, 312_400);

  const recovered = await recoverStudySession({
    studyId: "APTT-014",
    sessionToken: created.sessionToken,
  }, { root, now: startedAt + 600_000 });
  assert.equal(recovered.session.status, "completed");
  assert.equal(recovered.session.completionReason, "early_completion");
  assert.equal(Date.parse(recovered.session.endedAt), endedAt);

  await assert.rejects(startStudySession({
    studyId: "APTT-014",
    sessionToken: created.sessionToken,
  }, { root, now: startedAt + 600_001 }), (error) => {
    assert.equal(error.code, "SESSION_ALREADY_FINISHED");
    return true;
  });
  await assert.rejects(appendStudyEvent({
    studyId: "APTT-014",
    sessionToken: created.sessionToken,
    event: { type: "question_submitted", data: { question: "Can I continue?" } },
  }, { root, now: startedAt + 600_002 }), (error) => {
    assert.equal(error.code, "SESSION_NOT_ACTIVE");
    return true;
  });
});

test("Recovery expires an overdue session and writes a complete summary", async (t) => {
  const { root, created, startedAt } = await createStartedSession(t, { studyId: "APTT-008" });
  const recovered = await recoverStudySession({
    studyId: "APTT-008",
    sessionToken: created.sessionToken,
  }, { root, now: startedAt + 1_520_000 });

  assert.equal(recovered.session.status, "completed");
  assert.equal(recovered.session.completionReason, "time_limit");
  assert.equal(Date.parse(recovered.session.endedAt), startedAt + 1_500_000);

  const summary = await readFile(path.join(root, "APTT-008", "summary.csv"), "utf8");
  assert.match(summary, /planned_learning_seconds,actual_learning_seconds/);
  assert.match(summary, /1500,1500/);
});

test("Session tokens isolate local participant records", async (t) => {
  const { root, created, startedAt } = await createStartedSession(t, { studyId: "APTT-009" });
  await assert.rejects(appendStudyEvent({
    studyId: "APTT-009",
    sessionToken: "0".repeat(64),
    event: { type: "question_submitted", data: {} },
  }, { root, now: startedAt + 1_000 }), (error) => {
    assert.equal(error.code, "SESSION_UNAUTHORIZED");
    assert.equal(error.status, 401);
    return true;
  });

  const recovered = await recoverStudySession({
    studyId: "APTT-009",
    sessionToken: created.sessionToken,
  }, { root, now: startedAt + 1_000 });
  assert.equal(recovered.session.status, "active");

  const authorized = await authorizeStudySession({
    studyId: "APTT-009",
    sessionToken: created.sessionToken,
  }, { root, now: startedAt + 2_000, requireActive: true });
  assert.equal(authorized.condition, "D");
  assert.equal(authorized.sessionTokenHash, undefined);
  assert.equal(Object.isFrozen(authorized), true);
});

test("Concurrent log writes retain unique monotonic event sequences", async (t) => {
  const { root, created, startedAt } = await createStartedSession(t, { studyId: "APTT-010" });
  const results = await Promise.all(Array.from({ length: 12 }, (_, index) => appendStudyEvent({
    studyId: "APTT-010",
    sessionToken: created.sessionToken,
    event: { type: "scroll_checkpoint", data: { checkpoint: index } },
  }, { root, now: startedAt + index + 1 })),);

  assert.deepEqual(results.map((result) => result.sequence), Array.from({ length: 12 }, (_, index) => index + 2));
  const lines = (await readFile(path.join(root, "APTT-010", "events.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.deepEqual(lines.map((event) => event.sequence), Array.from({ length: 13 }, (_, index) => index + 1));
});

test("Client event IDs make a lost-response retry idempotent", async (t) => {
  const { root, created, startedAt } = await createStartedSession(t, { studyId: "APTT-011" });
  const input = {
    studyId: "APTT-011",
    sessionToken: created.sessionToken,
    event: {
      type: "question_submitted",
      clientTimestamp: new Date(startedAt + 2_000).toISOString(),
      elapsedMs: 2_000,
      data: { clientEventId: "client-question-1", question: "What is a relation?" },
    },
  };
  const first = await appendStudyEvent(input, { root, now: startedAt + 2_100 });
  const retry = await appendStudyEvent(input, { root, now: startedAt + 3_100 });

  assert.equal(retry.duplicate, true);
  assert.equal(retry.eventId, first.eventId);
  assert.equal(retry.sequence, first.sequence);
  const lines = (await readFile(path.join(root, "APTT-011", "events.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.equal(lines.filter((event) => event.clientEventId === "client-question-1").length, 1);
});

test("A final source-close generated before the deadline is accepted after it and finalizes once", async (t) => {
  const { root, created, startedAt } = await createStartedSession(t, { studyId: "APTT-012" });
  await appendStudyEvent({
    studyId: "APTT-012",
    sessionToken: created.sessionToken,
    event: {
      type: "source_view_opened",
      clientTimestamp: new Date(startedAt + 1_000).toISOString(),
      elapsedMs: 1_000,
      data: { clientEventId: "source-open-1", anchorId: "rm-20-a" },
    },
  }, { root, now: startedAt + 1_100 });

  const closed = await appendStudyEvent({
    studyId: "APTT-012",
    sessionToken: created.sessionToken,
    event: {
      type: "source_view_closed",
      clientTimestamp: new Date(startedAt + 1_499_900).toISOString(),
      elapsedMs: 1_499_900,
      data: { clientEventId: "source-close-1", anchorId: "rm-20-a", durationMs: 1_498_900 },
    },
  }, { root, now: startedAt + 1_500_100 });

  assert.equal(closed.accepted, true);
  assert.equal(closed.finalized, true);
  assert.equal(closed.summary.total_source_view_seconds, 1_499);
  const events = (await readFile(path.join(root, "APTT-012", "events.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.equal(events.filter((event) => event.type === "source_view_closed").length, 1);
  assert.equal(events.at(-1).type, "study_ended");
});

test("Finalization closes an open source view at the authoritative deadline", async (t) => {
  const { root, created, startedAt } = await createStartedSession(t, { studyId: "APTT-013" });
  await appendStudyEvent({
    studyId: "APTT-013",
    sessionToken: created.sessionToken,
    event: {
      type: "source_view_opened",
      clientTimestamp: new Date(startedAt + 2_000).toISOString(),
      elapsedMs: 2_000,
      data: { clientEventId: "source-open-2", anchorId: "rm-20-a" },
    },
  }, { root, now: startedAt + 2_100 });

  const finalized = await finalizeStudySession({
    studyId: "APTT-013",
    sessionToken: created.sessionToken,
    reason: "time_limit",
  }, { root, now: startedAt + 1_500_000 });

  assert.equal(finalized.summary.total_source_view_seconds, 1_498);
  const citations = (await readFile(path.join(root, "APTT-013", "citations.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  const syntheticClose = citations.find((event) => event.type === "source_view_closed");
  assert.equal(syntheticClose.data.synthetic, true);
  assert.equal(syntheticClose.elapsedMs, 1_500_000);
});

test("Secret sanitizer handles credential fields, bearer tokens, and cycles", () => {
  const cyclic = { authorization: "Bearer should-not-survive", nested: { text: "sk-abcdefghijk" } };
  cyclic.self = cyclic;
  assert.deepEqual(sanitizeForStudyLog(cyclic), {
    authorization: "[REDACTED]",
    nested: { text: "[REDACTED]" },
    self: "[CIRCULAR]",
  });
});
