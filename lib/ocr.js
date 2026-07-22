const OCR_MODES = new Set(["none", "auto", "force"]);

export const OCR_LIMITS = Object.freeze({
  maxPages: 120,
  maxTextPerPage: 15_000,
  maxTotalText: 250_000,
  maxManifestBytes: 8 * 1024 * 1024,
  maxVisuals: 8,
  maxVisualDataUrl: 450_000,
});

export class OcrManifestError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OcrManifestError";
    this.code = code;
  }
}

export function normalizeOcrText(value) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizedComparableLine(value) {
  return normalizeOcrText(value)
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function mergeNativeAndOcrText(nativeText, ocrText) {
  const native = normalizeOcrText(nativeText);
  const ocr = normalizeOcrText(ocrText);
  if (!ocr) return { text: native, textOrigin: native ? "native" : "ocr" };
  if (!native) return { text: ocr, textOrigin: "ocr" };

  const nativeComparable = normalizedComparableLine(native);
  const ocrComparable = normalizedComparableLine(ocr);
  if (
    nativeComparable === ocrComparable ||
    nativeComparable.includes(ocrComparable)
  ) {
    return { text: native, textOrigin: "native" };
  }

  const knownLines = new Set(
    native.split("\n").map(normalizedComparableLine).filter((line) => line.length >= 4),
  );
  const additions = ocr
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const comparable = normalizedComparableLine(line);
      if (!comparable || knownLines.has(comparable)) return false;
      if ([...knownLines].some((known) =>
        comparable.length >= 8 && (known.includes(comparable) || comparable.includes(known)))) return false;
      knownLines.add(comparable);
      return true;
    });

  return additions.length > 0
    ? { text: `${native}\n\n${additions.join("\n")}`, textOrigin: "mixed" }
    : { text: native, textOrigin: "native" };
}

export function parseOcrManifest(rawValue, requestedMode = "none") {
  const mode = OCR_MODES.has(requestedMode) ? requestedMode : "none";
  if (mode === "none") return null;

  let raw = rawValue;
  if (typeof rawValue === "string") {
    if (Buffer.byteLength(rawValue, "utf8") > OCR_LIMITS.maxManifestBytes) {
      throw new OcrManifestError("OCR_MANIFEST_TOO_LARGE", "OCR 识别结果过大，请缩短课件后重试。");
    }
    try {
      raw = JSON.parse(rawValue);
    } catch {
      throw new OcrManifestError("INVALID_OCR_MANIFEST", "OCR 识别结果格式无效，请重新处理课件。");
    }
  }

  if (
    !raw ||
    typeof raw !== "object" ||
    !["auto", "force"].includes(raw.mode) ||
    !Array.isArray(raw.pages)
  ) {
    throw new OcrManifestError("OCR_MANIFEST_REQUIRED", "文档分析未返回有效的页面识别结果。");
  }
  if (raw.mode !== mode) {
    throw new OcrManifestError("OCR_MODE_MISMATCH", "OCR 模式与页面分析结果不一致，请重新处理课件。");
  }
  if (raw.pages.length > OCR_LIMITS.maxPages || (raw.mode === "force" && raw.pages.length === 0)) {
    throw new OcrManifestError("INVALID_OCR_PAGE_COUNT", `OCR 页面数量必须在 0-${OCR_LIMITS.maxPages} 之间。`);
  }

  const seen = new Set();
  let totalText = 0;
  const pages = raw.pages.map((page) => {
    const number = Number(page?.number);
    if (!Number.isInteger(number) || number < 1 || number > OCR_LIMITS.maxPages || seen.has(number)) {
      throw new OcrManifestError("INVALID_OCR_PAGE", "OCR 结果包含无效或重复的页码。");
    }
    seen.add(number);
    const text = normalizeOcrText(page?.text).slice(0, OCR_LIMITS.maxTextPerPage);
    totalText += text.length;
    if (totalText > OCR_LIMITS.maxTotalText) {
      throw new OcrManifestError("OCR_TEXT_TOO_LARGE", "OCR 识别文字超过安全上限，请缩短课件后重试。");
    }
    const confidence = Number(page?.confidence);
    const durationMs = Number(page?.durationMs);
    return {
      number,
      text,
      confidence: Number.isFinite(confidence) ? Math.min(100, Math.max(0, confidence)) : 0,
      durationMs: Number.isFinite(durationMs) ? Math.min(300_000, Math.max(0, durationMs)) : 0,
      status: page?.status === "failed" ? "failed" : "success",
    };
  });

  const visuals = Array.isArray(raw.visuals) ? raw.visuals.slice(0, OCR_LIMITS.maxVisuals).map((visual) => {
    const number = Number(visual?.number);
    const imageDataUrl = String(visual?.imageDataUrl ?? "");
    const crop = visual?.crop ?? {};
    if (
      !Number.isInteger(number) || number < 1 || number > OCR_LIMITS.maxPages ||
      !/^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(imageDataUrl) ||
      imageDataUrl.length > OCR_LIMITS.maxVisualDataUrl
    ) {
      throw new OcrManifestError("INVALID_VISUAL_CANDIDATE", "图表裁剪结果无效，请重新处理课件。");
    }
    const safeCoordinate = (value) => Math.max(0, Math.min(20_000, Math.round(Number(value) || 0)));
    return {
      id: String(visual?.id ?? `visual-${number}`).replace(/[^a-z0-9_-]/gi, "").slice(0, 80),
      number,
      kind: visual?.kind === "slide" ? "slide" : "page",
      imageDataUrl,
      crop: {
        x: safeCoordinate(crop.x),
        y: safeCoordinate(crop.y),
        width: Math.max(1, safeCoordinate(crop.width)),
        height: Math.max(1, safeCoordinate(crop.height)),
      },
      score: Math.max(0, Math.min(1, Number(visual?.score) || 0)),
      nativeTextLength: Math.max(0, Math.min(50_000, Number(visual?.nativeTextLength) || 0)),
    };
  }) : [];

  return {
    version: 2,
    mode: raw.mode,
    engine: "tesseract.js",
    sourceType: raw.sourceType === "pptx" ? "pptx" : "pdf",
    languages: Array.isArray(raw.languages)
      ? raw.languages.map(String).filter(Boolean).slice(0, 4)
      : ["chi_sim", "eng"],
    pages: pages.sort((left, right) => left.number - right.number),
    inspectedPageCount: Math.max(
      pages.length,
      Math.min(OCR_LIMITS.maxPages, Number(raw.inspectedPageCount) || 0),
    ),
    visuals,
  };
}

export function applyOcrManifest(ast, manifest) {
  if (!manifest) {
    return {
      ast,
      summary: {
        mode: "none",
        totalPageCount: 0,
        successfulPageCount: 0,
        failedPageCount: 0,
      },
    };
  }

  const pageResults = new Map(manifest.pages.map((page) => [page.number, page]));
  const content = Array.isArray(ast?.content) ? ast.content : [];
  const expectedType = manifest.sourceType === "pptx" ? "slide" : "page";
  const matched = new Set();
  const nextContent = content.map((node, index) => {
    if (node?.type !== expectedType) return node;
    const number = Number(
      expectedType === "slide" ? node.metadata?.slideNumber : node.metadata?.pageNumber,
    ) || index + 1;
    const result = pageResults.get(number);
    if (!result) return node;
    matched.add(number);
    const acceptedOcrText = manifest.mode === "auto" && result.confidence < 35 ? "" : result.text;
    const merged = mergeNativeAndOcrText(node.text, acceptedOcrText);
    return {
      ...node,
      text: merged.text,
      metadata: {
        ...node.metadata,
        textOrigin: merged.textOrigin,
        ocrConfidence: result.confidence,
      },
    };
  });

  if (matched.size !== pageResults.size) {
    throw new OcrManifestError("OCR_PAGE_MISMATCH", "OCR 页码与课件结构不一致，请重新处理文件。");
  }

  const successful = manifest.pages.filter((page) => page.status === "success");
  const averageConfidence = successful.length > 0
    ? successful.reduce((sum, page) => sum + page.confidence, 0) / successful.length
    : undefined;
  const nextAst = {
    ...ast,
    content: nextContent,
    toText: () => nextContent.map((node) => node?.text ?? "").join("\n"),
  };
  return {
    ast: nextAst,
    summary: {
      mode: manifest.mode,
      engine: manifest.engine,
      totalPageCount: manifest.inspectedPageCount || manifest.pages.length,
      successfulPageCount: successful.length,
      failedPageCount: manifest.pages.length - successful.length,
      averageConfidence: averageConfidence == null ? undefined : Number(averageConfidence.toFixed(1)),
      durationMs: manifest.pages.reduce((sum, page) => sum + page.durationMs, 0),
      inspectedPageCount: manifest.inspectedPageCount,
      automaticallySelectedPageCount: manifest.mode === "auto" ? manifest.pages.length : undefined,
      failedPageNumbers: manifest.pages.filter((page) => page.status === "failed").map((page) => page.number),
    },
  };
}
