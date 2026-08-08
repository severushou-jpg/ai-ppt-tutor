export type OcrMode = "auto" | "none" | "force";

export type BrowserOcrPhase = "preparing" | "rendering" | "recognizing";

export interface BrowserOcrProgress {
  phase: BrowserOcrPhase;
  current: number;
  total: number;
  progress?: number;
  message: string;
}

export interface OcrPageResult {
  number: number;
  text: string;
  confidence: number;
  durationMs: number;
  status: "success" | "failed";
}

export interface OcrManifest {
  version: 4;
  mode: OcrMode;
  engine: "tesseract.js";
  sourceType: "pdf" | "pptx";
  languages: string[];
  pages: OcrPageResult[];
  nativePages: Array<{ number: number; text: string }>;
  inspectedPageCount: number;
  visuals: VisualCandidate[];
}

export interface VisualCandidate {
  id: string;
  number: number;
  kind: "page" | "slide";
  imageDataUrl: string;
  crop: { x: number; y: number; width: number; height: number };
  score: number;
  nativeTextLength: number;
}

export interface RenderedPage {
  number: number;
  canvas: HTMLCanvasElement;
  nativeTextLength: number;
  nativeText: string;
}

export interface BrowserOcrOptions {
  signal: AbortSignal;
  mode: OcrMode;
  onProgress?: (progress: BrowserOcrProgress) => void;
}
