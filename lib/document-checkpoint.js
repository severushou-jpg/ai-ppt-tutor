import { createHmac, timingSafeEqual } from "node:crypto";
import { DocumentProcessingError } from "./document-parser.js";
import { DOCUMENT_INDEX_VERSION, DOCUMENT_LIMITS } from "./rag.js";

export const DOCUMENT_CHECKPOINT_MAX_BYTES = 3 * 1024 * 1024;

function configuredCheckpointSecret() {
  return process.env.CHECKPOINT_SIGNING_SECRET?.trim() || "";
}

export function signDocumentCheckpoint(value, stage, secret = configuredCheckpointSecret()) {
  if (
    typeof value !== "string" || value.length === 0 ||
    Buffer.byteLength(value, "utf8") > DOCUMENT_CHECKPOINT_MAX_BYTES ||
    !["parsed", "vision"].includes(stage) || !secret
  ) return null;
  return createHmac("sha256", secret).update(stage).update("\0").update(value).digest("hex");
}

function validCheckpointSignature(value, stage, signature, secret) {
  if (typeof signature !== "string" || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = signDocumentCheckpoint(value, stage, secret);
  if (!expected) return false;
  const suppliedBytes = Buffer.from(signature, "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
}

export function parseDocumentCheckpoint(
  value,
  stage,
  signature,
  secret = configuredCheckpointSecret(),
) {
  if (value == null) return null;
  if (!["parsed", "vision"].includes(stage)) {
    throw new DocumentProcessingError("INVALID_CHECKPOINT", "保存的处理阶段无法识别，请重新解析课件。", 400);
  }
  if (
    typeof value !== "string" || Buffer.byteLength(value, "utf8") > DOCUMENT_CHECKPOINT_MAX_BYTES ||
    !validCheckpointSignature(value, stage, signature, secret)
  ) {
    throw new DocumentProcessingError("INVALID_CHECKPOINT", "保存的处理阶段过大或格式无效，请重新解析课件。", 400);
  }
  let document;
  try {
    document = JSON.parse(value);
  } catch {
    throw new DocumentProcessingError("INVALID_CHECKPOINT", "保存的处理阶段已损坏，请重新解析课件。", 400);
  }
  const totalPageCount = Number(document?.ocr?.totalPageCount);
  const successfulPageCount = Number(document?.ocr?.successfulPageCount);
  const failedPageCount = Number(document?.ocr?.failedPageCount);
  const inspectedPageCount = Number(document?.ocr?.inspectedPageCount);
  const hasCompleteOcrSummary =
    Number.isInteger(totalPageCount) && totalPageCount >= 1 && totalPageCount <= DOCUMENT_LIMITS.maxSections &&
    Number.isInteger(successfulPageCount) && successfulPageCount >= 0 &&
    Number.isInteger(failedPageCount) && failedPageCount >= 0 &&
    successfulPageCount + failedPageCount === totalPageCount &&
    inspectedPageCount === totalPageCount;
  if (
    !document || document.indexVersion !== DOCUMENT_INDEX_VERSION ||
    document.ocr?.mode !== "force" ||
    !hasCompleteOcrSummary ||
    typeof document.id !== "string" || typeof document.name !== "string" ||
    !Array.isArray(document.chunks) || document.chunks.length > DOCUMENT_LIMITS.maxChunks + 16 ||
    document.chunks.some((chunk) =>
      !chunk || typeof chunk.id !== "string" || typeof chunk.text !== "string" || chunk.text.length > 20_000 ||
      !Number.isInteger(chunk.number) || chunk.number < 1 || chunk.number > DOCUMENT_LIMITS.maxSections,
    )
  ) {
    throw new DocumentProcessingError("INVALID_CHECKPOINT", "保存的课件处理阶段未通过安全校验，请重新解析。", 400);
  }
  return { stage, document };
}
