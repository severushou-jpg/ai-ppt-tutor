import assert from "node:assert/strict";
import test from "node:test";
import { createClientStudyEventQueue } from "../lib/client-study-event-queue.js";

test("event enqueued during an in-flight POST is retained and sent", async () => {
  let queue = [];
  let releaseFirst;
  let firstStarted;
  const firstStartedPromise = new Promise((resolve) => {
    firstStarted = resolve;
  });
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const sent = [];
  const controller = createClientStudyEventQueue({
    read: () => structuredClone(queue),
    write: (next) => {
      queue = structuredClone(next);
    },
    send: async (entry) => {
      sent.push(entry.queueId);
      if (entry.queueId === "first") {
        firstStarted();
        await firstGate;
      }
      return { ok: true };
    },
  });

  const firstFlush = controller.enqueue({ queueId: "first", event: { type: "source_view_opened" } });
  await firstStartedPromise;
  const secondFlush = controller.enqueue({ queueId: "second", event: { type: "citation_clicked" } });
  releaseFirst();
  await Promise.all([firstFlush, secondFlush]);

  assert.deepEqual(sent, ["first", "second"]);
  assert.deepEqual(queue, []);
});

test("terminal response preserves unsent events for authoritative finalization recovery", async () => {
  let queue = [];
  const controller = createClientStudyEventQueue({
    read: () => structuredClone(queue),
    write: (next) => {
      queue = structuredClone(next);
    },
    send: async () => ({ ok: false, terminal: true }),
  });

  const accepted = await controller.enqueue({ queueId: "expired", event: { type: "ui_click" } });
  assert.equal(accepted, false);
  assert.deepEqual(queue, [{ queueId: "expired", event: { type: "ui_click" } }]);
});
