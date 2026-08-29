import { NextResponse } from "next/server";
import {
  APP_ACCESS_COOKIE,
  appAccessSignature,
  configuredAppAccessKey,
  verifyAppAccess,
  verifyAppAccessKey,
} from "@/lib/app-access.js";
import {
  checkRequestRateLimit,
  rateLimitHeaders,
  verifySameOriginRequest,
} from "@/lib/request-security.js";

export const runtime = "nodejs";

function noStore(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

export async function GET(request: Request) {
  return noStore(verifyAppAccess(request));
}

export async function POST(request: Request) {
  const originCheck = verifySameOriginRequest(request);
  if (!originCheck.allowed) {
    return noStore({ error: { code: originCheck.code, message: "已阻止跨站访问请求。" } }, originCheck.status);
  }
  const rateLimit = checkRequestRateLimit(request, {
    scope: "app-access",
    limit: 8,
    windowMs: 15 * 60 * 1_000,
  });
  if (!rateLimit.allowed) {
    return noStore(
      { error: { code: "RATE_LIMITED", message: "尝试次数过多，请稍后再试。" } },
      429,
      rateLimitHeaders(rateLimit),
    );
  }
  const contentLengthHeader = request.headers.get("content-length");
  const contentLength = Number(contentLengthHeader);
  if (!contentLengthHeader || !Number.isFinite(contentLength) || contentLength <= 0) {
    return noStore({ error: { code: "CONTENT_LENGTH_REQUIRED", message: "无法确认请求大小。" } }, 411);
  }
  if (contentLength > 2_048) {
    return noStore({ error: { code: "REQUEST_TOO_LARGE", message: "请求内容过大。" } }, 413);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return noStore({ error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "请求格式无效。" } }, 415);
  }
  const secret = configuredAppAccessKey();
  if (!secret) {
    return noStore({ configured: false, authorized: true });
  }
  const payload = await request.json().catch(() => null) as { key?: string } | null;
  if (!payload?.key || !verifyAppAccessKey(payload.key, secret)) {
    return noStore({ error: { code: "ACCESS_DENIED", message: "访问密钥无效。" } }, 401);
  }
  const response = noStore({ configured: true, authorized: true });
  response.cookies.set(APP_ACCESS_COOKIE, appAccessSignature(secret), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}

export async function DELETE() {
  const response = noStore({ authorized: false });
  response.cookies.delete(APP_ACCESS_COOKIE);
  return response;
}
