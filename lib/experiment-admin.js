import { createHmac, timingSafeEqual } from "node:crypto";

export const EXPERIMENT_ADMIN_COOKIE = "ai-ppt-experiment-admin";
const COOKIE_PAYLOAD = "experiment-admin-authorized-v1";

export function configuredExperimentAdminKey() {
  return process.env.EXPERIMENT_ADMIN_KEY?.trim() || "";
}

function safeEqual(left, right) {
  const leftBytes = Buffer.from(String(left ?? ""));
  const rightBytes = Buffer.from(String(right ?? ""));
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function cookieValue(headers, name) {
  const cookie = typeof headers?.get === "function"
    ? String(headers.get("cookie") ?? "")
    : String(headers?.cookie ?? "");
  for (const part of cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

export function experimentAdminSignature(secret = configuredExperimentAdminKey()) {
  if (!secret) return "";
  return createHmac("sha256", secret).update(COOKIE_PAYLOAD).digest("hex");
}

export function verifyExperimentAdminKey(value, secret = configuredExperimentAdminKey()) {
  return Boolean(secret) && safeEqual(String(value ?? ""), secret);
}

export function verifyExperimentAdmin(request, secret = configuredExperimentAdminKey()) {
  if (!secret) return { configured: false, authorized: false, configurationMissing: true };
  const supplied = cookieValue(request?.headers, EXPERIMENT_ADMIN_COOKIE);
  return {
    configured: true,
    authorized: safeEqual(supplied, experimentAdminSignature(secret)),
  };
}

function firstHeaderValue(request, name) {
  return String(request?.headers?.get?.(name) ?? "").split(",", 1)[0].trim();
}

function hostnameFromAuthority(authority) {
  if (!authority) return "";
  try {
    return new URL(`http://${authority}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isLoopbackHostname(hostname) {
  const normalized = String(hostname ?? "").trim().toLowerCase();
  return normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "[::1]"
    || normalized === "::1";
}

export function shouldUseSecureExperimentCookie(request) {
  const forwardedProtocol = String(request?.headers?.get?.("x-forwarded-proto") ?? "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  try {
    if (new URL(request?.url).protocol === "https:") return true;
  } catch {
    // Fall through to the trusted proxy hint when no absolute URL exists.
  }
  return forwardedProtocol === "https";
}

export function isLoopbackExperimentRequest(request) {
  try {
    const requestUrl = new URL(request?.url);
    if (!["http:", "https:"].includes(requestUrl.protocol)) return false;

    // Host is browser-controlled only through the connection target and is set
    // by Next for real requests. A missing or non-loopback direct Host fails
    // closed. Forwarded headers may veto a bypass, but can never grant one.
    const directHost = hostnameFromAuthority(firstHeaderValue(request, "host"));
    if (!isLoopbackHostname(requestUrl.hostname) || !isLoopbackHostname(directHost)) return false;

    const forwardedHost = firstHeaderValue(request, "x-forwarded-host");
    if (forwardedHost && !isLoopbackHostname(hostnameFromAuthority(forwardedHost))) return false;

    const forwardedProtocol = firstHeaderValue(request, "x-forwarded-proto").toLowerCase();
    if (forwardedProtocol && `${forwardedProtocol}:` !== requestUrl.protocol) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the minimal browser-safe authorization capability. Local bypass is
 * derived from the real request target, never from a caller-supplied flag.
 */
export function experimentAdminCapability(request, secret = configuredExperimentAdminKey()) {
  const admin = verifyExperimentAdmin(request, secret);
  const localBypass = isLoopbackExperimentRequest(request);
  const authorized = localBypass || admin.authorized;
  return {
    configured: admin.configured,
    authorized,
    localBypass,
    keyRequired: !localBypass,
    requireResearcherKeyForConsent: !localBypass,
    capability: localBypass
      ? "local-loopback"
      : admin.authorized
        ? "researcher-cookie"
        : admin.configured
          ? "researcher-key"
          : "unavailable",
  };
}
