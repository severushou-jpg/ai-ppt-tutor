import type { BrowserOcrProgress, RenderedPage } from "./types";

type PageConsumer = (page: RenderedPage, current: number, total: number) => Promise<void>;

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("OCR processing was aborted", "AbortError");
}

function emitRenderingProgress(
  onProgress: ((progress: BrowserOcrProgress) => void) | undefined,
  current: number,
  total: number,
  label: string,
) {
  onProgress?.({
    phase: "rendering",
    current,
    total,
    message: `正在渲染${label} ${current}/${total}`,
  });
}

export async function renderPdfPages(
  file: File,
  signal: AbortSignal,
  onProgress: ((progress: BrowserOcrProgress) => void) | undefined,
  consume: PageConsumer,
) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const abortLoading = () => loadingTask.destroy();
  signal.addEventListener("abort", abortLoading, { once: true });
  const pdf = await loadingTask.promise;
  try {
    if (pdf.numPages > 120) throw new Error("全页 OCR 最多支持 120 页，请拆分课件后重试。");
    for (let index = 0; index < pdf.numPages; index += 1) {
      throwIfAborted(signal);
      const number = index + 1;
      emitRenderingProgress(onProgress, number, pdf.numPages, "页面");
      const page = await pdf.getPage(number);
      const textContent = await page.getTextContent();
      const nativeTextLength = textContent.items.reduce(
        (sum, item) => sum + ("str" in item ? String(item.str).trim().length : 0),
        0,
      );
      const baseViewport = page.getViewport({ scale: 1 });
      const maximumPixels = 8_000_000;
      const preferredScale = 2;
      const scale = Math.min(
        preferredScale,
        Math.sqrt(maximumPixels / Math.max(1, baseViewport.width * baseViewport.height)),
      );
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("浏览器无法创建 PDF 渲染画布。");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      try {
        await consume({
          number,
          canvas,
          nativeTextLength,
          release: () => {
            canvas.width = 1;
            canvas.height = 1;
            page.cleanup();
          },
        }, number, pdf.numPages);
      } finally {
        canvas.width = 1;
        canvas.height = 1;
        page.cleanup();
      }
    }
  } finally {
    signal.removeEventListener("abort", abortLoading);
    await pdf.destroy();
  }
}

export async function renderPptxSlides(
  file: File,
  signal: AbortSignal,
  onProgress: ((progress: BrowserOcrProgress) => void) | undefined,
  consume: PageConsumer,
) {
  const [{ PptxViewer, RECOMMENDED_ZIP_LIMITS }, html2canvasModule] = await Promise.all([
    import("@aiden0z/pptx-renderer"),
    import("html2canvas"),
  ]);
  throwIfAborted(signal);
  const html2canvas = html2canvasModule.default;
  const staging = document.createElement("div");
  staging.setAttribute("aria-hidden", "true");
  Object.assign(staging.style, {
    position: "fixed",
    left: "-100000px",
    top: "0",
    pointerEvents: "none",
    zIndex: "-1",
  });
  document.body.appendChild(staging);
  const viewer = await PptxViewer.open(await file.arrayBuffer(), staging, {
    renderMode: "slide",
    fitMode: "none",
    zipLimits: RECOMMENDED_ZIP_LIMITS,
    lazyMedia: false,
    lazySlides: false,
    pdfjs: false,
    signal,
  });
  try {
    const total = viewer.slideCount;
    if (total < 1) throw new Error("PPTX 中没有可渲染的幻灯片。");
    if (total > 120) throw new Error("全页 OCR 最多支持 120 张幻灯片，请拆分课件后重试。");
    for (let index = 0; index < total; index += 1) {
      throwIfAborted(signal);
      const number = index + 1;
      emitRenderingProgress(onProgress, number, total, "幻灯片");
      const host = document.createElement("div");
      staging.appendChild(host);
      const handle = viewer.renderSlideToContainer(index, host, 1);
      if (!handle) {
        host.remove();
        throw new Error(`无法渲染第 ${number} 张幻灯片。`);
      }
      try {
        await handle.ready;
        await document.fonts?.ready;
        throwIfAborted(signal);
        const nativeTextLength = (handle.element.textContent ?? "").replace(/\s+/g, " ").trim().length;
        const canvas = await html2canvas(handle.element, {
          backgroundColor: "#ffffff",
          logging: false,
          scale: 2,
          useCORS: true,
          width: viewer.slideWidth,
          height: viewer.slideHeight,
        });
        try {
          await consume({
            number,
            canvas,
            nativeTextLength,
            release: () => {
              canvas.width = 1;
              canvas.height = 1;
            },
          }, number, total);
        } finally {
          canvas.width = 1;
          canvas.height = 1;
        }
      } finally {
        handle.dispose();
        host.remove();
      }
    }
  } finally {
    viewer.destroy();
    staging.remove();
  }
}
