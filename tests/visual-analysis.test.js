import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeVisualCandidates,
  resolveMultimodalEndpoint,
} from "../lib/visual-analysis.js";

test("visual endpoint only accepts trusted Aliyun HTTPS hosts", () => {
  assert.equal(
    new URL(resolveMultimodalEndpoint("https://dashscope.aliyuncs.com/api/v1/test")).hostname,
    "dashscope.aliyuncs.com",
  );
  assert.equal(
    new URL(resolveMultimodalEndpoint("https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/test")).hostname,
    "workspace.cn-beijing.maas.aliyuncs.com",
  );
  assert.throws(() => resolveMultimodalEndpoint("http://dashscope.aliyuncs.com/test"), /HTTPS/);
  assert.throws(() => resolveMultimodalEndpoint("https://attacker.example/test"), /受信任/);
});

test("visual analysis stops when the processing stream is cancelled", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  globalThis.fetch = async (_url, options = {}) => await new Promise((resolve, reject) => {
    const rejectAbort = () => reject(new DOMException("Aborted", "AbortError"));
    if (options.signal?.aborted) rejectAbort();
    else options.signal?.addEventListener("abort", rejectAbort, { once: true });
  });

  try {
    const analysis = analyzeVisualCandidates({
      visuals: [{
        id: "chart-1",
        kind: "page",
        number: 1,
        imageDataUrl: "data:image/png;base64,AA==",
        crop: { x: 0, y: 0, width: 10, height: 10 },
        score: 0.8,
      }],
    }, "test-key", { signal: controller.signal });
    controller.abort();
    await assert.rejects(analysis, (error) => error?.name === "AbortError");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
