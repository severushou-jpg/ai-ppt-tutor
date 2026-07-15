import { NextResponse } from "next/server";
import {
  DocumentProcessingError,
  parseDocument,
} from "@/lib/document-parser.js";
import { DOCUMENT_LIMITS } from "@/lib/rag.js";

export const runtime = "nodejs";
export const maxDuration = 45;

function jsonResponse(body, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  const requestLimit = DOCUMENT_LIMITS.maxFileBytes + 1024 * 1024;
  if (contentLength > requestLimit) {
    return jsonResponse(
      {
        error: {
          code: "REQUEST_TOO_LARGE",
          message: `上传内容超过 ${DOCUMENT_LIMITS.maxFileBytes / 1024 / 1024}MB 限制。`,
        },
      },
      413,
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const document = await parseDocument(file);
    return jsonResponse({ document });
  } catch (error) {
    if (error instanceof DocumentProcessingError) {
      return jsonResponse(
        {
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
        },
        error.status,
      );
    }

    console.error("Document processing failed", error);
    return jsonResponse(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "课件处理失败，请稍后重试。",
        },
      },
      500,
    );
  }
}
