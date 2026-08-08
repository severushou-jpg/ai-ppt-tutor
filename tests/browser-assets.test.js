import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

const requiredAssets = [
  ["public/pdf.worker.min.mjs", 100_000],
  ["public/tesseract/worker.min.js", 50_000],
  ["public/tesseract/core/tesseract-core-lstm.wasm.js", 1_000_000],
  ["public/tesseract/core/tesseract-core-simd-lstm.wasm.js", 1_000_000],
  ["public/tesseract/core/tesseract-core-relaxedsimd-lstm.wasm.js", 1_000_000],
  ["public/tessdata/eng.traineddata.gz", 500_000],
  ["public/tessdata/chi_sim.traineddata.gz", 500_000],
];

test("browser PDF and OCR runtimes are prepared as same-origin assets", async () => {
  for (const [relativePath, minimumSize] of requiredAssets) {
    const details = await stat(path.join(root, relativePath));
    assert.ok(details.isFile(), `${relativePath} should be a file`);
    assert.ok(details.size >= minimumSize, `${relativePath} appears incomplete`);
  }
});
