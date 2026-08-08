import { StudyError } from "./validation.js";
import { STUDY_MODEL_VERSION } from "./canonical.js";

const DEFAULT_ATTEMPT_TIMEOUT_MS = 28_000;
const DEFAULT_RETRY_DELAY_MS = 100;
const MAX_ATTEMPTS = 2;

function retryable(error) {
  return error?.retryable === true;
}

function markRetryable(error) {
  error.retryable = true;
  return error;
}

function clientAbortError() {
  return new StudyError("STUDY_REQUEST_ABORTED", "The study request was cancelled.", 499);
}

async function waitBeforeRetry(milliseconds, signal) {
  if (signal?.aborted) throw clientAbortError();
  if (milliseconds <= 0) return;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timeout);
      reject(clientAbortError());
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function callStudyDashScope(messages, options = {}) {
  const apiKey = options.apiKey || process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    throw new StudyError("STUDY_MODEL_NOT_CONFIGURED", "The local study model is not configured.", 503);
  }
  const fetchImpl = options.fetchImpl || fetch;
  const requestSignal = options.signal;
  const configuredTimeout = Number(options.attemptTimeoutMs);
  const attemptTimeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? configuredTimeout
    : DEFAULT_ATTEMPT_TIMEOUT_MS;
  const configuredDelay = Number(options.retryDelayMs);
  const retryDelayMs = options.retryDelayMs === undefined
    ? DEFAULT_RETRY_DELAY_MS
    : Number.isFinite(configuredDelay) ? Math.max(0, configuredDelay) : DEFAULT_RETRY_DELAY_MS;
  const body = JSON.stringify({
    model: STUDY_MODEL_VERSION,
    input: { messages },
    parameters: {
      result_format: "message",
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: options.purpose === "attribution" ? 1_500 : 3_500,
    },
  });

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (requestSignal?.aborted) throw clientAbortError();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort("timeout"), attemptTimeoutMs);
    const clientAbort = () => controller.abort("client-aborted");
    requestSignal?.addEventListener("abort", clientAbort, { once: true });
    try {
      const response = await fetchImpl(
        "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body,
          signal: controller.signal,
        },
      );
      const data = await response.json().catch(() => null);
      if (!response.ok || data?.code) {
        const rateLimited = response.status === 429;
        const serverFailure = response.status >= 500;
        const error = new StudyError(
          rateLimited ? "STUDY_MODEL_RATE_LIMIT" : "STUDY_MODEL_REQUEST_FAILED",
          rateLimited
            ? "The study model is temporarily busy. Please inform the researcher."
            : "The study model request failed. Please inform the researcher.",
          rateLimited ? 429 : 502,
        );
        throw rateLimited || serverFailure ? markRetryable(error) : error;
      }
      const content = data?.output?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        throw new StudyError("EMPTY_STUDY_MODEL_RESPONSE", "The study model returned no answer.", 502);
      }
      return content.trim();
    } catch (caught) {
      let error = caught;
      if (controller.signal.aborted) {
        if (controller.signal.reason === "client-aborted") throw clientAbortError();
        error = markRetryable(new StudyError(
          "STUDY_MODEL_TIMEOUT",
          "The study model timed out. Please inform the researcher.",
          504,
        ));
      } else if (!(error instanceof StudyError)) {
        error = markRetryable(new StudyError(
          "STUDY_MODEL_REQUEST_FAILED",
          "The study model request failed. Please inform the researcher.",
          502,
        ));
      }
      if (attempt + 1 >= MAX_ATTEMPTS || !retryable(error)) throw error;
      await waitBeforeRetry(retryDelayMs, requestSignal);
    } finally {
      clearTimeout(timeout);
      requestSignal?.removeEventListener("abort", clientAbort);
    }
  }
  throw new StudyError("STUDY_MODEL_REQUEST_FAILED", "The study model request failed.", 502);
}
