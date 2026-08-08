import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  RELATIONAL_MODEL_ANCHORS,
  RELATIONAL_MODEL_PDF_SHA256,
  RELATIONAL_MODEL_PUBLIC_PATH,
} from "../lib/study/relational-model-material.js";

function normalize(value) {
  return String(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

test("the frozen DBI PDF, quote anchors and highlight rectangles agree", async () => {
  const file = path.join(process.cwd(), "public", RELATIONAL_MODEL_PUBLIC_PATH.replace(/^\/+/, ""));
  const bytes = await readFile(file);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), RELATIONAL_MODEL_PDF_SHA256);

  const loadingTask = getDocument({ data: new Uint8Array(bytes), disableWorker: true });
  const document = await loadingTask.promise;
  assert.equal(document.numPages, 27);
  const pageText = new Map();
  for (const pageNumber of new Set(RELATIONAL_MODEL_ANCHORS.map((anchor) => anchor.pdfPage))) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pageText.set(pageNumber, normalize(content.items.map((item) => item.str).join(" ")));
  }

  assert.ok(RELATIONAL_MODEL_ANCHORS.length >= 40);
  for (const anchor of RELATIONAL_MODEL_ANCHORS) {
    assert.ok(pageText.get(anchor.pdfPage).includes(normalize(anchor.exactQuote)), `${anchor.anchorId} quote not found`);
    assert.ok(anchor.rectangles.length > 0, `${anchor.anchorId} has no frozen rectangle`);
    for (const rectangle of anchor.rectangles) {
      assert.ok(rectangle.x >= 0 && rectangle.y >= 0);
      assert.ok(rectangle.width > 0 && rectangle.height > 0);
      assert.ok(rectangle.x + rectangle.width <= 1.01, `${anchor.anchorId} rectangle exceeds page width`);
      assert.ok(rectangle.y + rectangle.height <= 1.01, `${anchor.anchorId} rectangle exceeds page height`);
    }
  }

  await loadingTask.destroy();
});
