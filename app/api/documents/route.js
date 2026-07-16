import { NextResponse } from "next/server";
import {
  DocumentProcessingError,
  parseDocument,
} from "@/lib/document-parser.js";
import { DOCUMENT_LIMITS } from "@/lib/rag.js";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  embedDocumentChunks,
} from "@/lib/dashscope-retrieval.js";
import { OCR_LIMITS } from "@/lib/ocr.js";

export const runtime = "nodejs";
export const maxDuration = 60;

function jsonResponse(body, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function errorPayload(error) {
  if (error instanceof DocumentProcessingError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
      status: error.status,
    };
  }
  console.error("Document processing failed", error);
  return { code: "INTERNAL_ERROR", message: "课件处理失败，请稍后重试。", status: 500 };
}

async function processDocument(file, onProgress, signal, ocrMode, ocrManifest) {
  const document = await parseDocument(file, { onProgress, ocrMode, ocrManifest });
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) return { ...document, retrievalMode: "lexical", embeddingDimensions: 0 };

  try {
    const chunks = await embedDocumentChunks(document.chunks, apiKey, {
      signal,
      onProgress: ({ completed, total }) => onProgress?.({
        phase: "embedding",
        current: completed,
        total,
        message: `正在生成语义索引 ${completed}/${total}`,
      }),
    });
    return {
      ...document,
      chunks,
      retrievalMode: "hybrid",
      embeddingModel: EMBEDDING_MODEL,
      embeddingDimensions: EMBEDDING_DIMENSIONS,
    };
  } catch (error) {
    console.error("Document embedding failed; using lexical retrieval", { message: error?.message });
    return { ...document, retrievalMode: "lexical", embeddingDimensions: 0 };
  }
}

function streamDocument(file, signal, ocrMode, ocrManifest) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        const send = (event) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        void (async () => {
          try {
            const document = await processDocument(
              file,
              (progress) => send({ type: "progress", ...progress }),
              signal,
              ocrMode,
              ocrManifest,
            );
            send({ type: "complete", document });
          } catch (error) {
            const payload = errorPayload(error);
            send({ type: "error", error: payload });
          } finally {
            controller.close();
          }
        })();
      },
    }),
    {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

export async function POST(request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  const requestLimit = DOCUMENT_LIMITS.maxFileBytes + OCR_LIMITS.maxManifestBytes + 1024 * 1024;
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
    const ocrMode = formData.get("ocrMode") === "force" ? "force" : "none";
    const ocrManifest = formData.get("ocrManifest");
    if (request.headers.get("accept")?.includes("application/x-ndjson")) {
      return streamDocument(file, request.signal, ocrMode, ocrManifest);
    }
    const document = await processDocument(file, undefined, request.signal, ocrMode, ocrManifest);
    return jsonResponse({ document });
  } catch (error) {
    const payload = errorPayload(error);
    return jsonResponse({ error: payload }, payload.status);
  }
}
