import test from "node:test";
import assert from "node:assert/strict";
import { estimateRemainingMs, pipelineProgress } from "../lib/processing-metrics.js";

test("pipeline progress stays monotonic across resumable stages", () => {
  const values = [
    pipelineProgress("hashing", 1, 1),
    pipelineProgress("rendering", 5, 10),
    pipelineProgress("ocr", 10, 10),
    pipelineProgress("uploading", 1, 2),
    pipelineProgress("parsing", 1, 2),
    pipelineProgress("vision", 1, 2),
    pipelineProgress("indexing", 1, 2),
    pipelineProgress("ready", 1, 1),
  ];
  assert.deepEqual(values, [...values].sort((left, right) => left - right));
  assert.equal(values.at(-1), 100);
});

test("remaining time estimate is stable for a known checkpoint", () => {
  assert.equal(estimateRemainingMs(0, 25, 10_000), 30_000);
  assert.equal(estimateRemainingMs(0, 100, 10_000), null);
  assert.equal(estimateRemainingMs(0, 2, 10_000), null);
});
