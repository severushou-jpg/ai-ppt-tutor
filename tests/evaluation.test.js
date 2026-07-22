import test from "node:test";
import assert from "node:assert/strict";
import {
  citationPrecision,
  ndcgAtK,
  ocrCharacterAccuracy,
  recallAtK,
  reciprocalRank,
  refusalAccuracy,
  weightedScenarioScore,
} from "../lib/evaluation.js";

test("retrieval metrics reward early relevant evidence", () => {
  const retrieved = ["noise", "p2", "p4"];
  assert.equal(recallAtK(retrieved, ["p2", "p4"], 3), 1);
  assert.equal(reciprocalRank(retrieved, ["p2"]), 0.5);
  assert.ok(ndcgAtK(retrieved, ["p2", "p4"], 3) > 0.6);
});

test("OCR accuracy ignores whitespace and punctuation", () => {
  assert.equal(ocrCharacterAccuracy("线程 控制块：TCB", "线程控制块 TCB"), 1);
  assert.ok(ocrCharacterAccuracy("thread contr0l", "thread control") > 0.9);
});

test("citation and refusal metrics expose grounding failures", () => {
  assert.equal(citationPrecision([{ citations: [1] }, { citations: [3] }], [{ id: 1 }]), 0.5);
  assert.equal(refusalAccuracy([{ refused: true, shouldRefuse: true }, { refused: false, shouldRefuse: false }]), 1);
});

test("scenario score follows product priority weights", () => {
  const score = weightedScenarioScore(
    { overview: 1, detail: 0.8, visual: 0.5 },
    { overview: 0.5, detail: 0.3, visual: 0.2 },
  );
  assert.equal(Number(score.toFixed(2)), 0.84);
});
