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
import { OCR_LIMITS, parseOcrManifest } from "@/lib/ocr.js";
import { analyzeVisualCandidates } from "@/lib/visual-analysis.js";
import {
  DOCUMENT_CHECKPOINT_MAX_BYTES,
  parseDocumentCheckpoint,
} from "@/lib/document-checkpoint.js";

export const runtime = "nodejs";
export const maxDuration = 120;

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

async function processDocument(file, onProgress, onCheckpoint, signal, ocrMode, ocrManifest, checkpoint) {
  const document = checkpoint?.document ?? await parseDocument(file, { onProgress, ocrMode, ocrManifest });
  if (!checkpoint) onCheckpoint?.("parsed", document);
  const apiKey = process.env.DASHSCOPE_API_KEY;
  let enrichedDocument = document;
  if (checkpoint?.stage !== "vision") {
    const parsedManifest = parseOcrManifest(ocrManifest, ocrMode);
    const vision = await analyzeVisualCandidates(parsedManifest, apiKey, {
      signal,
      fileName: document.name,
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

function streamDocument(file, signal, ocrMode, ocrManifest, checkpoint) {
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
              file,
              (progress) => send({ type: "progress", ...progress }),
              (stage, document) => send({ type: "checkpoint", stage, document }),
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
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  const requestLimit = DOCUMENT_LIMITS.maxFileBytes + OCR_LIMITS.maxManifestBytes + DOCUMENT_CHECKPOINT_MAX_BYTES + 1024 * 1024;
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
    const requestedOcrMode = formData.get("ocrMode");
    const ocrMode = ["auto", "force"].includes(requestedOcrMode) ? requestedOcrMode : "none";
    const ocrManifest = formData.get("ocrManifest");
    const checkpoint = parseDocumentCheckpoint(formData.get("documentCheckpoint"), formData.get("checkpointStage"));
    if (request.headers.get("accept")?.includes("application/x-ndjson")) {
      return streamDocument(file, request.signal, ocrMode, ocrManifest, checkpoint);
    }
    const document = await processDocument(file, undefined, undefined, request.signal, ocrMode, ocrManifest, checkpoint);
    return jsonResponse({ document });
  } catch (error) {
    const payload = errorPayload(error);
    return jsonResponse({ error: payload }, payload.status);
  }
}
