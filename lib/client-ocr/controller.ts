import type {
  BrowserOcrOptions,
  BrowserOcrProgress,
  OcrManifest,
  OcrPageResult,
} from "./types";
import { renderPdfPages, renderPptxSlides } from "./renderers";

const OCR_LANGUAGES = ["chi_sim", "eng"];

function fileExtension(file: File) {
  return file.name.toLowerCase().split(".").pop() ?? "";
}

export async function runBrowserOcr(file: File, options: BrowserOcrOptions): Promise<OcrManifest> {
  const sourceType = fileExtension(file) === "pptx" ? "pptx" : "pdf";
  if (options.signal.aborted) throw new DOMException("OCR processing was aborted", "AbortError");
  options.onProgress?.({
    phase: "preparing",
    current: 0,
    total: 0,
    message: "正在加载中英文 OCR 引擎",
  });
  const { createWorker, OEM } = await import("tesseract.js");
  if (options.signal.aborted) throw new DOMException("OCR processing was aborted", "AbortError");
  let activePage = 0;
  let totalPages = 0;
  const workerPromise = createWorker(OCR_LANGUAGES, OEM.LSTM_ONLY, {
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
  const worker = await new Promise<Awaited<typeof workerPromise>>((resolve, reject) => {
    const abortInitialization = () => {
      void workerPromise.then((createdWorker) => createdWorker.terminate()).catch(() => undefined);
      reject(new DOMException("OCR processing was aborted", "AbortError"));
    };
    options.signal.addEventListener("abort", abortInitialization, { once: true });
    void workerPromise.then(
      (createdWorker) => {
        options.signal.removeEventListener("abort", abortInitialization);
        if (options.signal.aborted) {
          void createdWorker.terminate();
          reject(new DOMException("OCR processing was aborted", "AbortError"));
          return;
        }
        resolve(createdWorker);
      },
      (error) => {
        options.signal.removeEventListener("abort", abortInitialization);
        reject(error);
      },
    );
  });
  const abortWorker = () => {
    void worker.terminate();
  };
  options.signal.addEventListener("abort", abortWorker, { once: true });
  const pages: OcrPageResult[] = [];
  const consume = async (
    rendered: { number: number; canvas: HTMLCanvasElement; release: () => void },
    current: number,
    total: number,
  ) => {
    activePage = current;
    totalPages = total;
    const startedAt = performance.now();
    try {
      if (options.signal.aborted) throw new DOMException("OCR processing was aborted", "AbortError");
      const result = await worker.recognize(rendered.canvas, { rotateAuto: true });
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
    if (pages.length === 0 || pages.every((page) => page.status === "failed")) {
      throw new Error("浏览器未能识别任何页面，请关闭 OCR 或更换文件后重试。");
    }
    return {
      version: 1,
      mode: "force",
      engine: "tesseract.js",
      sourceType,
      languages: OCR_LANGUAGES,
      pages: pages.sort((left, right) => left.number - right.number),
    };
  } finally {
    options.signal.removeEventListener("abort", abortWorker);
    await worker.terminate().catch(() => undefined);
  }
}
