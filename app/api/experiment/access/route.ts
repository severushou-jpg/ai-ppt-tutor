import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  checkRequestRateLimit,
  rateLimitHeaders,
  verifySameOriginRequest,
} from "@/lib/request-security.js";
import { verifyAppAccess } from "@/lib/app-access.js";

export const runtime = "nodejs";

const COOKIE_NAME = "ai-ppt-experiment-admin";
const COOKIE_VALUE = "authorized";

function signature(secret: string) {
  return createHmac("sha256", secret).update(COOKIE_VALUE).digest("hex");
}

function configuredSecret() {
  return process.env.EXPERIMENT_ADMIN_KEY?.trim() ?? "";
}

function equalSecret(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

async function authorized() {
  const secret = configuredSecret();
  if (!secret) return false;
  const value = (await cookies()).get(COOKIE_NAME)?.value ?? "";
  return equalSecret(value, signature(secret));
}

export async function GET() {
  return NextResponse.json({ authorized: await authorized() }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const originCheck = verifySameOriginRequest(request);
  if (!originCheck.allowed) {
    return NextResponse.json({
      error: { code: originCheck.code, message: "已阻止跨站访问请求。" },
    }, { status: originCheck.status });
  }
  const appAccess = verifyAppAccess(request);
  if (appAccess.configurationMissing) {
    return NextResponse.json({
      error: { code: "APP_ACCESS_NOT_CONFIGURED", message: "服务器尚未配置项目访问密钥。" },
    }, { status: 503 });
  }
  if (!appAccess.authorized) {
    return NextResponse.json({
      error: { code: "APP_ACCESS_REQUIRED", message: "请先输入项目访问密钥。" },
    }, { status: 401 });
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
  const secret = configuredSecret();
  if (!secret) {
    return NextResponse.json({ error: { code: "EXPERIMENT_NOT_CONFIGURED", message: "实验控制密钥尚未配置。" } }, { status: 503 });
  }
  const payload = await request.json().catch(() => null) as { key?: string } | null;
  if (!payload?.key || !equalSecret(payload.key, secret)) {
    return NextResponse.json({ error: { code: "EXPERIMENT_ACCESS_DENIED", message: "实验控制密钥无效。" } }, { status: 401 });
  }
  const response = NextResponse.json({ authorized: true });
  response.cookies.set(COOKIE_NAME, signature(secret), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return response;
}
