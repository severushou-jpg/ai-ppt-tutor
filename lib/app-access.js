import { createHmac, timingSafeEqual } from "node:crypto";

export const APP_ACCESS_COOKIE = "ai-ppt-tutor-access";
const COOKIE_PAYLOAD = "authorized-v1";

export function configuredAppAccessKey() {
  return process.env.APP_ACCESS_KEY?.trim() || "";
}

export function appAccessSignature(secret = configuredAppAccessKey()) {
  if (!secret) return "";
  return createHmac("sha256", secret).update(COOKIE_PAYLOAD).digest("hex");
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

export function verifyAppAccess(
  request,
  secret = configuredAppAccessKey(),
  {
    production = process.env.NODE_ENV === "production",
    allowPublic = process.env.ALLOW_PUBLIC_AI === "true",
  } = {},
) {
  if (!secret) {
    const authorized = !production || allowPublic;
    return {
      configured: false,
      authorized,
      ...(authorized ? {} : { configurationMissing: true }),
    };
  }
  const supplied = cookieValue(request?.headers, APP_ACCESS_COOKIE);
  return {
    configured: true,
    authorized: safeEqual(supplied, appAccessSignature(secret)),
  };
}

export function verifyAppAccessKey(value, secret = configuredAppAccessKey()) {
  return Boolean(secret) && safeEqual(String(value ?? ""), secret);
}
