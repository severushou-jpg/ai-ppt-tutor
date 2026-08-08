import assert from "node:assert/strict";
import test from "node:test";
import {
  checkRequestRateLimit,
  createFixedWindowRateLimiter,
  evaluateSameOriginRequest,
  extractClientIp,
  rateLimitHeaders,
  verifySameOriginRequest,
} from "../lib/request-security.js";

test("same-origin guard accepts a matching Origin and rejects mismatches", () => {
  assert.deepEqual(
    evaluateSameOriginRequest({
      requestUrl: "https://tutor.example/api/documents",
      origin: "https://tutor.example",
      fetchSite: "same-origin",
    }),
    { allowed: true },
  );

  const mismatch = evaluateSameOriginRequest({
    requestUrl: "https://tutor.example/api/documents",
    origin: "https://attacker.example",
    fetchSite: "same-site",
  });
  assert.equal(mismatch.allowed, false);
  assert.equal(mismatch.status, 403);
  assert.equal(mismatch.code, "CROSS_SITE_REQUEST_BLOCKED");
  assert.equal(mismatch.reason, "origin-mismatch");
});

test("same-origin guard blocks cross-site fetch metadata even without Origin", () => {
  const result = evaluateSameOriginRequest({
    requestUrl: "https://tutor.example/api/ai",
    fetchSite: "cross-site",
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "cross-site-fetch");
});

test("same-origin guard handles non-browser clients and strict mode", () => {
  assert.deepEqual(
    evaluateSameOriginRequest({ requestUrl: "https://tutor.example/api/ai" }),
    { allowed: true },
  );
  assert.deepEqual(
    evaluateSameOriginRequest({
      requestUrl: "https://tutor.example/api/ai",
      fetchSite: "same-site",
    }),
    { allowed: true },
  );

  const strict = evaluateSameOriginRequest(
    { requestUrl: "https://tutor.example/api/ai" },
    { allowMissingOrigin: false },
  );
  assert.equal(strict.allowed, false);
  assert.equal(strict.reason, "origin-required");
});

test("same-origin guard rejects null origins and malformed metadata", () => {
  assert.equal(evaluateSameOriginRequest({
    requestUrl: "https://tutor.example/api/ai",
    origin: "null",
  }).allowed, false);
  assert.equal(evaluateSameOriginRequest({
    requestUrl: "https://tutor.example/api/ai",
    fetchSite: "invented",
  }).reason, "invalid-fetch-metadata");
});

test("Request adapter reads standard Headers", () => {
  const request = new Request("https://tutor.example/api/documents", {
    method: "POST",
    headers: {
      Origin: "https://tutor.example",
      "Sec-Fetch-Site": "same-origin",
    },
  });
  assert.deepEqual(verifySameOriginRequest(request), { allowed: true });
});

test("Request adapter uses the browser-facing Host behind a local proxy", () => {
  const request = new Request("http://localhost:3000/api/study/create", {
    method: "POST",
    headers: {
      Host: "127.0.0.1:3101",
      Origin: "http://127.0.0.1:3101",
      "Sec-Fetch-Site": "same-origin",
    },
  });
  assert.deepEqual(verifySameOriginRequest(request), { allowed: true });

  const proxied = new Request("http://127.0.0.1:3000/api/study/create", {
    method: "POST",
    headers: {
      Host: "internal:3000",
      Origin: "https://study.example",
      "X-Forwarded-Host": "study.example",
      "X-Forwarded-Proto": "https",
      "Sec-Fetch-Site": "same-origin",
    },
  });
  assert.deepEqual(verifySameOriginRequest(proxied), { allowed: true });
});

test("IP extraction follows platform priority and first-forwarded semantics", () => {
  const headers = new Headers({
    "x-vercel-forwarded-for": "203.0.113.8, 10.0.0.1",
    "x-forwarded-for": "198.51.100.7",
    "x-real-ip": "192.0.2.4",
  });
  assert.equal(extractClientIp(headers), "203.0.113.8");
  assert.equal(extractClientIp({ "X-Forwarded-For": "198.51.100.7, 10.0.0.2" }), "198.51.100.7");
  assert.equal(extractClientIp({ "x-real-ip": "192.0.2.4" }), "192.0.2.4");
  assert.equal(extractClientIp({}), "unknown");
});

test("fixed-window limiter exposes remaining capacity and Retry-After", () => {
  const limiter = createFixedWindowRateLimiter({ maxEntries: 10 });
  assert.deepEqual(limiter.consume("ip", { limit: 2, windowMs: 10_000, now: 1_000 }), {
    allowed: true,
    limit: 2,
    remaining: 1,
    resetAt: 11_000,
    resetAfterMs: 10_000,
    retryAfterSeconds: null,
  });
  assert.equal(limiter.consume("ip", { limit: 2, windowMs: 10_000, now: 2_000 }).remaining, 0);

  const blocked = limiter.consume("ip", { limit: 2, windowMs: 10_000, now: 2_001 });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 9);
  assert.deepEqual(rateLimitHeaders(blocked), {
    "RateLimit-Limit": "2",
    "RateLimit-Remaining": "0",
    "RateLimit-Reset": "11",
    "Retry-After": "9",
  });
});

test("fixed-window limiter resets exactly at the window boundary", () => {
  const limiter = createFixedWindowRateLimiter();
  limiter.consume("ip", { limit: 1, windowMs: 1_000, now: 5_000 });
  assert.equal(limiter.consume("ip", { limit: 1, windowMs: 1_000, now: 5_999 }).allowed, false);
  const reset = limiter.consume("ip", { limit: 1, windowMs: 1_000, now: 6_000 });
  assert.equal(reset.allowed, true);
  assert.equal(reset.resetAt, 7_000);
});

test("fixed-window limiter remains bounded and evicts the least-recent bucket", () => {
  const limiter = createFixedWindowRateLimiter({ maxEntries: 2 });
  limiter.consume("a", { limit: 1, windowMs: 10_000, now: 0 });
  limiter.consume("b", { limit: 1, windowMs: 10_000, now: 0 });
  limiter.consume("a", { limit: 1, windowMs: 10_000, now: 1 });
  limiter.consume("c", { limit: 1, windowMs: 10_000, now: 2 });
  assert.equal(limiter.size, 2);
  assert.equal(limiter.consume("b", { limit: 1, windowMs: 10_000, now: 3 }).allowed, true);
});

test("request rate limiter scopes buckets by route and extracted IP", () => {
  const limiter = createFixedWindowRateLimiter();
  const request = { headers: { "x-vercel-forwarded-for": "203.0.113.10" } };
  assert.equal(checkRequestRateLimit(request, {
    scope: "documents",
    limit: 1,
    windowMs: 1_000,
    now: 0,
    limiter,
  }).allowed, true);
  assert.equal(checkRequestRateLimit(request, {
    scope: "documents",
    limit: 1,
    windowMs: 1_000,
    now: 1,
    limiter,
  }).allowed, false);
  assert.equal(checkRequestRateLimit(request, {
    scope: "ai",
    limit: 1,
    windowMs: 1_000,
    now: 1,
    limiter,
  }).allowed, true);
});
