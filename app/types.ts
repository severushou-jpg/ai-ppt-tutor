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
  title: string;
  contentType: "prose" | "heading" | "definition" | "list" | "table" | "code";
  text: string;
  embedding?: number[];
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
  retrievalMode?: "lexical" | "hybrid";
  embeddingModel?: string;
  embeddingDimensions?: number;
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
  highlight?: string;
  title?: string;
  contentType?: DocumentChunk["contentType"];
  score: number;
}

export interface StructuredItem {
  text: string;
  citations: number[];
  supported: boolean;
}

export interface StructuredAnswer {
  summary: string;
  sections: Array<{ heading: string; items: StructuredItem[] }>;
  quiz: Array<{
    question: string;
    difficulty: "基础" | "进阶" | "应用";
    answer: string;
    explanation: string;
    citations: number[];
  }>;
  partialRefusal: string | null;
  suggestedQuestions: string[];
  supportedClaimCount: number;
}

export interface RetrievalMetadata {
  mode: "lexical" | "hybrid";
  reranked: boolean;
  candidateCount: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode: LearningMode;
  sources?: CitationSource[];
  grounded?: boolean;
  refused?: boolean;
  structured?: StructuredAnswer;
  retrieval?: RetrievalMetadata;
  feedback?: "helpful" | "inaccurate";
}

export interface ApiError {
  code: string;
  message: string;
  details?: { canRetry?: boolean };
}
