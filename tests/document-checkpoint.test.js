import test from "node:test";
import assert from "node:assert/strict";
import { parseDocumentCheckpoint } from "../lib/document-checkpoint.js";

const fixture = {
  id: "document-1",
  indexVersion: 4,
  name: "lecture.pdf",
  chunks: [{ id: "page-1-chunk-1", number: 1, text: "Thread control block" }],
};

test("document checkpoints restore parsed and visual stages", () => {
  const checkpoint = parseDocumentCheckpoint(JSON.stringify(fixture), "parsed");
  assert.equal(checkpoint.stage, "parsed");
  assert.equal(checkpoint.document.chunks[0].id, "page-1-chunk-1");
});

test("document checkpoints reject unknown stages and invalid locators", () => {
  assert.throws(() => parseDocumentCheckpoint(JSON.stringify(fixture), "embedding"), /无法识别/);
  assert.throws(() => parseDocumentCheckpoint(JSON.stringify({
    ...fixture,
    chunks: [{ id: "bad", number: 999, text: "bad" }],
  }), "parsed"), /安全校验/);
});
