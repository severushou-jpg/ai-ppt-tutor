import { DocumentProcessingError } from "./document-parser.js";
import { DOCUMENT_INDEX_VERSION, DOCUMENT_LIMITS } from "./rag.js";

export const DOCUMENT_CHECKPOINT_MAX_BYTES = 8 * 1024 * 1024;

export function parseDocumentCheckpoint(value, stage) {
  if (value == null) return null;
  if (typeof value !== "string" || value.length > DOCUMENT_CHECKPOINT_MAX_BYTES) {
    throw new DocumentProcessingError("INVALID_CHECKPOINT", "保存的处理阶段过大或格式无效，请重新解析课件。", 400);
  }
  if (!["parsed", "vision"].includes(stage)) {
    throw new DocumentProcessingError("INVALID_CHECKPOINT", "保存的处理阶段无法识别，请重新解析课件。", 400);
  }
  let document;
  try {
    document = JSON.parse(value);
  } catch {
    throw new DocumentProcessingError("INVALID_CHECKPOINT", "保存的处理阶段已损坏，请重新解析课件。", 400);
  }
  if (
    !document || document.indexVersion !== DOCUMENT_INDEX_VERSION ||
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
