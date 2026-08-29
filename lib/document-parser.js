import crypto from "node:crypto";
import {
  buildDocumentIndex,
  containsMeaningfulText,
  DOCUMENT_INDEX_VERSION,
  DOCUMENT_LIMITS,
} from "./rag.js";
import {
  applyOcrManifest,
  OcrManifestError,
  parseOcrManifest,
} from "./ocr.js";

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

function textItemsToLines(items) {
  const lines = new Map();
  for (const item of items) {
    const text = normalizeTextItem(item?.str);
    if (!text) continue;
    const x = Number(item?.transform?.[4]) || 0;
    const y = Number(item?.transform?.[5]) || 0;
    const key = Math.round(y / 3) * 3;
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key).push({ x, text });
  }
  return [...lines.entries()]
    .sort(([leftY], [rightY]) => rightY - leftY)
    .map(([, line]) => line.sort((left, right) => left.x - right.x).map((item) => item.text).join(" "))
    .join("\n");
}

function normalizeTextItem(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

async function parsePdf(buffer, onProgress) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    enableScripting: false,
    isEvalSupported: false,
  });
  const pdf = await loadingTask.promise;
  const content = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      content.push({
        type: "page",
        metadata: { pageNumber },
        text: textItemsToLines(textContent.items),
      });
      onProgress?.({
        phase: "parsing",
        current: pageNumber,
        total: pdf.numPages,
        message: `正在解析第 ${pageNumber}/${pdf.numPages} 页`,
      });
      page.cleanup();
    }
  } finally {
    await pdf.destroy();
  }
  return { content, toText: () => content.map((page) => page.text).join("\n") };
}

export async function parseDocument(file, options = {}) {
  const extension = validateDocumentFile(file);
  let ocrManifest;
  try {
    ocrManifest = parseOcrManifest(options.ocrManifest, options.ocrMode);
    if (ocrManifest && ocrManifest.sourceType !== extension) {
      throw new OcrManifestError("OCR_SOURCE_MISMATCH", "OCR 识别结果与上传文件类型不一致。");
    }
  } catch (error) {
    if (error instanceof OcrManifestError) {
      throw new DocumentProcessingError(error.code, error.message, 400);
    }
    throw error;
  }
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
    options.onProgress?.({ phase: "parsing", current: 0, total: null, message: "正在读取课件结构" });
    if (extension !== "pdf") {
      throw new DocumentProcessingError(
        "CLIENT_EXTRACTION_REQUIRED",
        "PPTX 必须先在浏览器中完成逐页提取和全页 OCR，请刷新页面后重试。",
        422,
        { canRetry: true },
      );
    }
    ast = await withTimeout(parsePdf(buffer, options.onProgress), 45_000);
  } catch (error) {
    if (error instanceof DocumentProcessingError) throw error;
    console.error("Document parser failed", {
      name: error?.name,
      message: error?.message,
    });
    throw new DocumentProcessingError(
      "PARSE_FAILED",
      "无法读取课件内容，请确认文件未加密且可以正常打开。",
      422,
    );
  }

  let ocrResult;
  try {
    ocrResult = applyOcrManifest(ast, ocrManifest);
  } catch (error) {
    if (error instanceof OcrManifestError) {
      throw new DocumentProcessingError(error.code, error.message, 400);
    }
    throw error;
  }
  const index = buildDocumentIndex(ocrResult.ast, { name: file.name }, {
    onProgress: ({ current, total }) => options.onProgress?.({
      phase: "indexing",
      current,
      total,
      message: `正在建立索引 ${current}/${total}`,
    }),
  });
  const combinedText = index.sections.map((section) => section.text).join("\n");
  if ((!containsMeaningfulText(combinedText) || index.chunks.length === 0) && !ocrManifest?.visuals?.length) {
    throw new DocumentProcessingError(
      "NO_TEXT_LAYER",
      "没有识别到足够的文字。该文件可能是扫描图片或仅包含图片。",
      422,
      { canRetry: true },
    );
  }

  return {
    id: crypto.randomUUID(),
    indexVersion: DOCUMENT_INDEX_VERSION,
    name: file.name,
    extension,
    size: file.size,
    sectionCount: index.sections.length,
    chunkCount: index.chunks.length,
    characterCount: index.characterCount,
    truncated: index.truncated,
    chunks: index.chunks,
    ocr: ocrResult.summary,
  };
}

export async function parseClientDocument(metadata, options = {}) {
  const name = String(metadata?.name ?? "").trim().slice(0, 180);
  const extension = getExtension(name);
  const size = Number(metadata?.size);
  if (!SUPPORTED_EXTENSIONS.has(extension) || !Number.isFinite(size) || size <= 0 || size > DOCUMENT_LIMITS.maxFileBytes) {
    throw new DocumentProcessingError("INVALID_CLIENT_DOCUMENT", "浏览器提取的课件元数据无效，请重新选择文件。", 400);
  }
  let manifest;
  try {
    manifest = parseOcrManifest(options.ocrManifest, options.ocrMode);
  } catch (error) {
    if (error instanceof OcrManifestError) throw new DocumentProcessingError(error.code, error.message, 400);
    throw error;
  }
  if (!manifest || manifest.sourceType !== extension || manifest.nativePages.length === 0) {
    throw new DocumentProcessingError("CLIENT_TEXT_REQUIRED", "浏览器未返回完整的逐页文字，请重新处理课件。", 422, { canRetry: true });
  }
  const nodeType = extension === "pptx" ? "slide" : "page";
  const ast = {
    content: manifest.nativePages.map((page) => ({
      type: nodeType,
      metadata: nodeType === "slide" ? { slideNumber: page.number } : { pageNumber: page.number },
      text: page.text,
    })),
  };
  const ocrResult = applyOcrManifest(ast, manifest);
  const index = buildDocumentIndex(ocrResult.ast, { name }, {
    onProgress: ({ current, total }) => options.onProgress?.({
      phase: "indexing", current, total, message: `正在建立索引 ${current}/${total}`,
    }),
  });
  const combinedText = index.sections.map((section) => section.text).join("\n");
  if ((!containsMeaningfulText(combinedText) || index.chunks.length === 0) && !manifest.visuals.length) {
    const message = manifest.mode === "none"
      ? "没有提取到足够的原生文字；请改用“自动 OCR”或“全页 OCR”后重试。"
      : "OCR 没有识别到足够的文字，请确认课件清晰且未损坏后重试。";
    throw new DocumentProcessingError("NO_TEXT_LAYER", message, 422, { canRetry: true });
  }
  return {
    id: crypto.randomUUID(),
    indexVersion: DOCUMENT_INDEX_VERSION,
    name,
    extension,
    size,
    sectionCount: index.sections.length,
    chunkCount: index.chunks.length,
    characterCount: index.characterCount,
    truncated: index.truncated,
    chunks: index.chunks,
    ocr: ocrResult.summary,
  };
}
