const DEFAULT_MAX_RATE_LIMIT_BUCKETS = 2_000;

function readHeader(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return String(headers.get(name) ?? "").trim();

  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return String(Array.isArray(value) ? value[0] : value ?? "").trim();
    }
  }
  return "";
}

function normalizeOrigin(value) {
  if (!value || value === "null") return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Pure same-origin/fetch-metadata policy. Missing browser headers are allowed by
 * default so server-to-server and test clients remain usable; callers can opt
 * into requiring an Origin header.
 */
export function evaluateSameOriginRequest(
  { requestUrl, origin = "", fetchSite = "" },
  { allowMissingOrigin = true, allowSameSiteWithoutOrigin = true } = {},
) {
  const normalizedFetchSite = String(fetchSite ?? "").trim().toLowerCase();
  const knownFetchSites = new Set(["same-origin", "same-site", "cross-site", "none"]);

  if (normalizedFetchSite && !knownFetchSites.has(normalizedFetchSite)) {
    return {
      allowed: false,
      status: 403,
      code: "CROSS_SITE_REQUEST_BLOCKED",
      reason: "invalid-fetch-metadata",
    };
  }
  if (normalizedFetchSite === "cross-site") {
    return {
      allowed: false,
      status: 403,
      code: "CROSS_SITE_REQUEST_BLOCKED",
      reason: "cross-site-fetch",
    };
  }

  const suppliedOrigin = String(origin ?? "").trim();
  if (suppliedOrigin) {
    const expectedOrigin = normalizeOrigin(requestUrl);
    const actualOrigin = normalizeOrigin(suppliedOrigin);
    if (!expectedOrigin || !actualOrigin || actualOrigin !== expectedOrigin) {
      return {
        allowed: false,
        status: 403,
        code: "CROSS_SITE_REQUEST_BLOCKED",
        reason: "origin-mismatch",
      };
    }
    return { allowed: true };
  }

  if (normalizedFetchSite === "same-origin") return { allowed: true };
  if (normalizedFetchSite === "same-site" && allowSameSiteWithoutOrigin) return { allowed: true };
  if (allowMissingOrigin && (!normalizedFetchSite || normalizedFetchSite === "none")) {
    return { allowed: true };
  }

  return {
    allowed: false,
    status: 403,
    code: "CROSS_SITE_REQUEST_BLOCKED",
    reason: "origin-required",
  };
}

/** Adapts the pure policy to a standard/Next.js Request object. */
export function verifySameOriginRequest(request, options) {
  const forwardedHost = readHeader(request?.headers, "x-forwarded-host").split(",", 1)[0].trim();
  const host = forwardedHost || readHeader(request?.headers, "host").split(",", 1)[0].trim();
  const forwardedProtocol = readHeader(request?.headers, "x-forwarded-proto").split(",", 1)[0].trim();
  let requestUrl = request?.url;
  if (host) {
    try {
      const fallbackProtocol = new URL(request?.url).protocol.replace(":", "");
      const protocol = forwardedProtocol || fallbackProtocol;
      requestUrl = new URL(`${protocol}://${host}`).toString();
    } catch {
      // The pure policy below rejects an invalid target URL.
      requestUrl = "";
    }
  }
  return evaluateSameOriginRequest(
    {
      requestUrl,
      origin: readHeader(request?.headers, "origin"),
      fetchSite: readHeader(request?.headers, "sec-fetch-site"),
    },
    options,
  );
}

/**
 * Returns the first client address from trusted-platform headers, in priority
 * order. The value is bounded before it is used as an in-memory key.
 */
export function extractClientIp(headers) {
  for (const name of ["x-vercel-forwarded-for", "x-forwarded-for", "x-real-ip"]) {
    const value = readHeader(headers, name);
    if (!value) continue;
    const firstAddress = value.split(",", 1)[0].trim();
    if (firstAddress) return firstAddress.slice(0, 128);
  }
  return "unknown";
}

function assertRateLimitConfiguration(limit, windowMs) {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new TypeError("Rate limit must be a positive integer.");
  }
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new TypeError("Rate-limit windowMs must be a positive number.");
  }
}

function rateLimitResult(allowed, bucket, limit, now) {
  const resetAfterMs = Math.max(0, bucket.resetAt - now);
  return {
    allowed,
    limit,
    remaining: allowed ? Math.max(0, limit - bucket.count) : 0,
    resetAt: bucket.resetAt,
    resetAfterMs,
    retryAfterSeconds: allowed ? null : Math.max(1, Math.ceil(resetAfterMs / 1_000)),
  };
}

/**
 * Creates a bounded, in-memory, fixed-window limiter. It is intentionally a
 * best-effort per-process guard; distributed deployments can replace it with a
 * shared limiter while keeping the same result shape.
 */
export function createFixedWindowRateLimiter({
  maxEntries = DEFAULT_MAX_RATE_LIMIT_BUCKETS,
  clock = Date.now,
} = {}) {
  if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
    throw new TypeError("maxEntries must be a positive integer.");
  }
  if (typeof clock !== "function") throw new TypeError("clock must be a function.");

  const buckets = new Map();

  function removeExpired(now) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  function makeRoom(now) {
    if (buckets.size < maxEntries) return;
    removeExpired(now);
    while (buckets.size >= maxEntries) {
      const oldestKey = buckets.keys().next().value;
      if (oldestKey === undefined) break;
      buckets.delete(oldestKey);
    }
  }

  function touch(key, bucket) {
    buckets.delete(key);
    buckets.set(key, bucket);
  }

  return {
    consume(key, { limit, windowMs, now = clock() }) {
      assertRateLimitConfiguration(limit, windowMs);
      if (!Number.isFinite(now)) throw new TypeError("now must be a finite number.");

      const normalizedKey = String(key || "unknown").slice(0, 256);
      let bucket = buckets.get(normalizedKey);
      if (!bucket || bucket.resetAt <= now) {
        if (bucket) buckets.delete(normalizedKey);
        makeRoom(now);
        bucket = { count: 1, resetAt: now + windowMs };
        buckets.set(normalizedKey, bucket);
        return rateLimitResult(true, bucket, limit, now);
      }

      if (bucket.count >= limit) {
        touch(normalizedKey, bucket);
        return rateLimitResult(false, bucket, limit, now);
      }

      bucket.count += 1;
      touch(normalizedKey, bucket);
      return rateLimitResult(true, bucket, limit, now);
    },
    reset(key) {
      buckets.delete(String(key || "unknown").slice(0, 256));
    },
    clear() {
      buckets.clear();
    },
    get size() {
      return buckets.size;
    },
  };
}

const sharedRateLimiter = createFixedWindowRateLimiter();

/** Applies the shared limiter to a Request, partitioned by route scope and IP. */
export function checkRequestRateLimit(
  request,
  { scope = "default", limit, windowMs, now = undefined, limiter = sharedRateLimiter },
) {
  const ip = extractClientIp(request?.headers);
  const key = `${String(scope).slice(0, 80)}:${ip}`;
  return limiter.consume(key, { limit, windowMs, ...(now === undefined ? {} : { now }) });
}

/** Converts limiter metadata to response headers, including Retry-After on 429. */
export function rateLimitHeaders(result) {
  const headers = {
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(Math.ceil(result.resetAt / 1_000)),
  };
  if (!result.allowed && result.retryAfterSeconds != null) {
    headers["Retry-After"] = String(result.retryAfterSeconds);
  }
  return headers;
}
