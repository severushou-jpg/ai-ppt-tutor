export type OcrMode = "none" | "force";

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
  version: 1;
  mode: "force";
  engine: "tesseract.js";
  sourceType: "pdf" | "pptx";
  languages: string[];
  pages: OcrPageResult[];
}

export interface RenderedPage {
  number: number;
  canvas: HTMLCanvasElement;
  release: () => void;
}

export interface BrowserOcrOptions {
  signal: AbortSignal;
  onProgress?: (progress: BrowserOcrProgress) => void;
}
