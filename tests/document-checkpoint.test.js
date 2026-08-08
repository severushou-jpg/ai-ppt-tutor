import test from "node:test";
import assert from "node:assert/strict";
import {
  parseDocumentCheckpoint,
  signDocumentCheckpoint,
} from "../lib/document-checkpoint.js";
import { DOCUMENT_INDEX_VERSION } from "../lib/rag.js";

const fixture = {
  id: "document-1",
  indexVersion: DOCUMENT_INDEX_VERSION,
  name: "lecture.pdf",
  ocr: {
    mode: "force",
    totalPageCount: 1,
    successfulPageCount: 1,
    failedPageCount: 0,
    inspectedPageCount: 1,
  },
  chunks: [{ id: "page-1-chunk-1", number: 1, text: "Thread control block" }],
};
const TEST_SECRET = "unit-test-checkpoint-secret";

function signedCheckpoint(document = fixture, stage = "parsed") {
  const payload = JSON.stringify(document);
  return {
    payload,
    signature: signDocumentCheckpoint(payload, stage, TEST_SECRET),
  };
}

test("document checkpoints restore parsed and visual stages", () => {
  const signed = signedCheckpoint();
  const checkpoint = parseDocumentCheckpoint(signed.payload, "parsed", signed.signature, TEST_SECRET);
  assert.equal(checkpoint.stage, "parsed");
  assert.equal(checkpoint.document.chunks[0].id, "page-1-chunk-1");
});

test("document checkpoints reject unknown stages and invalid locators", () => {
  const signed = signedCheckpoint();
  assert.throws(() => parseDocumentCheckpoint(signed.payload, "embedding", signed.signature, TEST_SECRET), /无法识别/);
  const invalid = signedCheckpoint({
    ...fixture,
    chunks: [{ id: "bad", number: 999, text: "bad" }],
  });
  assert.throws(() => parseDocumentCheckpoint(invalid.payload, "parsed", invalid.signature, TEST_SECRET), /安全校验/);
});

test("document checkpoints reject missing signatures and tampered payloads", () => {
  const signed = signedCheckpoint();
  assert.throws(() => parseDocumentCheckpoint(signed.payload, "parsed", null, TEST_SECRET), /格式无效/);
  assert.throws(() => parseDocumentCheckpoint(`${signed.payload} `, "parsed", signed.signature, TEST_SECRET), /格式无效/);
});
