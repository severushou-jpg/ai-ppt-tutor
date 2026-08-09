export type StudyCondition = "A" | "B" | "C" | "D";
export type StudyStratum = "novice" | "experienced";
export type StudyStatus = "prepared" | "active" | "completed" | "interrupted" | "withdrawn";
export type StudyParticipantStage =
  | "information_sheet"
  | "written_consent"
  | "form1"
  | "ready"
  | "learning"
  | "form3"
  | "form2"
  | "done"
  | "halted";

export interface StudyProcedure {
  version: string;
  informationSheetVersion: string;
  informationSheetAcknowledgedAt: string | null;
  writtenConsentConfirmedAt: string | null;
  form1ConfirmedAt: string | null;
  learningStartedAt: string | null;
  learningEndedAt: string | null;
  form3ConfirmedAt: string | null;
  form2ConfirmedAt: string | null;
  procedureCompletedAt: string | null;
  haltedAt: string | null;
}

export type StudyProcedureAction =
  | "acknowledge_information_sheet"
  | "confirm_written_consent"
  | "confirm_form1"
  | "confirm_form3"
  | "confirm_form2";

export interface ExperimentAccessCapabilities {
  configured: boolean;
  authorized: boolean;
  localBypass: boolean;
  keyRequired: boolean;
  requireResearcherKeyForConsent: boolean;
  capability: "local-loopback" | "researcher-cookie" | "researcher-key" | "unavailable";
}
export type StudyFinalizeReason =
  | "time_limit"
  | "early_completion"
  | "researcher_stop"
  | "technical_failure"
  | "participant_withdrawal";

export interface StudySession {
  studyId: string;
  status: StudyStatus;
  participantStage: StudyParticipantStage;
  procedure: StudyProcedure;
  createdAt: string;
  startedAt: string | null;
  scheduledEndAt: string | null;
  endedAt: string | null;
  finalizationCompleteAt: string | null;
  durationSeconds: number;
  remainingSeconds: number;
  completionReason: StudyFinalizeReason | null;
}

export interface EvidenceRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EvidenceAnchor {
  anchorId: string;
  pdfPage: number;
  lectureSlide: number | null;
  exactQuote: string;
  rectangles: EvidenceRectangle[];
  supportType: "direct" | "inference";
  origin: "native" | "ocr" | "visual";
}

export interface StudyCitation {
  claimId: string;
  anchors: EvidenceAnchor[];
}

export interface StudyAnswerSection {
  id: string;
  heading: string;
  claims: Array<{ id: string; text: string }>;
}

export interface StudyAnswer {
  coreId: string;
  coreHash: string;
  summary: string;
  sections: StudyAnswerSection[];
  content: string;
}

export interface StudyResponse {
  answer: StudyAnswer;
  citations: StudyCitation[];
  grounding?: { enabled: boolean; strategy: string; evidenceCount: number };
  attribution?: { enabled: boolean };
  cacheKey?: string;
  cacheHit?: boolean;
  frozen?: boolean;
  version?: Record<string, string>;
}

export interface StudyChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  answer?: StudyAnswer;
  citations?: StudyCitation[];
  createdAt: string;
}

export interface StudyEventPayload {
  type: string;
  clientTimestamp?: string;
  elapsedMs?: number;
  data?: Record<string, unknown>;
}

export const STUDY_DURATION_SECONDS = 25 * 60;
export const STUDY_PDF_URL = "/study/DBI_Relational_Model.pdf";
export const STUDY_MATERIAL_HASH = "fc51ca07bcf6a74cc83b1e790f9a6fda8f73dbbc26ee0b7ac4071ac22ef7f879";

export function studyTokenKey(studyId: string) {
  return `ai-ppt-tutor:study:${studyId}:token`;
}

export function currentStudyKey() {
  return "ai-ppt-tutor:study:current-id";
}

export async function readApiError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null) as
    | { error?: string | { message?: string }; message?: string; code?: string }
    | null;
  if (typeof body?.error === "string") return body.error;
  if (body?.error && typeof body.error === "object" && body.error.message) return body.error.message;
  return body?.message || body?.code || fallback;
}

export function formatTimer(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export function lectureSlideForPdfPage(pdfPage: number) {
  if (pdfPage === 3) return 1;
  if (pdfPage === 4) return 2;
  if (pdfPage >= 6 && pdfPage <= 27) return pdfPage - 3;
  return null;
}
