import { NextResponse } from "next/server";
import {
  DocumentProcessingError,
  parseClientDocument,
} from "@/lib/document-parser.js";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  embedDocumentChunks,
} from "@/lib/dashscope-retrieval.js";
import { parseOcrManifest } from "@/lib/ocr.js";
import { analyzeVisualCandidates } from "@/lib/visual-analysis.js";
import {
  parseDocumentCheckpoint,
  signDocumentCheckpoint,
} from "@/lib/document-checkpoint.js";
import {
  checkRequestRateLimit,
  rateLimitHeaders,
  verifySameOriginRequest,
} from "@/lib/request-security.js";
import { verifyAppAccess } from "@/lib/app-access.js";

export const runtime = "nodejs";
export const maxDuration = 120;
const MAX_TRANSPORT_BYTES = 4 * 1024 * 1024;
const OCR_MODES = new Set(["none", "auto", "force"]);

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

function errorPayload(error) {
  if (error instanceof DocumentProcessingError) {
    console.warn("Document processing rejected", { code: error.code, status: error.status });
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

async function processDocument(clientMetadata, onProgress, onCheckpoint, signal, ocrMode, ocrManifest, checkpoint) {
  const pipelineDeadlineAt = Date.now() + 100_000;
  if (checkpoint && checkpoint.document?.ocr?.mode !== ocrMode) {
    throw new DocumentProcessingError(
      "OCR_MODE_MISMATCH",
      "OCR 模式与已保存的处理阶段不一致，请重新处理课件。",
      400,
    );
  }
  const document = checkpoint?.document ?? (
    await parseClientDocument(clientMetadata, { onProgress, ocrMode, ocrManifest })
  );
  if (!checkpoint) onCheckpoint?.("parsed", document);
  const apiKey = process.env.DASHSCOPE_API_KEY;
  let enrichedDocument = document;
  if (checkpoint?.stage !== "vision") {
    const parsedManifest = parseOcrManifest(ocrManifest, ocrMode);
    const vision = await analyzeVisualCandidates(parsedManifest, apiKey, {
      signal,
      fileName: document.name,
      deadlineAt: Math.min(pipelineDeadlineAt, Date.now() + 50_000),
      onProgress: ({ current, total, message }) => onProgress?.({
        phase: "vision",
        current,
        total,
        message,
      }),
    });
    const chunksWithVisuals = [...document.chunks, ...vision.chunks];
    enrichedDocument = {
      ...document,
      chunks: chunksWithVisuals,
      chunkCount: chunksWithVisuals.length,
      characterCount: document.characterCount + vision.chunks.reduce((sum, chunk) => sum + chunk.text.length, 0),
      vision: vision.summary,
    };
    onCheckpoint?.("vision", enrichedDocument);
  } else {
    onProgress?.({ phase: "vision", current: 1, total: 1, message: "已恢复视觉分析结果。" });
  }
  if (!apiKey) return { ...enrichedDocument, retrievalMode: "lexical", embeddingDimensions: 0 };

  try {
    const chunks = await embedDocumentChunks(enrichedDocument.chunks, apiKey, {
      signal,
      deadlineAt: pipelineDeadlineAt,
      onProgress: ({ completed, total }) => onProgress?.({
        phase: "embedding",
        current: completed,
        total,
        message: `正在生成语义索引 ${completed}/${total}`,
      }),
    });
    return {
      ...enrichedDocument,
      chunks,
      retrievalMode: "hybrid",
      embeddingModel: EMBEDDING_MODEL,
      embeddingDimensions: EMBEDDING_DIMENSIONS,
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    console.error("Document embedding failed; using lexical retrieval", { message: error?.message });
    return { ...enrichedDocument, retrievalMode: "lexical", embeddingDimensions: 0 };
  }
}

function streamDocument(clientMetadata, signal, ocrMode, ocrManifest, checkpoint) {
  const encoder = new TextEncoder();
  const workController = new AbortController();
  let streamClosed = false;
  const abortWork = () => workController.abort("client-disconnected");
  if (signal?.aborted) abortWork();
  else signal?.addEventListener("abort", abortWork, { once: true });
  return new Response(
    new ReadableStream({
      start(streamController) {
        const send = (event) => {
          if (streamClosed || workController.signal.aborted) return false;
          try {
            streamController.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
            return true;
          } catch {
            streamClosed = true;
            abortWork();
            return false;
          }
        };
        void (async () => {
          try {
            const document = await processDocument(
              clientMetadata,
              (progress) => send({ type: "progress", ...progress }),
              (stage, document) => {
                const checkpointPayload = JSON.stringify(document);
                const checkpointSignature = signDocumentCheckpoint(checkpointPayload, stage);
                if (checkpointSignature) {
                  send({ type: "checkpoint", stage, document, checkpointPayload, checkpointSignature });
                }
              },
              workController.signal,
              ocrMode,
              ocrManifest,
              checkpoint,
            );
            send({ type: "complete", document });
          } catch (error) {
            if (!workController.signal.aborted) {
              const payload = errorPayload(error);
              send({ type: "error", error: payload });
            }
          } finally {
            signal?.removeEventListener("abort", abortWork);
            if (!streamClosed) {
              try {
                streamController.close();
              } catch {
                // The browser may have already closed the response after pausing.
              }
              streamClosed = true;
            }
          }
        })();
      },
      cancel() {
        streamClosed = true;
        signal?.removeEventListener("abort", abortWork);
        abortWork();
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
  const originCheck = verifySameOriginRequest(request);
  if (!originCheck.allowed) {
    return jsonResponse({
      error: {
        code: originCheck.code,
        message: "已阻止跨站上传请求，请从本应用页面重新操作。",
      },
    }, originCheck.status);
  }
  const appAccess = verifyAppAccess(request);
  if (!appAccess.authorized) {
    return jsonResponse({
      error: { code: "APP_ACCESS_REQUIRED", message: "请先输入项目访问密钥。" },
    }, 401);
  }
  const rateLimit = checkRequestRateLimit(request, {
    scope: "documents",
    limit: 8,
    windowMs: 15 * 60 * 1_000,
  });
  if (!rateLimit.allowed) {
    return jsonResponse({
      error: {
        code: "RATE_LIMITED",
        message: "上传处理过于频繁，请稍后再试。",
        details: { canRetry: true },
      },
    }, 429, rateLimitHeaders(rateLimit));
  }

  const contentLengthHeader = request.headers.get("content-length");
  const contentLength = Number(contentLengthHeader);
  const requestLimit = MAX_TRANSPORT_BYTES;
  if (!contentLengthHeader || !Number.isFinite(contentLength) || contentLength <= 0) {
    return jsonResponse(
      {
        error: {
          code: "CONTENT_LENGTH_REQUIRED",
          message: "无法确认上传数据大小，请使用页面中的上传入口后重试。",
          details: { canRetry: true },
        },
      },
      411,
    );
  }
  if (contentLength > requestLimit) {
    return jsonResponse(
      {
        error: {
          code: "REQUEST_TOO_LARGE",
          message: "浏览器提取结果超过线上传输上限，请减少图表数量或拆分课件后重试。原始课件仍可保留 20MB 上限。",
          details: { canRetry: true },
        },
      },
      413,
    );
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) {
    return jsonResponse({
      error: {
        code: "UNSUPPORTED_MEDIA_TYPE",
        message: "上传请求格式无效，请从页面重新选择文件。",
      },
    }, 415);
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (file instanceof File) {
      return jsonResponse(
        {
          error: {
            code: "CLIENT_EXTRACTION_REQUIRED",
            message: "当前上传入口只接收浏览器完成的逐页提取结果，请刷新页面后重试。",
            details: { canRetry: true },
          },
        },
        400,
      );
    }
    const clientMetadata = {
      name: formData.get("fileName"),
      type: formData.get("fileType"),
      size: formData.get("fileSize"),
    };
    const requestedOcrMode = formData.get("ocrMode");
    if (!OCR_MODES.has(requestedOcrMode)) {
      return jsonResponse(
        {
          error: {
            code: "INVALID_OCR_MODE",
            message: "OCR 模式无效，请刷新页面后重新选择。",
            details: { canRetry: true },
          },
        },
        400,
      );
    }
    const ocrMode = requestedOcrMode;
    const ocrManifest = formData.get("ocrManifest");
    const checkpoint = parseDocumentCheckpoint(
      formData.get("documentCheckpoint"),
      formData.get("checkpointStage"),
      formData.get("checkpointSignature"),
    );
    if (request.headers.get("accept")?.includes("application/x-ndjson")) {
      return streamDocument(clientMetadata, request.signal, ocrMode, ocrManifest, checkpoint);
    }
    const document = await processDocument(clientMetadata, undefined, undefined, request.signal, ocrMode, ocrManifest, checkpoint);
    return jsonResponse({ document });
  } catch (error) {
    const payload = errorPayload(error);
    return jsonResponse({ error: payload }, payload.status);
  }
}
