import type { BrowserOcrProgress, RenderedPage } from "./types";

type PageConsumer = (page: RenderedPage, current: number, total: number) => Promise<void>;
const MAX_RENDER_PIXELS = 8_000_000;
const MAX_RENDER_EDGE = 4_096;
const MAX_SOURCE_EDGE = 20_000;
const SAFE_PPTX_ZIP_LIMITS = Object.freeze({
  maxEntries: 1_500,
  maxEntryUncompressedBytes: 32 * 1024 * 1024,
  maxTotalUncompressedBytes: 128 * 1024 * 1024,
  maxMediaBytes: 96 * 1024 * 1024,
  maxConcurrency: 4,
});

function validRenderDimensions(width: number, height: number) {
  return Number.isFinite(width) && Number.isFinite(height) &&
    width > 0 && height > 0 && width <= MAX_SOURCE_EDGE && height <= MAX_SOURCE_EDGE;
}

function safeRenderScale(width: number, height: number, preferredScale = 2) {
  if (!validRenderDimensions(width, height)) return 0;
  return Math.min(
    preferredScale,
    Math.sqrt(MAX_RENDER_PIXELS / Math.max(1, width * height)),
    MAX_RENDER_EDGE / width,
    MAX_RENDER_EDGE / height,
  );
}

function pdfItemsToText(items: unknown[]) {
  const lines = new Map<number, Array<{ x: number; text: string }>>();
  for (const item of items as Array<{ str?: string; transform?: number[] }>) {
    const text = String(item?.str ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const x = Number(item?.transform?.[4]) || 0;
    const y = Number(item?.transform?.[5]) || 0;
    const key = Math.round(y / 3) * 3;
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key)?.push({ x, text });
  }
  return [...lines.entries()]
    .sort(([left], [right]) => right - left)
    .map(([, line]) => line.sort((left, right) => left.x - right.x).map((item) => item.text).join(" "))
    .join("\n");
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("OCR processing was aborted", "AbortError");
}

function readablePdfError(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/password/i.test(`${name} ${message}`)) {
    return new Error("该 PDF 已加密，请先移除打开密码后再上传。");
  }
  if (/invalidpdf|invalid pdf|missing pdf|unexpected response/i.test(`${name} ${message}`)) {
    return new Error("无法读取 PDF：文件可能已损坏，或内容与扩展名不一致。");
  }
  return new Error("无法读取 PDF，请确认文件完整、未加密且可以正常打开。");
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
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    enableScripting: false,
    isEvalSupported: false,
    maxImageSize: MAX_RENDER_PIXELS,
  } as Parameters<typeof pdfjs.getDocument>[0]);
  const abortLoading = () => loadingTask.destroy();
  signal.addEventListener("abort", abortLoading, { once: true });
  let pdf;
  try {
    pdf = await loadingTask.promise;
  } catch (error) {
    signal.removeEventListener("abort", abortLoading);
    await loadingTask.destroy().catch(() => undefined);
    if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
    throw readablePdfError(error);
  }
  try {
    if (pdf.numPages > 120) throw new Error("全页 OCR 最多支持 120 页，请拆分课件后重试。");
    for (let index = 0; index < pdf.numPages; index += 1) {
      throwIfAborted(signal);
      const number = index + 1;
      emitRenderingProgress(onProgress, number, pdf.numPages, "页面");
      const page = await pdf.getPage(number);
      const textContent = await page.getTextContent();
      const nativeText = pdfItemsToText(textContent.items as unknown[]);
      const nativeTextLength = nativeText.length;
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = safeRenderScale(baseViewport.width, baseViewport.height);
      if (scale <= 0) throw new Error(`第 ${number} 页尺寸异常，无法安全渲染。`);
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
          nativeText,
        }, number, pdf.numPages);
      } finally {
        canvas.width = 1;
        canvas.height = 1;
        page.cleanup();
      }
    }
  } finally {
    signal.removeEventListener("abort", abortLoading);
    await loadingTask.destroy();
  }
}

export async function renderPptxSlides(
  file: File,
  signal: AbortSignal,
  onProgress: ((progress: BrowserOcrProgress) => void) | undefined,
  consume: PageConsumer,
) {
  const [{ PptxViewer }, html2canvasModule] = await Promise.all([
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
    zipLimits: SAFE_PPTX_ZIP_LIMITS,
    lazyMedia: true,
    lazySlides: true,
    pdfjs: false,
    signal,
  });
  try {
    const total = viewer.slideCount;
    if (total < 1) throw new Error("PPTX 中没有可渲染的幻灯片。");
    if (total > 120) throw new Error("全页 OCR 最多支持 120 张幻灯片，请拆分课件后重试。");
    const slideWidth = Number(viewer.slideWidth);
    const slideHeight = Number(viewer.slideHeight);
    const slideScale = safeRenderScale(slideWidth, slideHeight);
    if (slideScale <= 0) throw new Error("PPTX 幻灯片尺寸异常，无法安全渲染。");
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
        const nativeText = (handle.element.textContent ?? "").replace(/\s+/g, " ").trim();
        const nativeTextLength = nativeText.length;
        const canvas = await html2canvas(handle.element, {
          backgroundColor: "#ffffff",
          logging: false,
          scale: slideScale,
          useCORS: true,
          width: slideWidth,
          height: slideHeight,
        });
        try {
          await consume({
            number,
            canvas,
            nativeTextLength,
            nativeText,
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
