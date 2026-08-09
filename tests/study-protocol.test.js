import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  advanceStudyProcedure,
  createStudySession,
  finalizeStudySession,
  recoverStudySession,
  startStudySession,
} from "../lib/study/recorder.js";
import {
  PARTICIPANT_STAGES,
  STUDY_FORMS,
  STUDY_INFORMATION_SHEET,
  STUDY_PROTOCOL_ASSETS,
  STUDY_PROTOCOL_MANIFEST_PUBLIC_PATH,
  validateStudyProtocolConfiguration,
} from "../lib/study/protocol.js";
import { runStudyPreflight, studyPreflightInternals } from "../lib/study/preflight.js";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function temporaryRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-ppt-protocol-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function copyProtocolFixture(publicRoot) {
  const paths = [
    STUDY_PROTOCOL_MANIFEST_PUBLIC_PATH,
    ...STUDY_PROTOCOL_ASSETS.map((asset) => asset.publicPath),
  ];
  for (const publicPath of paths) {
    const relativePath = publicPath.replace(/^\/+/, "");
    const source = path.join(PROJECT_ROOT, "public", relativePath);
    const destination = path.join(publicRoot, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
}

async function createSession(t, studyId = "APTT-101", now = 1_000) {
  const root = await temporaryRoot(t);
  const created = await createStudySession({
    studyId,
    condition: "C",
    stratum: "experienced",
  }, { root, now });
  return { root, created, now };
}

async function act(created, root, action, now) {
  return advanceStudyProcedure({
    studyId: created.session.studyId,
    sessionToken: created.sessionToken,
    action,
  }, { root, now });
}

async function makeReady(created, root, now) {
  await act(created, root, "acknowledge_information_sheet", now + 10);
  await act(created, root, "confirm_written_consent", now + 20);
  return act(created, root, "confirm_form1", now + 30);
}

test("Protocol configuration freezes approved Microsoft Forms destinations", () => {
  assert.deepEqual(validateStudyProtocolConfiguration(), { valid: true, errors: [] });
  assert.equal(new URL(STUDY_FORMS.form1.url).hostname, "forms.cloud.microsoft");
  assert.equal(new URL(STUDY_FORMS.form2.url).hostname, "forms.cloud.microsoft");
  assert.equal(new URL(STUDY_FORMS.form3.url).hostname, "forms.cloud.microsoft");
  assert.equal(STUDY_FORMS.form3.publicPath, "/study/forms/form3-quiz.png");
});

test("Information Sheet preview pages are present, correctly sized, and frozen by hash", async () => {
  assert.deepEqual(STUDY_INFORMATION_SHEET.previewPages.map((preview) => preview.page), [1, 2]);
  for (const preview of STUDY_INFORMATION_SHEET.previewPages) {
    const file = path.join(PROJECT_ROOT, "public", preview.publicPath.replace(/^\/+/, ""));
    const data = await readFile(file);
    assert.equal(data.subarray(1, 4).toString("ascii"), "PNG");
    assert.equal(data.readUInt32BE(16), preview.width);
    assert.equal(data.readUInt32BE(20), preview.height);
    assert.equal(createHash("sha256").update(data).digest("hex"), preview.expectedSha256);
  }
});

test("Preflight verifies the checked-in Information Sheet and QR assets against the frozen manifest", async (t) => {
  const root = await temporaryRoot(t);
  const preflight = await runStudyPreflight({ root });
  assert.equal(preflight.checks.protocolConfiguration.ok, true);
  assert.equal(preflight.checks.protocolAssets.ok, true);
  assert.deepEqual(preflight.protocolAssets.map((asset) => asset.id), [
    "informationSheet",
    "informationSheetPreview1",
    "informationSheetPreview2",
    "form1",
    "form2",
    "form3",
  ]);
  for (const asset of preflight.protocolAssets) {
    assert.equal(asset.ok, true);
    assert.match(asset.hash, /^[a-f0-9]{64}$/);
    assert.equal(asset.hash, asset.expectedHash);
  }
});

test("Preflight blocks readiness when an Information Sheet preview is missing or changed", async (t) => {
  const root = await temporaryRoot(t);
  const publicRoot = path.join(root, "public");
  await copyProtocolFixture(publicRoot);

  const firstPreview = STUDY_INFORMATION_SHEET.previewPages[0];
  const secondPreview = STUDY_INFORMATION_SHEET.previewPages[1];
  const firstPreviewFile = path.join(publicRoot, firstPreview.publicPath.replace(/^\/+/, ""));
  const secondPreviewFile = path.join(publicRoot, secondPreview.publicPath.replace(/^\/+/, ""));

  await writeFile(firstPreviewFile, "changed preview");
  const changed = await studyPreflightInternals.protocolAssetsCheck({ publicRoot });
  assert.equal(changed.ok, false);
  assert.equal(changed.assets.find((asset) => asset.id === "informationSheetPreview1")?.ok, false);

  await copyFile(
    path.join(PROJECT_ROOT, "public", firstPreview.publicPath.replace(/^\/+/, "")),
    firstPreviewFile,
  );
  await rm(secondPreviewFile);
  const missing = await studyPreflightInternals.protocolAssetsCheck({ publicRoot });
  assert.equal(missing.ok, false);
  assert.equal(missing.assets.find((asset) => asset.id === "informationSheetPreview2")?.ok, false);
});

test("Start is server-gated and pre-learning procedure transitions are ordered, durable, and idempotent", async (t) => {
  const { root, created, now } = await createSession(t);
  assert.equal(created.session.participantStage, PARTICIPANT_STAGES.INFORMATION_SHEET);
  assert.equal(created.session.condition, undefined);
  assert.equal(created.session.stratum, undefined);

  await assert.rejects(startStudySession({
    studyId: created.session.studyId,
    sessionToken: created.sessionToken,
  }, { root, now: now + 1 }), (error) => {
    assert.equal(error.code, "STUDY_PREREQUISITES_INCOMPLETE");
    assert.deepEqual(error.details.missing, ["information_sheet", "written_consent", "form1"]);
    return true;
  });

  await assert.rejects(act(created, root, "confirm_form1", now + 2), (error) => {
    assert.equal(error.code, "PROCEDURE_OUT_OF_ORDER");
    assert.equal(error.details.participantStage, "information_sheet");
    return true;
  });

  const acknowledged = await act(created, root, "acknowledge_information_sheet", now + 10);
  assert.equal(acknowledged.session.participantStage, "written_consent");
  assert.equal(acknowledged.idempotent, false);
  const acknowledgedAt = acknowledged.session.procedure.informationSheetAcknowledgedAt;

  const retry = await act(created, root, "acknowledge_information_sheet", now + 11);
  assert.equal(retry.idempotent, true);
  assert.equal(retry.session.participantStage, "written_consent");
  assert.equal(retry.session.procedure.informationSheetAcknowledgedAt, acknowledgedAt);

  const consent = await act(created, root, "confirm_written_consent", now + 20);
  assert.equal(consent.session.participantStage, "form1");
  const ready = await act(created, root, "confirm_form1", now + 30);
  assert.equal(ready.session.participantStage, "ready");

  // Refresh/recovery returns the exact durable participant stage and safe
  // timestamps without exposing allocation factors.
  const recovered = await recoverStudySession({
    studyId: created.session.studyId,
    sessionToken: created.sessionToken,
  }, { root, now: now + 40 });
  assert.equal(recovered.session.participantStage, "ready");
  assert.equal(recovered.session.procedure.form1ConfirmedAt, ready.session.procedure.form1ConfirmedAt);
  assert.equal(recovered.session.condition, undefined);
  assert.equal(recovered.session.stratum, undefined);

  // Procedure audit metadata does not enter the 25-minute event stream.
  assert.equal(await readFile(path.join(root, created.session.studyId, "events.jsonl"), "utf8"), "");

  const started = await startStudySession({
    studyId: created.session.studyId,
    sessionToken: created.sessionToken,
  }, { root, now: now + 50 });
  assert.equal(started.session.status, "active");
  assert.equal(started.session.participantStage, "learning");
  assert.equal(started.session.procedure.learningStartedAt, new Date(now + 50).toISOString());
});

test("Normal completion enables Form 3 then Form 2 and procedure actions do not pollute learning records", async (t) => {
  const { root, created, now } = await createSession(t, "APTT-102", 10_000);
  await makeReady(created, root, now);
  const startedAt = now + 100;
  await startStudySession({
    studyId: created.session.studyId,
    sessionToken: created.sessionToken,
  }, { root, now: startedAt });

  const finalized = await finalizeStudySession({
    studyId: created.session.studyId,
    sessionToken: created.sessionToken,
    reason: "early_completion",
  }, { root, now: startedAt + 60_000 });
  assert.equal(finalized.session.status, "completed");
  assert.equal(finalized.session.participantStage, "form3");
  assert.equal(finalized.session.procedure.learningEndedAt, new Date(startedAt + 60_000).toISOString());

  await assert.rejects(act(created, root, "confirm_form2", startedAt + 60_010), (error) => {
    assert.equal(error.code, "PROCEDURE_OUT_OF_ORDER");
    return true;
  });
  const form3 = await act(created, root, "confirm_form3", startedAt + 60_020);
  assert.equal(form3.session.participantStage, "form2");
  const done = await act(created, root, "confirm_form2", startedAt + 60_030);
  assert.equal(done.session.participantStage, "done");
  assert.equal(done.session.procedure.procedureCompletedAt, done.session.procedure.form2ConfirmedAt);

  const lostResponseRetry = await act(created, root, "confirm_form3", startedAt + 60_040);
  assert.equal(lostResponseRetry.idempotent, true);
  assert.equal(lostResponseRetry.session.participantStage, "done");

  const events = (await readFile(path.join(root, created.session.studyId, "events.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.deepEqual(events.map((event) => event.type), ["study_started", "study_ended"]);
  const summary = await readFile(path.join(root, created.session.studyId, "summary.csv"), "utf8");
  assert.equal(summary.includes("form3"), false);
  assert.equal(summary.includes("informationSheet"), false);
});

test("A failed summary write leaves a durable incomplete terminal record that recovery must repair", async (t) => {
  const { root, created, now } = await createSession(t, "APTT-103", 20_000);
  await makeReady(created, root, now);
  const startedAt = now + 100;
  await startStudySession({
    studyId: created.session.studyId,
    sessionToken: created.sessionToken,
  }, { root, now: startedAt });

  const sessionDirectory = path.join(root, created.session.studyId);
  const blockedSummary = path.join(sessionDirectory, "summary.csv");
  await mkdir(blockedSummary);
  await assert.rejects(finalizeStudySession({
    studyId: created.session.studyId,
    sessionToken: created.sessionToken,
    reason: "early_completion",
  }, { root, now: startedAt + 5_000 }), (error) => {
    assert.equal(error.code, "EISDIR");
    return true;
  });

  const incomplete = JSON.parse(await readFile(path.join(sessionDirectory, "session.json"), "utf8"));
  assert.equal(incomplete.status, "completed");
  assert.equal(incomplete.completionReason, "early_completion");
  assert.equal(incomplete.finalizationCompleteAt, null);

  await assert.rejects(recoverStudySession({
    studyId: created.session.studyId,
    sessionToken: created.sessionToken,
  }, { root, now: startedAt + 5_100 }), (error) => {
    assert.equal(error.code, "EISDIR");
    return true;
  });
  await assert.rejects(act(created, root, "confirm_form3", startedAt + 5_200), (error) => {
    assert.equal(error.code, "EISDIR");
    return true;
  });

  await rm(blockedSummary, { recursive: true, force: true });
  const recovered = await recoverStudySession({
    studyId: created.session.studyId,
    sessionToken: created.sessionToken,
  }, { root, now: startedAt + 5_300 });
  assert.equal(recovered.session.participantStage, "form3");
  assert.match(recovered.session.finalizationCompleteAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(await readFile(blockedSummary, "utf8"), /completion_reason/);
});

test("A terminal retry accepts up to 500 pending events, repairs the summary, and remains idempotent", async (t) => {
  const { root, created, now } = await createSession(t, "APTT-104", 30_000);
  await makeReady(created, root, now);
  const startedAt = now + 100;
  await startStudySession({
    studyId: created.session.studyId,
    sessionToken: created.sessionToken,
  }, { root, now: startedAt });

  // Recovery is the authoritative automatic time-limit finalizer.
  const automaticallyFinalized = await recoverStudySession({
    studyId: created.session.studyId,
    sessionToken: created.sessionToken,
  }, { root, now: startedAt + 1_500_100 });
  assert.equal(automaticallyFinalized.session.completionReason, "time_limit");
  assert.match(automaticallyFinalized.session.finalizationCompleteAt, /^\d{4}-\d{2}-\d{2}T/);
  await rm(path.join(root, created.session.studyId, "summary.csv"), { force: true });

  const pendingEvents = Array.from({ length: 500 }, (_, index) => ({
    type: "question_submitted",
    clientTimestamp: new Date(startedAt + 1_000 + index).toISOString(),
    elapsedMs: 1_000 + index,
    data: {
      clientEventId: `terminal-pending-${index}`,
      question: `Pending question ${index}`,
    },
  }));
  const repaired = await finalizeStudySession({
    studyId: created.session.studyId,
    sessionToken: created.sessionToken,
    reason: "time_limit",
    pendingEvents,
  }, { root, now: startedAt + 1_501_000 });
  assert.equal(repaired.acceptedClientEventIds.length, 500);
  assert.deepEqual(repaired.acceptedClientEventIds, pendingEvents.map((event) => event.data.clientEventId));
  assert.equal(repaired.summary.total_questions, 500);
  assert.match(await readFile(path.join(root, created.session.studyId, "summary.csv"), "utf8"), /,500,/);
  assert.equal("summaryPath" in repaired, false);

  const eventFile = path.join(root, created.session.studyId, "events.jsonl");
  const eventCount = (await readFile(eventFile, "utf8")).trim().split("\n").length;
  assert.equal(eventCount, 502);

  const retry = await finalizeStudySession({
    studyId: created.session.studyId,
    sessionToken: created.sessionToken,
    reason: "time_limit",
    pendingEvents,
  }, { root, now: startedAt + 1_502_000 });
  assert.deepEqual(retry.acceptedClientEventIds, repaired.acceptedClientEventIds);
  assert.equal(retry.summary.total_questions, 500);
  assert.equal((await readFile(eventFile, "utf8")).trim().split("\n").length, eventCount);
});

test("Early-completion terminal retries reject events generated after the persisted end time", async (t) => {
  const { root, created, now } = await createSession(t, "APTT-105", 40_000);
  await makeReady(created, root, now);
  const startedAt = now + 100;
  await startStudySession({
    studyId: created.session.studyId,
    sessionToken: created.sessionToken,
  }, { root, now: startedAt });
  const endedAt = startedAt + 10_000;
  await finalizeStudySession({
    studyId: created.session.studyId,
    sessionToken: created.sessionToken,
    reason: "early_completion",
    clientEndedAt: new Date(endedAt).toISOString(),
  }, { root, now: endedAt + 100 });

  const pendingEvents = [
    {
      type: "question_submitted",
      clientTimestamp: new Date(endedAt - 1).toISOString(),
      elapsedMs: 9_999,
      data: { clientEventId: "before-early-end", question: "Before" },
    },
    {
      type: "question_submitted",
      clientTimestamp: new Date(endedAt + 1).toISOString(),
      elapsedMs: 10_001,
      data: { clientEventId: "after-early-end", question: "After" },
    },
  ];
  const retried = await finalizeStudySession({
    studyId: created.session.studyId,
    sessionToken: created.sessionToken,
    reason: "early_completion",
    pendingEvents,
  }, { root, now: endedAt + 500 });
  assert.deepEqual(retried.acceptedClientEventIds, ["before-early-end"]);
  assert.equal(retried.summary.total_questions, 1);
});

test("Only time-limit and early completion sessions can enter post-study forms", async (t) => {
  for (const [index, reason] of [
    "technical_failure",
    "researcher_stop",
    "participant_withdrawal",
  ].entries()) {
    const root = await temporaryRoot(t);
    const studyId = `APTT-${110 + index}`;
    const now = 100_000 + index * 10_000;
    const created = await createStudySession({
      studyId,
      condition: "A",
      stratum: "novice",
    }, { root, now });
    await makeReady(created, root, now);
    await startStudySession({ studyId, sessionToken: created.sessionToken }, { root, now: now + 100 });
    const finalized = await finalizeStudySession({
      studyId,
      sessionToken: created.sessionToken,
      reason,
    }, { root, now: now + 1_000 });

    assert.equal(finalized.session.participantStage, "halted");
    assert.equal(finalized.session.procedure.haltedAt, new Date(now + 1_000).toISOString());
    await assert.rejects(act(created, root, "confirm_form3", now + 1_100), (error) => {
      assert.equal(error.code, "POST_STUDY_NOT_ELIGIBLE");
      return true;
    });
  }
});

test("Procedure endpoint model rejects invalid actions and invalid tokens", async (t) => {
  const { root, created, now } = await createSession(t, "APTT-120");
  await assert.rejects(act(created, root, "skip_everything", now + 1), (error) => {
    assert.equal(error.code, "INVALID_PROCEDURE_ACTION");
    return true;
  });
  await assert.rejects(advanceStudyProcedure({
    studyId: created.session.studyId,
    sessionToken: "0".repeat(64),
    action: "acknowledge_information_sheet",
  }, { root, now: now + 2 }), (error) => {
    assert.equal(error.code, "SESSION_UNAUTHORIZED");
    return true;
  });
});
