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
const MAX_VISUAL_CANDIDATES = 8;
const AUTO_OCR_TEXT_THRESHOLD = 120;

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
    message: options.mode === "auto" ? "正在检查文字层和视觉内容" : "正在准备中英文 OCR 引擎",
  });

  let activePage = 0;
  let totalPages = 0;
  let inspectedPageCount = 0;
  const workerState: {
    worker: Tesseract.Worker | null;
    promise: Promise<Tesseract.Worker> | null;
  } = { worker: null, promise: null };
  const pages: OcrPageResult[] = [];
  const visuals: VisualCandidate[] = [];

  const getWorker = async () => {
    if (workerState.worker) return workerState.worker;
    if (!workerState.promise) {
      workerState.promise = (async () => {
        const { createWorker, OEM } = await import("tesseract.js");
        const created = await createWorker(OCR_LANGUAGES, OEM.LSTM_ONLY, {
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
        if (options.signal.aborted) {
          await created.terminate();
          throw new DOMException("Document analysis was aborted", "AbortError");
        }
        workerState.worker = created;
        return created;
      })();
    }
    return workerState.promise;
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
    rememberVisual(detectVisualCandidate(
      rendered.canvas,
      { number: rendered.number, kind },
      rendered.nativeTextLength,
    ));

    const shouldRecognize = options.mode === "force" || rendered.nativeTextLength < AUTO_OCR_TEXT_THRESHOLD;
    if (!shouldRecognize) {
      rendered.release();
      return;
    }

    const startedAt = performance.now();
    try {
      if (options.signal.aborted) throw new DOMException("Document analysis was aborted", "AbortError");
      const activeWorker = await getWorker();
      const result = await activeWorker.recognize(rendered.canvas, { rotateAuto: true });
      pages.push({
        number: rendered.number,
        text: result.data.text.trim(),
        confidence: Number(result.data.confidence) || 0,
        durationMs: Math.round(performance.now() - startedAt),
        status: "success",
      });
    } catch (error) {
      if (options.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
      pages.push({
        number: rendered.number,
        text: "",
        confidence: 0,
        durationMs: Math.round(performance.now() - startedAt),
        status: "failed",
      });
    } finally {
      rendered.release();
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
      throw new Error("浏览器未能识别任何页面，请改用自动模式或更换文件后重试。");
    }
    return {
      version: 2,
      mode: options.mode,
      engine: "tesseract.js",
      sourceType,
      languages: OCR_LANGUAGES,
      pages: pages.sort((left, right) => left.number - right.number),
      inspectedPageCount,
      visuals: visuals.sort((left, right) => left.number - right.number),
    };
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
