"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Expand,
  FileText,
  LoaderCircle,
  Minimize2,
  Minus,
  Plus,
} from "lucide-react";
import {
  STUDY_PDF_URL,
  lectureSlideForPdfPage,
  type EvidenceAnchor,
  type EvidenceRectangle,
} from "@/app/study/types";

interface MinimalPdfPage {
  getViewport(options: { scale: number }): { width: number; height: number };
  render(options: {
    canvas: HTMLCanvasElement;
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
    transform?: number[];
  }): { promise: Promise<void>; cancel(): void };
  getTextContent(): Promise<{
    items: Array<{
      str?: string;
      width?: number;
      height?: number;
      transform?: number[];
    }>;
  }>;
  cleanup(): void;
}

interface MinimalPdfDocument {
  numPages: number;
  getPage(page: number): Promise<MinimalPdfPage>;
  destroy(): Promise<void>;
}

function validRectangle(rectangle: EvidenceRectangle) {
  return [rectangle.x, rectangle.y, rectangle.width, rectangle.height].every(Number.isFinite) &&
    rectangle.x >= 0 && rectangle.y >= 0 && rectangle.width > 0 && rectangle.height > 0 &&
    rectangle.x + rectangle.width <= 1.01 && rectangle.y + rectangle.height <= 1.01;
}

function tokenize(value: string) {
  return value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function locateQuoteRectangles(
  items: Array<{ str?: string; width?: number; height?: number; transform?: number[] }>,
  quote: string,
  viewport: { width: number; height: number },
  scale: number,
) {
  const itemTokens = items.map((item) => tokenize(item.str ?? ""));
  const flattened = itemTokens.flatMap((tokens, itemIndex) =>
    tokens.map((token) => ({ token, itemIndex })),
  );
  const quoteTokens = tokenize(quote);
  if (quoteTokens.length === 0) return [];

  let matchedIndices: number[] = [];
  const minimum = Math.min(quoteTokens.length, 5);
  for (let targetLength = quoteTokens.length; targetLength >= minimum && matchedIndices.length === 0; targetLength -= 1) {
    for (let quoteStart = 0; quoteStart + targetLength <= quoteTokens.length; quoteStart += 1) {
      const target = quoteTokens.slice(quoteStart, quoteStart + targetLength);
      for (let index = 0; index + target.length <= flattened.length; index += 1) {
        if (target.every((token, offset) => flattened[index + offset]?.token === token)) {
          matchedIndices = [...new Set(flattened.slice(index, index + target.length).map((entry) => entry.itemIndex))];
          break;
        }
      }
      if (matchedIndices.length) break;
    }
  }

  return matchedIndices.flatMap((itemIndex) => {
    const item = items[itemIndex];
    const transform = item?.transform;
    if (!item || !transform || transform.length < 6) return [];
    const width = Math.max(1, Number(item.width) || 0) * scale;
    const height = Math.max(6, Number(item.height) || Math.hypot(transform[2] || 0, transform[3] || 0)) * scale;
    const left = Number(transform[4] || 0) * scale;
    const top = viewport.height - Number(transform[5] || 0) * scale - height;
    const rectangle = {
      x: Math.max(0, left / viewport.width),
      y: Math.max(0, top / viewport.height),
      width: Math.min(1, width / viewport.width),
      height: Math.min(1, height / viewport.height),
    };
    return validRectangle(rectangle) ? [rectangle] : [];
  });
}

function pageLabel(page: number, anchor?: EvidenceAnchor | null) {
  const lectureSlide = anchor?.pdfPage === page ? anchor.lectureSlide : lectureSlideForPdfPage(page);
  return lectureSlide ? `Lecture slide ${lectureSlide} · PDF page ${page}` : `PDF page ${page}`;
}

export function LectureViewer({
  activeAnchor,
  disabled = false,
  onPageViewed,
  onAnchorRendered,
}: {
  activeAnchor: EvidenceAnchor | null;
  disabled?: boolean;
  onPageViewed?: (page: number, source: "manual" | "citation") => void;
  onAnchorRendered?: (anchor: EvidenceAnchor, success: boolean) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const pageSurfaceRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const documentRef = useRef<MinimalPdfDocument | null>(null);
  const renderedAnchorRef = useRef<string>("");
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(27);
  const [zoom, setZoom] = useState(1);
  const [hostWidth, setHostWidth] = useState(360);
  const [expanded, setExpanded] = useState(false);
  const [documentReady, setDocumentReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [highlights, setHighlights] = useState<EvidenceRectangle[]>([]);
  const [preciseHighlight, setPreciseHighlight] = useState(true);
  const [canvasSize, setCanvasSize] = useState({ width: 1, height: 1 });

  useEffect(() => {
    let disposed = false;
    let current: MinimalPdfDocument | null = null;
    async function loadDocument() {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const task = pdfjs.getDocument({
          url: STUDY_PDF_URL,
          enableScripting: false,
          isEvalSupported: false,
        } as Parameters<typeof pdfjs.getDocument>[0]);
        current = await task.promise as unknown as MinimalPdfDocument;
        if (disposed) {
          await current.destroy();
          return;
        }
        documentRef.current = current;
        setPageCount(current.numPages);
        setDocumentReady(true);
        setError(null);
      } catch {
        if (!disposed) setError("The original lecture could not be loaded.");
      } finally {
        if (!disposed) setLoading(false);
      }
    }
    void loadDocument();
    return () => {
      disposed = true;
      documentRef.current = null;
      if (current) void current.destroy();
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = () => setHostWidth(Math.max(240, host.clientWidth));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [expanded]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (!activeAnchor) {
        setHighlights([]);
        return;
      }
      setPage(activeAnchor.pdfPage);
      onPageViewed?.(activeAnchor.pdfPage, "citation");
    });
    return () => {
      cancelled = true;
    };
  }, [activeAnchor, onPageViewed]);

  useEffect(() => {
    const document = documentRef.current;
    const canvas = canvasRef.current;
    if (!document || !canvas || !documentReady) return;
    if (activeAnchor && activeAnchor.pdfPage !== page) return;
    let cancelled = false;
    let pageProxy: MinimalPdfPage | null = null;
    let renderTask: { promise: Promise<void>; cancel(): void } | null = null;

    async function renderPage() {
      try {
        setLoading(true);
        pageProxy = await document!.getPage(page);
        const baseViewport = pageProxy.getViewport({ scale: 1 });
        const fitScale = Math.max(0.2, (hostWidth - (expanded ? 64 : 24)) / baseViewport.width);
        const scale = fitScale * zoom;
        const viewport = pageProxy.getViewport({ scale });
        const context = canvas!.getContext("2d", { alpha: false });
        if (!context) throw new Error("Canvas unavailable");
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        canvas!.width = Math.max(1, Math.floor(viewport.width * ratio));
        canvas!.height = Math.max(1, Math.floor(viewport.height * ratio));
        canvas!.style.width = `${viewport.width}px`;
        canvas!.style.height = `${viewport.height}px`;
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas!.width, canvas!.height);
        renderTask = pageProxy.render({
          canvas: canvas!,
          canvasContext: context,
          viewport,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        });
        await renderTask.promise;
        if (cancelled) return;
        setCanvasSize({ width: viewport.width, height: viewport.height });

        if (activeAnchor?.pdfPage === page) {
          let nextHighlights = activeAnchor.rectangles.filter(validRectangle);
          if (nextHighlights.length === 0 && activeAnchor.exactQuote) {
            const textContent = await pageProxy.getTextContent();
            nextHighlights = locateQuoteRectangles(textContent.items, activeAnchor.exactQuote, viewport, scale);
          }
          if (cancelled) return;
          const success = nextHighlights.length > 0;
          setPreciseHighlight(success);
          setHighlights(nextHighlights);
          if (success) {
            const first = nextHighlights[0];
            requestAnimationFrame(() => {
              const host = hostRef.current;
              const surface = pageSurfaceRef.current;
              if (!host || !surface) return;
              const left = surface.offsetLeft + first.x * surface.clientWidth - host.clientWidth / 2;
              const top = surface.offsetTop + first.y * surface.clientHeight - host.clientHeight / 2;
              host.scrollTo({ left: Math.max(0, left), top: Math.max(0, top), behavior: "smooth" });
            });
          }
          if (renderedAnchorRef.current !== `${activeAnchor.anchorId}:${success}`) {
            renderedAnchorRef.current = `${activeAnchor.anchorId}:${success}`;
            onAnchorRendered?.(activeAnchor, success);
          }
        } else {
          setHighlights([]);
          setPreciseHighlight(true);
        }
        setError(null);
      } catch (caught) {
        if (!cancelled && !(caught instanceof Error && caught.name === "RenderingCancelledException")) {
          setError("The original lecture page could not be rendered.");
          setHighlights([]);
          setPreciseHighlight(false);
          if (activeAnchor?.pdfPage === page && renderedAnchorRef.current !== `${activeAnchor.anchorId}:false`) {
            renderedAnchorRef.current = `${activeAnchor.anchorId}:false`;
            onAnchorRendered?.(activeAnchor, false);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void renderPage();
    return () => {
      cancelled = true;
      renderTask?.cancel();
      pageProxy?.cleanup();
    };
  }, [activeAnchor, documentReady, expanded, hostWidth, onAnchorRendered, page, zoom]);

  const setManualPage = useCallback((next: number) => {
    if (disabled) return;
    const bounded = Math.max(1, Math.min(pageCount, next));
    if (bounded === page) return;
    setPage(bounded);
    setHighlights([]);
    onPageViewed?.(bounded, "manual");
  }, [disabled, onPageViewed, page, pageCount]);

  const label = useMemo(() => pageLabel(page, activeAnchor), [activeAnchor, page]);
  const citationStatus = activeAnchor?.pdfPage !== page
    ? null
    : loading
      ? "loading"
      : preciseHighlight && !error && highlights.length > 0
        ? "success"
        : "failure";

  const viewer = (
    <section
      className={expanded
        ? "fixed inset-0 z-50 flex flex-col bg-slate-950/95 p-4 sm:p-6"
        : "flex h-full min-h-0 flex-col bg-[#eef2f7]"}
      aria-label="Original lecture viewer"
    >
      <header className={`flex flex-wrap items-center justify-between gap-2 border-b ${expanded ? "border-white/10 pb-4 text-white" : "border-slate-200 bg-white px-3 py-3"}`}>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <FileText className="h-4 w-4 text-blue-600" aria-hidden="true" />
            <span>Lecture</span>
          </div>
          <p className={`mt-0.5 truncate text-[11px] ${expanded ? "text-slate-300" : "text-slate-500"}`}>{label}</p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          disabled={disabled && !expanded}
          className={`inline-flex h-9 shrink-0 items-center justify-center rounded-lg transition disabled:cursor-not-allowed disabled:opacity-40 ${expanded ? "gap-2 border border-white/15 bg-white/10 px-3 text-xs font-semibold text-white hover:bg-white/20" : "w-9 border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"}`}
          aria-label={expanded ? "Return to study view" : "Expand lecture"}
          title={expanded ? "Return to study view" : "Expand lecture"}
        >
          {expanded ? (
            <>
              <Minimize2 className="h-4 w-4" aria-hidden="true" />
              <span>Return to study view</span>
            </>
          ) : (
            <Expand className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </header>

      <div className={`flex items-center justify-between gap-2 border-b ${expanded ? "border-white/10 py-3 text-white" : "border-slate-200 bg-white px-2 py-2"}`}>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setManualPage(page - 1)} disabled={disabled || page <= 1} aria-label="Previous page" className="grid h-8 w-8 place-items-center rounded-lg hover:bg-slate-200/70 disabled:opacity-30">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-16 text-center text-xs font-semibold tabular-nums">{page} / {pageCount}</span>
          <button type="button" onClick={() => setManualPage(page + 1)} disabled={disabled || page >= pageCount} aria-label="Next page" className="grid h-8 w-8 place-items-center rounded-lg hover:bg-slate-200/70 disabled:opacity-30">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setZoom((value) => Math.max(0.75, Number((value - 0.25).toFixed(2))))} disabled={disabled || zoom <= 0.75} aria-label="Zoom out" className="grid h-8 w-8 place-items-center rounded-lg hover:bg-slate-200/70 disabled:opacity-30">
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-10 text-center text-[11px] font-medium tabular-nums">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom((value) => Math.min(2.5, Number((value + 0.25).toFixed(2))))} disabled={disabled || zoom >= 2.5} aria-label="Zoom in" className="grid h-8 w-8 place-items-center rounded-lg hover:bg-slate-200/70 disabled:opacity-30">
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div ref={hostRef} className={`relative min-h-0 flex-1 overflow-auto ${expanded ? "mt-4 rounded-xl bg-slate-900" : "bg-[#e9edf3]"}`}>
        <div className="flex min-h-full min-w-full items-start justify-center p-3 sm:p-4">
          <div ref={pageSurfaceRef} className="relative shrink-0 overflow-hidden rounded-sm bg-white shadow-[0_8px_30px_rgba(15,23,42,0.18)]" style={{ width: canvasSize.width, height: canvasSize.height }}>
            <canvas
              key={`${page}:${zoom}:${Math.round(hostWidth)}:${expanded ? "expanded" : "panel"}:${activeAnchor?.anchorId ?? "none"}`}
              ref={canvasRef}
              className="block"
              aria-label={`Original lecture ${label}`}
            />
            <div className="pointer-events-none absolute inset-0" aria-hidden="true">
              {highlights.map((rectangle, index) => (
                <span
                  key={`${rectangle.x}-${rectangle.y}-${index}`}
                  data-citation-highlight="true"
                  className="absolute rounded-[3px] bg-transparent shadow-[0_0_0_2px_rgba(245,158,11,0.92),0_0_0_5px_rgba(251,191,36,0.16),0_0_14px_rgba(245,158,11,0.18)]"
                  style={{
                    left: `calc(${rectangle.x * 100}% - 2px)`,
                    top: `calc(${rectangle.y * 100}% - 2px)`,
                    width: `calc(${rectangle.width * 100}% + 4px)`,
                    height: `calc(${rectangle.height * 100}% + 4px)`,
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="absolute inset-0 grid place-items-center bg-white/55 backdrop-blur-[1px]">
            <div className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-medium text-slate-600 shadow">
              <LoaderCircle className="h-4 w-4 animate-spin text-blue-600" aria-hidden="true" />
              Loading original page…
            </div>
          </div>
        ) : null}
        {error ? (
          <div className="absolute inset-0 grid place-items-center p-5 text-center">
            <div className="max-w-xs rounded-xl border border-red-200 bg-white p-4 text-sm text-red-700 shadow">{error}</div>
          </div>
        ) : null}
      </div>

      {citationStatus ? (
        <div className={`border-t px-3 py-2 text-[11px] leading-4 ${
          citationStatus === "success"
            ? expanded ? "border-white/10 text-slate-300" : "border-slate-200 bg-white text-slate-500"
            : citationStatus === "loading"
              ? expanded ? "border-white/10 text-slate-300" : "border-slate-200 bg-white text-slate-500"
              : expanded ? "border-red-400/30 bg-red-950/30 text-red-200" : "border-red-200 bg-red-50 text-red-700"
        }`} role={citationStatus === "failure" ? "alert" : "status"}>
          {citationStatus === "success"
            ? "The cited passage is highlighted in the original lecture."
            : citationStatus === "loading"
              ? "Opening and locating the cited passage…"
              : "The source page opened, but exact highlighting failed. Please inform the researcher."}
        </div>
      ) : null}
    </section>
  );

  return viewer;
}
