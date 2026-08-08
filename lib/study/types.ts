export type StudyCondition = "A" | "B" | "C" | "D";
export type StudyCoreVariant = "U" | "G";

export interface StudyFactors {
  grounding: boolean;
  attribution: boolean;
  coreVariant: StudyCoreVariant;
}

export interface StudyHistoryItem {
  role: "user" | "assistant";
  /** Citation-free core answer text for assistant turns. */
  content: string;
}

export interface StudyClaim {
  id: string;
  text: string;
}

export interface StudyAnswerSection {
  id: string;
  heading: string;
  claims: StudyClaim[];
}

export interface StudyCoreAnswer {
  coreId: string;
  coreHash: string;
  summary: string;
  sections: StudyAnswerSection[];
  /** Citation-free Markdown generated only from summary and sections. */
  content: string;
}

export interface NormalizedPdfRectangle {
  /** Page-relative, top-left-origin coordinate in the inclusive range 0..1. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EvidenceAnchor {
  anchorId: string;
  materialVersion: string;
  pdfSha256: string;
  pdfPage: number;
  lectureSlide: number | null;
  origin: "native" | "ocr" | "visual";
  exactQuote: string;
  rectangles: NormalizedPdfRectangle[];
  supportType: "direct" | "inference";
}

export interface ClaimCitation {
  claimId: string;
  anchors: EvidenceAnchor[];
}

export interface StudyResponse {
  answer: StudyCoreAnswer;
  citations: ClaimCitation[];
  grounding: {
    enabled: boolean;
    strategy: "none" | "fixed_lecture_retrieval" | "frozen_ungrounded" | "frozen_grounded";
    evidenceCount: number;
  };
  attribution: { enabled: boolean };
  cacheKey?: string;
  cacheHit?: boolean;
  frozen: boolean;
  version: Record<string, string>;
}

export interface StudyRespondRequest {
  studyId: string;
  sessionToken: string;
  initial?: boolean;
  question?: string;
  history?: StudyHistoryItem[];
  /** Deliberately absent: condition is resolved from the immutable local session. */
}

export interface StudyRespondApiResponse {
  response: StudyResponse;
}

