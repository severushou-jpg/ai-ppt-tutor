export type LearningMode = "explain" | "qa" | "quiz" | "review";

export type UploadPhase =
  | "idle"
  | "uploading"
  | "parsing"
  | "indexing"
  | "ready"
  | "error";

export interface DocumentChunk {
  id: string;
  fileName: string;
  kind: "page" | "slide" | "section";
  number: number;
  label: string;
  text: string;
}

export interface DocumentIndex {
  id: string;
  name: string;
  extension: string;
  size: number;
  sectionCount: number;
  chunkCount: number;
  characterCount: number;
  truncated: boolean;
  chunks: DocumentChunk[];
}

export interface CitationSource {
  id: number;
  chunkId: string;
  fileName: string;
  label: string;
  kind: "page" | "slide" | "section";
  number: number;
  excerpt: string;
  score: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode: LearningMode;
  sources?: CitationSource[];
  grounded?: boolean;
  refused?: boolean;
}

export interface ApiError {
  code: string;
  message: string;
  details?: { canRetry?: boolean };
}
