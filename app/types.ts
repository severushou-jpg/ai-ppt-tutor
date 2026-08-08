export type LearningMode = "tutor" | "explain" | "qa" | "quiz" | "review";
export type OcrMode = "auto" | "none" | "force";
export type MasteryStatus = "not_started" | "learning" | "mastered" | "review_needed";
export type ExperimentCondition = "full_evidence" | "baseline";

export interface ExperimentSessionMetadata {
  participantId: string;
  sessionId: string;
  condition: ExperimentCondition;
  materialVersion: string;
  startedAt: number;
}

export interface GenerationVersionMetadata {
  promptVersion: string;
  modelVersion: string;
  materialVersion: string;
  condition: ExperimentCondition;
}

export type ExperimentEventName =
  | "session_start"
  | "condition_changed"
  | "upload_success"
  | "answer_generated"
  | "citation_shown"
  | "source_click"
  | "citation_view"
  | "learning_time"
  | "quiz_answer"
  | "session_end";

export interface ExperimentEvent {
  eventId: string;
  event: ExperimentEventName;
  timestamp: number;
  participantId: string;
  sessionId: string;
  condition: ExperimentCondition;
  materialVersion: string;
  data: Record<string, string | number | boolean | null>;
}

export type UploadPhase =
  | "idle"
  | "hashing"
  | "preparing_ocr"
  | "rendering"
  | "ocr"
  | "uploading"
  | "parsing"
  | "indexing"
  | "vision"
  | "paused"
  | "ready"
  | "error";

export interface StudyProgress {
  mastery: MasteryStatus;
  completedChunkIds: string[];
  lastPosition?: { kind: "page" | "slide" | "section"; number: number };
  lastStudiedAt?: number;
}

export interface DocumentChunk {
  id: string;
  fileName: string;
  kind: "page" | "slide" | "section";
  number: number;
  label: string;
  title: string;
  contentType: "prose" | "heading" | "definition" | "list" | "table" | "code" | "visual";
  structureTypes?: Array<"prose" | "definition" | "list" | "table" | "code" | "visual">;
  text: string;
  embedding?: number[];
  textOrigin?: "native" | "ocr" | "mixed" | "vision";
  ocrConfidence?: number;
  evidenceWeight?: number;
  visual?: VisualEvidence;
}

export interface VisualEvidence {
  id: string;
  kind: "chart" | "table" | "diagram" | "code" | "image" | "unknown";
  imageDataUrl: string;
  crop: { x: number; y: number; width: number; height: number };
  confidence: number;
  model?: string;
  altText?: string;
}

export interface OcrSummary {
  mode: OcrMode;
  engine?: "tesseract.js";
  totalPageCount: number;
  successfulPageCount: number;
  failedPageCount: number;
  averageConfidence?: number;
  durationMs?: number;
  inspectedPageCount?: number;
  automaticallySelectedPageCount?: number;
  failedPageNumbers?: number[];
}

export interface VisionSummary {
  candidateCount: number;
  analyzedCount: number;
  failedCount: number;
  failedLocations?: Array<{ kind: "page" | "slide"; number: number }>;
  model?: string;
}

export interface DocumentIndex {
  id: string;
  indexVersion: number;
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
  ocr?: OcrSummary;
  vision?: VisionSummary;
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
  originalText: string;
  highlightedEvidence?: string;
  confidenceScore: number;
  reason: string;
  title?: string;
  contentType?: DocumentChunk["contentType"];
  textOrigin?: DocumentChunk["textOrigin"];
  ocrConfidence?: number;
  evidenceWeight?: number;
  visual?: VisualEvidence;
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
  mode: "none" | "lexical" | "hybrid";
  reranked: boolean;
  candidateCount: number;
  strategy?: "ungrounded" | "focused" | "document_coverage" | "multi_query";
  indexedPageCount?: number;
  selectedPageCount?: number;
  queryCount?: number;
  visualCandidateCount?: number;
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
  generatedAt?: number;
  versionMetadata?: GenerationVersionMetadata;
}

export interface ApiError {
  code: string;
  message: string;
  details?: { canRetry?: boolean };
}
