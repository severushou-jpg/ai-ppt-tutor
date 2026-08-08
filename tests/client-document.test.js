import assert from "node:assert/strict";
import test from "node:test";
import { parseClientDocument } from "../lib/document-parser.js";

test("client-extracted page text builds an index without uploading the source file", async () => {
  const document = await parseClientDocument({ name: "lecture.pdf", size: 12_000 }, {
    ocrMode: "none",
    ocrManifest: JSON.stringify({
      version: 4,
      mode: "none",
      engine: "tesseract.js",
      sourceType: "pdf",
      languages: ["chi_sim", "eng"],
      pages: [],
      nativePages: [
        { number: 1, text: "Thread scheduling and concurrency fundamentals" },
        { number: 2, text: "A thread has a thread control block and execution context" },
      ],
      inspectedPageCount: 2,
      visuals: [],
    }),
  });
  assert.equal(document.sectionCount, 2);
  assert.equal(document.ocr.mode, "none");
  assert.ok(document.chunks.some((chunk) => /thread control block/i.test(chunk.text)));
});
