import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function source(relativePath) {
  return readFile(path.join(ROOT, relativePath), "utf8");
}

test("Safari finalization uses a normal fetch and waits for two paints before mounting Form 3", async () => {
  const client = await source("components/experiment/StudySessionClient.tsx");
  const fetchStart = client.indexOf('fetch("/api/study/finalize"');
  const fetchEnd = client.indexOf("if (!response.ok)", fetchStart);
  assert.ok(fetchStart >= 0 && fetchEnd > fetchStart);
  assert.equal(client.slice(fetchStart, fetchEnd).includes("keepalive"), false);

  const emptyQueueCheck = client.indexOf("if (unresolvedEvents.length > 0)", fetchEnd);
  const paintWait = client.indexOf("await waitForAnimationFrames(2)", emptyQueueCheck);
  const mountedGuard = client.indexOf("if (mountedRef.current)", paintWait);
  const savedTransition = client.indexOf('setFinalizationStatus("saved")', mountedGuard);
  assert.ok(emptyQueueCheck < paintWait && paintWait < mountedGuard && mountedGuard < savedTransition);
});

test("navigation lock reads refs and is not coupled to session or ended renders", async () => {
  const client = await source("components/experiment/StudySessionClient.tsx");
  const handlerStart = client.indexOf("const preventBackNavigation = () =>");
  const effectEnd = client.indexOf("}, [loading, sessionToken, studyId]);", handlerStart);
  assert.ok(handlerStart >= 0 && effectEnd > handlerStart);
  const lockEffect = client.slice(handlerStart, effectEnd);
  assert.match(lockEffect, /sessionRef\.current/);
  assert.match(lockEffect, /finishingRef\.current/);
  assert.match(lockEffect, /if \(!latestSession \|\| terminating\) return;/);
  assert.equal(lockEffect.includes("if (session.status"), false);
  assert.equal(lockEffect.includes("!ended"), false);
});

test("PDF teardown order and original PNG rendering remain frozen for Safari", async () => {
  const [viewer, qrStep, informationGate] = await Promise.all([
    source("components/experiment/LectureViewer.tsx"),
    source("components/experiment/StudyFormQrStep.tsx"),
    source("components/experiment/ParticipantInformationGate.tsx"),
  ]);
  const cancel = viewer.indexOf("state.renderTask.cancel()");
  const pageCleanup = viewer.indexOf("state.page.cleanup()", cancel);
  const canvasReset = viewer.indexOf("canvas.width = 1", pageCleanup);
  const documentDestroy = viewer.indexOf("document.destroy()", canvasReset);
  assert.ok(cancel >= 0 && cancel < pageCleanup && pageCleanup < canvasReset && canvasReset < documentDestroy);
  assert.match(qrStep, /priority\s+unoptimized/);
  assert.match(informationGate, /priority=\{index === 0\}\s+unoptimized/);
});
