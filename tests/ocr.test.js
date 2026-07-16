import assert from "node:assert/strict";
import test from "node:test";
import {
  applyOcrManifest,
  mergeNativeAndOcrText,
  OcrManifestError,
  parseOcrManifest,
} from "../lib/ocr.js";

test("none mode does not require an OCR manifest", () => {
  assert.equal(parseOcrManifest(null, "none"), null);
});

test("force mode validates and normalizes page results", () => {
  const manifest = parseOcrManifest(JSON.stringify({
    mode: "force",
    sourceType: "pdf",
    pages: [
      { number: 2, text: " 第二页\r\n文字 ", confidence: 88.8, durationMs: 1200 },
      { number: 1, text: "第一页", confidence: 101, durationMs: -1 },
    ],
  }), "force");
  assert.deepEqual(manifest.pages.map((page) => page.number), [1, 2]);
  assert.equal(manifest.pages[0].confidence, 100);
  assert.equal(manifest.pages[0].durationMs, 0);
  assert.equal(manifest.pages[1].text, "第二页\n文字");
});

test("force mode rejects duplicate page numbers", () => {
  assert.throws(
    () => parseOcrManifest({
      mode: "force",
      pages: [{ number: 1 }, { number: 1 }],
    }, "force"),
    (error) => error instanceof OcrManifestError && error.code === "INVALID_OCR_PAGE",
  );
});

test("native and OCR text merge without repeating matching lines", () => {
  const merged = mergeNativeAndOcrText(
    "线程基础\n线程共享进程资源",
    "线程基础\n线程共享进程资源\n图片中的调度示意图",
  );
  assert.equal(merged.textOrigin, "mixed");
  assert.equal(merged.text.match(/线程基础/g).length, 1);
  assert.match(merged.text, /图片中的调度示意图/);
});

test("OCR results are applied to matching PDF pages with metadata", () => {
  const ast = {
    content: [
      { type: "page", metadata: { pageNumber: 1 }, text: "原生标题" },
      { type: "page", metadata: { pageNumber: 2 }, text: "" },
    ],
  };
  const manifest = parseOcrManifest({
    mode: "force",
    sourceType: "pdf",
    pages: [
      { number: 1, text: "原生标题", confidence: 95, durationMs: 10 },
      { number: 2, text: "扫描页文字", confidence: 80, durationMs: 20 },
    ],
  }, "force");
  const result = applyOcrManifest(ast, manifest);
  assert.equal(result.ast.content[0].metadata.textOrigin, "native");
  assert.equal(result.ast.content[1].text, "扫描页文字");
  assert.equal(result.ast.content[1].metadata.textOrigin, "ocr");
  assert.equal(result.summary.successfulPageCount, 2);
  assert.equal(result.summary.averageConfidence, 87.5);
});
