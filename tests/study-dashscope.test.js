import assert from "node:assert/strict";
import test from "node:test";
import { callStudyDashScope } from "../lib/study/dashscope.js";

const MESSAGES = [
  { role: "system", content: "Return JSON." },
  { role: "user", content: "Explain a tuple." },
];
const SUCCESS_DATA = {
  output: { choices: [{ message: { content: '{"summary":"ok","sections":[]}' } }] },
};

function fakeResponse(status, data = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  };
}

function options(fetchImpl, overrides = {}) {
  return {
    apiKey: "test-key",
    fetchImpl,
    retryDelayMs: 0,
    attemptTimeoutMs: 100,
    purpose: "core",
    ...overrides,
  };
}

test("study model retries one 429 with an identical request body", async () => {
  const bodies = [];
  const fetchImpl = async (_url, request) => {
    bodies.push(request.body);
    return bodies.length === 1
      ? fakeResponse(429, { code: "Throttling" })
      : fakeResponse(200, SUCCESS_DATA);
  };
  const result = await callStudyDashScope(MESSAGES, options(fetchImpl));
  assert.equal(result, SUCCESS_DATA.output.choices[0].message.content);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1]);
});

test("study model retries one 5xx response and never exceeds two attempts", async () => {
  let calls = 0;
  const succeedsSecond = async () => {
    calls += 1;
    return calls === 1 ? fakeResponse(503) : fakeResponse(200, SUCCESS_DATA);
  };
  await callStudyDashScope(MESSAGES, options(succeedsSecond));
  assert.equal(calls, 2);

  calls = 0;
  const alwaysFails = async () => {
    calls += 1;
    return fakeResponse(500);
  };
  await assert.rejects(
    callStudyDashScope(MESSAGES, options(alwaysFails)),
    (error) => error?.code === "STUDY_MODEL_REQUEST_FAILED",
  );
  assert.equal(calls, 2);
});

test("study model retries one network failure", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("network unavailable");
    return fakeResponse(200, SUCCESS_DATA);
  };
  await callStudyDashScope(MESSAGES, options(fetchImpl));
  assert.equal(calls, 2);
});

test("study model retries one timed-out attempt", async () => {
  let calls = 0;
  const fetchImpl = async (_url, request) => {
    calls += 1;
    if (calls > 1) return fakeResponse(200, SUCCESS_DATA);
    return new Promise((resolve, reject) => {
      request.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  };
  await callStudyDashScope(MESSAGES, options(fetchImpl, { attemptTimeoutMs: 5 }));
  assert.equal(calls, 2);
});

test("study model does not retry a non-retryable 4xx response", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return fakeResponse(400, { code: "InvalidParameter" });
  };
  await assert.rejects(
    callStudyDashScope(MESSAGES, options(fetchImpl)),
    (error) => error?.code === "STUDY_MODEL_REQUEST_FAILED",
  );
  assert.equal(calls, 1);
});

test("participant cancellation is never retried", async () => {
  let calls = 0;
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    callStudyDashScope(MESSAGES, options(async () => {
      calls += 1;
      return fakeResponse(200, SUCCESS_DATA);
    }, { signal: controller.signal })),
    (error) => error?.code === "STUDY_REQUEST_ABORTED",
  );
  assert.equal(calls, 0);
});
