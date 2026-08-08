import type {
  BrowserOcrOptions,
  BrowserOcrProgress,
  OcrManifest,
  OcrPageResult,
  RenderedPage,
  VisualCandidate,
} from "./types";
import type Tesseract from "tesseract.js";
import { renderPdfPages, renderPptxSlides } from "./renderers";
import { detectVisualCandidate } from "./visual-detector";

const OCR_LANGUAGES = ["chi_sim", "eng"];
const MAX_VISUAL_CANDIDATES = 6;
const MAX_TEXT_PER_PAGE = 15_000;
const MAX_TOTAL_TEXT_PER_SOURCE = 250_000;
const MAX_MANIFEST_UTF8_BYTES = 2_750_000;
const AUTO_OCR_TEXT_THRESHOLD = 48;
const WORKER_START_TIMEOUT_MS = 60_000;
const PAGE_RECOGNITION_TIMEOUT_MS = 45_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function meaningfulCharacterCount(value: string) {
  return value.replace(/[\s\p{P}\p{S}]+/gu, "").length;
}

function hasMeaningfulNativeText(pages: Array<{ text: string }>) {
  return meaningfulCharacterCount(pages.map((page) => page.text).join("\n")) >= 24;
}

function fileExtension(file: File) {
  return file.name.toLowerCase().split(".").pop() ?? "";
}

export async function runBrowserDocumentAnalysis(
  file: File,
  options: BrowserOcrOptions,
): Promise<OcrManifest> {
  const sourceType = fileExtension(file) === "pptx" ? "pptx" : "pdf";
  if (options.signal.aborted) throw new DOMException("Document analysis was aborted", "AbortError");
  options.onProgress?.({
    phase: "preparing",
    current: 0,
    total: 0,
    message: options.mode === "none"
      ? "正在浏览器中提取逐页原生文字"
      : options.mode === "auto" ? "正在检查文字层和视觉内容" : "正在准备中英文 OCR 引擎",
  });

  let activePage = 0;
  let totalPages = 0;
  let inspectedPageCount = 0;
  const workerState: {
    worker: Tesseract.Worker | null;
    promise: Promise<Tesseract.Worker> | null;
    unavailableError: Error | null;
  } = { worker: null, promise: null, unavailableError: null };
  const pages: OcrPageResult[] = [];
  const nativePages: Array<{ number: number; text: string }> = [];
  const visuals: VisualCandidate[] = [];

  const getWorker = async () => {
    if (workerState.worker) return workerState.worker;
    if (workerState.unavailableError) throw workerState.unavailableError;
    if (!workerState.promise) {
      workerState.promise = (async () => {
        const { createWorker, OEM } = await import("tesseract.js");
        const creation = createWorker(OCR_LANGUAGES, OEM.LSTM_ONLY, {
          workerPath: "/tesseract/worker.min.js",
          corePath: "/tesseract/core",
          langPath: "/tessdata",
          logger: (message) => {
            if (message.status !== "recognizing text") return;
            options.onProgress?.({
              phase: "recognizing",
              current: activePage,
              total: totalPages,
              progress: message.progress,
              message: `正在识别${sourceType === "pptx" ? "幻灯片" : "页面"} ${activePage}/${totalPages}`,
            });
          },
        });
        let created: Tesseract.Worker;
        try {
          created = await withTimeout(
            creation,
            WORKER_START_TIMEOUT_MS,
            "OCR 引擎加载超时，请刷新页面后重试。",
          );
        } catch (error) {
          void creation.then((lateWorker) => lateWorker.terminate()).catch(() => undefined);
          throw new Error(
            error instanceof Error && error.message.includes("超时")
              ? error.message
              : "OCR 引擎资源加载失败，请刷新页面后重试。",
          );
        }
        if (options.signal.aborted) {
          await created.terminate();
          throw new DOMException("Document analysis was aborted", "AbortError");
        }
        workerState.worker = created;
        return created;
      })();
    }
    try {
      return await workerState.promise;
    } catch (error) {
      const unavailableError = error instanceof Error
        ? error
        : new Error("OCR 引擎资源加载失败，请刷新页面后重试。");
      workerState.unavailableError = unavailableError;
      workerState.promise = null;
      throw unavailableError;
    }
  };

  const abortWorker = () => {
    void workerState.worker?.terminate();
  };
  options.signal.addEventListener("abort", abortWorker, { once: true });

  const rememberVisual = (candidate: VisualCandidate | null) => {
    if (!candidate) return;
    visuals.push(candidate);
    visuals.sort((left, right) => right.score - left.score);
    while (visuals.length > MAX_VISUAL_CANDIDATES) visuals.pop();
  };

  const consume = async (rendered: RenderedPage, current: number, total: number) => {
    activePage = current;
    totalPages = total;
    inspectedPageCount = Math.max(inspectedPageCount, current);
    const kind = sourceType === "pptx" ? "slide" : "page";
    const pageTextLimit = Math.min(
      MAX_TEXT_PER_PAGE,
      Math.max(1, Math.floor(MAX_TOTAL_TEXT_PER_SOURCE / Math.max(1, total))),
    );
    nativePages.push({ number: rendered.number, text: rendered.nativeText.slice(0, pageTextLimit) });
    if (options.mode !== "none") {
      rememberVisual(detectVisualCandidate(
        rendered.canvas,
        { number: rendered.number, kind },
        rendered.nativeTextLength,
      ));
    }

    const shouldRecognize = options.mode === "force" || (options.mode === "auto" && rendered.nativeTextLength < AUTO_OCR_TEXT_THRESHOLD);
    if (!shouldRecognize) {
      return;
    }

    const startedAt = performance.now();
    try {
      if (options.signal.aborted) throw new DOMException("Document analysis was aborted", "AbortError");
      const activeWorker = await getWorker();
      const result = await withTimeout(
        activeWorker.recognize(rendered.canvas, { rotateAuto: true }),
        PAGE_RECOGNITION_TIMEOUT_MS,
        `第 ${rendered.number} ${kind === "slide" ? "张幻灯片" : "页"} OCR 超时。`,
      );
      pages.push({
        number: rendered.number,
        text: result.data.text.trim().slice(0, pageTextLimit),
        confidence: Number(result.data.confidence) || 0,
        durationMs: Math.round(performance.now() - startedAt),
        status: "success",
      });
    } catch (error) {
      if (options.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
      if (error instanceof Error && error.message.includes("OCR 超时")) {
        workerState.unavailableError = new Error("OCR 识别超时，已停止本次 OCR；请刷新页面后重试。");
        await workerState.worker?.terminate().catch(() => undefined);
        workerState.worker = null;
        workerState.promise = null;
      }
      pages.push({
        number: rendered.number,
        text: "",
        confidence: 0,
        durationMs: Math.round(performance.now() - startedAt),
        status: "failed",
      });
    }
  };

  try {
    const onProgress = (progress: BrowserOcrProgress) => options.onProgress?.(progress);
    if (sourceType === "pptx") {
      await renderPptxSlides(file, options.signal, onProgress, consume);
    } else {
      await renderPdfPages(file, options.signal, onProgress, consume);
    }
    if (options.mode === "force" && (pages.length === 0 || pages.every((page) => page.status === "failed"))) {
      throw workerState.unavailableError ?? new Error("浏览器未能识别任何页面，请刷新页面或更换文件后重试。");
    }
    if (options.mode === "force") {
      const failedNumbers = pages.filter((page) => page.status === "failed").map((page) => page.number);
      const excessiveFailures = failedNumbers.length > 0 && (
        pages.length <= 10 || failedNumbers.length / Math.max(1, pages.length) > 0.1
      );
      if (excessiveFailures) {
        throw new Error(`全页 OCR 未完整完成（失败页：${failedNumbers.slice(0, 12).join("、")}），请重试。`);
      }
    }
    if (
      options.mode === "auto" &&
      pages.length > 0 &&
      pages.every((page) => page.status === "failed") &&
      !hasMeaningfulNativeText(nativePages)
    ) {
      throw workerState.unavailableError ?? new Error("课件没有可用文字层，并且 OCR 未能识别内容，请刷新后重试。");
    }
    const manifest: OcrManifest = {
      version: 4,
      mode: options.mode,
      engine: "tesseract.js",
      sourceType,
      languages: OCR_LANGUAGES,
      pages: pages.sort((left, right) => left.number - right.number),
      nativePages: nativePages.sort((left, right) => left.number - right.number),
      inspectedPageCount,
      visuals: [...visuals].sort((left, right) => right.score - left.score),
    };
    const encoder = new TextEncoder();
    while (
      manifest.visuals.length > 0 &&
      encoder.encode(JSON.stringify(manifest)).byteLength > MAX_MANIFEST_UTF8_BYTES
    ) {
      manifest.visuals.pop();
    }
    if (encoder.encode(JSON.stringify(manifest)).byteLength > MAX_MANIFEST_UTF8_BYTES) {
      throw new Error("课件逐页文字超过浏览器上传上限，请拆分课件后重试。");
    }
    manifest.visuals.sort((left, right) => left.number - right.number);
    return manifest;
  } finally {
    options.signal.removeEventListener("abort", abortWorker);
    if (workerState.promise) {
      const activeWorker = await workerState.promise.catch(() => null);
      await activeWorker?.terminate().catch(() => undefined);
    }
  }
}

/** Backwards-compatible alias used by older integrations. */
export const runBrowserOcr = runBrowserDocumentAnalysis;
