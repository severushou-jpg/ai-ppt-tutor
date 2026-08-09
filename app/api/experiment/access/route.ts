import { NextResponse } from "next/server";
import {
  checkRequestRateLimit,
  rateLimitHeaders,
  verifySameOriginRequest,
} from "@/lib/request-security.js";
import { verifyAppAccess } from "@/lib/app-access.js";
import {
  EXPERIMENT_ADMIN_COOKIE,
  configuredExperimentAdminKey,
  experimentAdminCapability,
  experimentAdminSignature,
  shouldUseSecureExperimentCookie,
  verifyExperimentAdminKey,
} from "@/lib/experiment-admin.js";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return NextResponse.json(experimentAdminCapability(request), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const experimentAccess = experimentAdminCapability(request);
  const originCheck = verifySameOriginRequest(request);
  if (!originCheck.allowed) {
    return NextResponse.json({
      error: { code: originCheck.code, message: "已阻止跨站访问请求。" },
    }, { status: originCheck.status });
  }
  const appAccess = verifyAppAccess(request);
  if (appAccess.configured && !appAccess.authorized) {
    return NextResponse.json({
      error: { code: "APP_ACCESS_REQUIRED", message: "请先输入项目访问密钥。" },
    }, { status: 401 });
  }
  if (appAccess.configurationMissing && !experimentAccess.localBypass) {
    return NextResponse.json({
      error: { code: "APP_ACCESS_NOT_CONFIGURED", message: "生产环境尚未配置项目访问密钥。" },
    }, { status: 503 });
  }
  if (experimentAccess.localBypass) {
    return NextResponse.json(experimentAccess, {
      headers: { "Cache-Control": "no-store" },
    });
  }
  const rateLimit = checkRequestRateLimit(request, {
    scope: "experiment-access",
    limit: 8,
    windowMs: 15 * 60 * 1_000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json({
      error: { code: "RATE_LIMITED", message: "尝试次数过多，请稍后再试。" },
    }, { status: 429, headers: rateLimitHeaders(rateLimit) });
  }
  const contentLengthHeader = request.headers.get("content-length");
  const contentLength = Number(contentLengthHeader);
  if (!contentLengthHeader || !Number.isFinite(contentLength) || contentLength <= 0) {
    return NextResponse.json({
      error: { code: "CONTENT_LENGTH_REQUIRED", message: "无法确认请求大小。" },
    }, { status: 411 });
  }
  if (contentLength > 2_048) {
    return NextResponse.json({
      error: { code: "REQUEST_TOO_LARGE", message: "请求内容过大。" },
    }, { status: 413 });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({
      error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "请求格式无效。" },
    }, { status: 415 });
  }
  const secret = configuredExperimentAdminKey();
  if (!secret) {
    return NextResponse.json({ error: { code: "EXPERIMENT_NOT_CONFIGURED", message: "实验控制密钥尚未配置。" } }, { status: 503 });
  }
  const payload = await request.json().catch(() => null) as { key?: string } | null;
  if (!payload?.key || !verifyExperimentAdminKey(payload.key, secret)) {
    return NextResponse.json({ error: { code: "EXPERIMENT_ACCESS_DENIED", message: "实验控制密钥无效。" } }, { status: 401 });
  }
  const response = NextResponse.json({
    configured: true,
    authorized: true,
    localBypass: false,
    keyRequired: true,
    requireResearcherKeyForConsent: true,
    capability: "researcher-cookie",
  }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(EXPERIMENT_ADMIN_COOKIE, experimentAdminSignature(secret), {
    httpOnly: true,
    sameSite: "strict",
    secure: shouldUseSecureExperimentCookie(request),
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return response;
}
