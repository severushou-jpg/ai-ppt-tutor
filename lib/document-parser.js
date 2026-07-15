import crypto from "node:crypto";
import { parseOffice } from "officeparser";
import {
  buildDocumentIndex,
  containsMeaningfulText,
  DOCUMENT_LIMITS,
} from "./rag.js";

const SUPPORTED_EXTENSIONS = new Set(["pdf", "pptx"]);
const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/octet-stream",
  "",
]);

export class DocumentProcessingError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.name = "DocumentProcessingError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function getExtension(fileName) {
  return fileName.toLowerCase().split(".").pop() ?? "";
}

function validateMagicBytes(buffer, extension) {
  if (extension === "pdf") return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  if (extension === "pptx") return buffer[0] === 0x50 && buffer[1] === 0x4b;
  return false;
}

export function validateDocumentFile(file) {
  if (!(file instanceof File) || file.size === 0) {
    throw new DocumentProcessingError("FILE_REQUIRED", "请选择一个 PDF 或 PPTX 文件。", 400);
  }

  const extension = getExtension(file.name);
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new DocumentProcessingError(
      "UNSUPPORTED_FORMAT",
      "暂不支持该格式，请上传 PDF 或 PPTX 文件。",
      415,
    );
  }

  if (!SUPPORTED_MIME_TYPES.has(file.type)) {
    throw new DocumentProcessingError(
      "MIME_TYPE_MISMATCH",
      "文件类型与扩展名不一致，请重新导出后上传。",
      415,
    );
  }

  if (file.size > DOCUMENT_LIMITS.maxFileBytes) {
    throw new DocumentProcessingError(
      "FILE_TOO_LARGE",
      `文件超过 ${DOCUMENT_LIMITS.maxFileBytes / 1024 / 1024}MB 限制。`,
      413,
    );
  }

  return extension;
}

async function withTimeout(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new DocumentProcessingError(
              "PARSE_TIMEOUT",
              "课件解析超时，可能是文件较大或结构过于复杂。",
              408,
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function parseDocument(file) {
  const extension = validateDocumentFile(file);
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!validateMagicBytes(buffer, extension)) {
    throw new DocumentProcessingError(
      "INVALID_FILE_SIGNATURE",
      "文件内容与扩展名不匹配，可能已损坏或被错误重命名。",
      415,
    );
  }

  let ast;
  try {
    ast = await withTimeout(
      parseOffice(buffer, {
        extractAttachments: false,
        ignoreNotes: false,
        includeRawContent: false,
        ocr: false,
        outputErrorToConsole: false,
      }),
      30_000,
    );
  } catch (error) {
    if (error instanceof DocumentProcessingError) throw error;
    console.error("Office parser failed", {
      name: error?.name,
      message: error?.message,
    });
    throw new DocumentProcessingError(
      "PARSE_FAILED",
      "无法读取课件内容，请确认文件未加密且可以正常打开。",
      422,
    );
  }

  const index = buildDocumentIndex(ast, { name: file.name });
  const combinedText = index.sections.map((section) => section.text).join("\n");
  if (!containsMeaningfulText(combinedText) || index.chunks.length === 0) {
    throw new DocumentProcessingError(
      "NO_TEXT_LAYER",
      "没有识别到足够的文字。该文件可能是扫描图片或仅包含图片。",
      422,
      { canRetry: true },
    );
  }

  return {
    id: crypto.randomUUID(),
    name: file.name,
    extension,
    size: file.size,
    sectionCount: index.sections.length,
    chunkCount: index.chunks.length,
    characterCount: index.characterCount,
    truncated: index.truncated,
    chunks: index.chunks,
  };
}
