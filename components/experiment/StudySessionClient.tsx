"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from "react";
import {
  BookOpen,
  CircleAlert,
  Clock3,
  Flag,
  LoaderCircle,
  LockKeyhole,
  Play,
  Send,
  Sparkles,
} from "lucide-react";
import { LectureViewer } from "./LectureViewer";
import { StudyAnswerCard } from "./StudyAnswerCard";
import { createClientStudyEventQueue } from "@/lib/client-study-event-queue.js";
import {
  STUDY_DURATION_SECONDS,
  currentStudyKey,
  formatTimer,
  readApiError,
  studyTokenKey,
  type EvidenceAnchor,
  type StudyChatMessage,
  type StudyEventPayload,
  type StudyFinalizeReason,
  type StudyResponse,
  type StudySession,
} from "@/app/study/types";

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function messageStorageKey(studyId: string) {
  return `ai-ppt-tutor:study:${studyId}:messages`;
}

function eventQueueStorageKey(studyId: string) {
  return `ai-ppt-tutor:study:${studyId}:pending-events`;
}

function finalizationIntentStorageKey(studyId: string) {
  return `ai-ppt-tutor:study:${studyId}:finalization-intent`;
}

interface FinalizationIntent {
  reason: StudyFinalizeReason;
  requestedAt: string;
}

function readFinalizationIntent(studyId: string): FinalizationIntent | null {
  try {
    const value = sessionStorage.getItem(finalizationIntentStorageKey(studyId));
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<FinalizationIntent>;
    if (parsed.reason !== "early_completion" || typeof parsed.requestedAt !== "string" || !Number.isFinite(Date.parse(parsed.requestedAt))) {
      return null;
    }
    return { reason: parsed.reason, requestedAt: new Date(parsed.requestedAt).toISOString() };
  } catch {
    return null;
  }
}

function writeFinalizationIntent(studyId: string, intent: FinalizationIntent | null) {
  try {
    if (intent) sessionStorage.setItem(finalizationIntentStorageKey(studyId), JSON.stringify(intent));
    else sessionStorage.removeItem(finalizationIntentStorageKey(studyId));
  } catch {
    // Finalization still proceeds; the server record remains authoritative.
  }
}

interface QueuedStudyEvent {
  queueId: string;
  event: StudyEventPayload;
}

function readEventQueue(studyId: string): QueuedStudyEvent[] {
  try {
    const value = sessionStorage.getItem(eventQueueStorageKey(studyId));
    const parsed = value ? JSON.parse(value) as QueuedStudyEvent[] : [];
    return Array.isArray(parsed) ? parsed.slice(0, 500) : [];
  } catch {
    return [];
  }
}

function writeEventQueue(studyId: string, events: QueuedStudyEvent[]) {
  try {
    if (events.length === 0) sessionStorage.removeItem(eventQueueStorageKey(studyId));
    else sessionStorage.setItem(eventQueueStorageKey(studyId), JSON.stringify(events.slice(-500)));
  } catch {
    // Storage failure is surfaced by the server-side record checks before a study starts.
  }
}

function plainAnswer(response: StudyResponse) {
  if (response.answer.content?.trim()) return response.answer.content.trim();
  const sections = response.answer.sections
    .map((section) => `${section.heading}\n${section.claims.map((claim) => claim.text).join("\n")}`)
    .join("\n\n");
  return [response.answer.summary, sections].filter(Boolean).join("\n\n");
}

function unwrapStudyResponse(payload: StudyResponse | { response: StudyResponse }) {
  return "response" in payload ? payload.response : payload;
}

function remainingFromSession(session: StudySession) {
  if (session.status !== "active") return session.remainingSeconds ?? 0;
  const deadline = session.scheduledEndAt ? new Date(session.scheduledEndAt).getTime() : Number.NaN;
  if (Number.isFinite(deadline)) return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  return Math.max(0, session.remainingSeconds ?? STUDY_DURATION_SECONDS);
}

export function StudySessionClient({ initialStudyId }: { initialStudyId: string }) {
  const conversationRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<StudySession | null>(null);
  const finishingRef = useRef(false);
  const finalizingRef = useRef(false);
  const finalizeRetryTimerRef = useRef<number | null>(null);
  const finalizeStudyRef = useRef<(reason: StudyFinalizeReason) => void>(() => undefined);
  const finalizationIntentRef = useRef<FinalizationIntent | null>(null);
  const responseAbortControllerRef = useRef<AbortController | null>(null);
  const eventQueueRef = useRef<{
    key: string;
    controller: ReturnType<typeof createClientStudyEventQueue>;
  } | null>(null);
  const inputFocusedRef = useRef(false);
  const scrollCheckpointsRef = useRef(new Set<number>());
  const lastUserScrollIntentRef = useRef(0);
  const programmaticScrollRef = useRef(false);
  const sourceOpenedAtRef = useRef<{ anchorId: string; timestamp: number } | null>(null);
  const [studyId, setStudyId] = useState(initialStudyId);
  const [sessionToken, setSessionToken] = useState("");
  const [session, setSession] = useState<StudySession | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(STUDY_DURATION_SECONDS);
  const [messages, setMessages] = useState<StudyChatMessage[]>([]);
  const [activeAnchor, setActiveAnchor] = useState<EvidenceAnchor | null>(null);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [sending, setSending] = useState(false);
  const [ended, setEnded] = useState(false);
  const [showFinishConfirmation, setShowFinishConfirmation] = useState(false);
  const [pendingFinalizationReason, setPendingFinalizationReason] = useState<StudyFinalizeReason | null>(null);
  const [requestedFinalizationReason, setRequestedFinalizationReason] = useState<StudyFinalizeReason | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [technicalFailure, setTechnicalFailure] = useState(false);
  const [finalizationStatus, setFinalizationStatus] = useState<"idle" | "saving" | "saved" | "retrying">("idle");

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    const previous = document.documentElement.lang;
    document.documentElement.lang = "en";
    return () => {
      document.documentElement.lang = previous;
    };
  }, []);

  const getEventQueue = useCallback(() => {
    const key = `${studyId}:${sessionToken}`;
    if (eventQueueRef.current?.key === key) return eventQueueRef.current.controller;
    const controller = createClientStudyEventQueue({
      read: () => readEventQueue(studyId),
      write: (events: QueuedStudyEvent[]) => writeEventQueue(studyId, events),
      send: async (entry: QueuedStudyEvent) => {
        try {
          const response = await fetch("/api/study/log", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ studyId, sessionToken, event: entry.event }),
            keepalive: true,
          });
          return { ok: response.ok, terminal: response.status === 409 };
        } catch {
          return { ok: false, terminal: false };
        }
      },
    });
    eventQueueRef.current = { key, controller };
    return controller;
  }, [sessionToken, studyId]);

  const logEvent = useCallback(async (event: StudyEventPayload) => {
    const currentSession = sessionRef.current;
    if (!studyId || !sessionToken || currentSession?.status !== "active" || finishingRef.current) return;
    const deadline = currentSession.scheduledEndAt ? Date.parse(currentSession.scheduledEndAt) : Number.NaN;
    if (Number.isFinite(deadline) && Date.now() >= deadline) return;
    const startedAt = currentSession.startedAt ? new Date(currentSession.startedAt).getTime() : Date.now();
    const preparedEvent: StudyEventPayload = {
      ...event,
      clientTimestamp: event.clientTimestamp ?? new Date().toISOString(),
      elapsedMs: event.elapsedMs ?? Math.max(0, Date.now() - startedAt),
      data: { clientEventId: createId(), ...(event.data ?? {}) },
    };
    await getEventQueue().enqueue({ queueId: createId(), event: preparedEvent });
  }, [getEventQueue, sessionToken, studyId]);

  const finalizeStudy = useCallback(async (reason: StudyFinalizeReason = "time_limit") => {
    if (finalizingRef.current || !studyId || !sessionToken) return;
    finalizingRef.current = true;
    finishingRef.current = true;
    setRequestedFinalizationReason(reason);
    const existingIntent = finalizationIntentRef.current;
    const intent = existingIntent?.reason === reason
      ? existingIntent
      : { reason, requestedAt: new Date().toISOString() };
    finalizationIntentRef.current = intent;
    writeFinalizationIntent(studyId, intent);
    responseAbortControllerRef.current?.abort();
    responseAbortControllerRef.current = null;
    if (finalizeRetryTimerRef.current !== null) {
      window.clearTimeout(finalizeRetryTimerRef.current);
      finalizeRetryTimerRef.current = null;
    }
    setShowFinishConfirmation(false);
    setFinalizationStatus("saving");
    setSending(false);
    setEnded(true);
    setRemainingSeconds(0);
    setActiveAnchor(null);
    setQuestion("");
    const opened = sourceOpenedAtRef.current;
    if (opened) {
      sourceOpenedAtRef.current = null;
      const currentSession = sessionRef.current;
      const now = Date.now();
      const deadline = currentSession?.scheduledEndAt ? Date.parse(currentSession.scheduledEndAt) : Number.NaN;
      const requestedAt = Date.parse(intent.requestedAt);
      const recordedAt = reason === "time_limit" && Number.isFinite(deadline)
        ? Math.min(now, deadline)
        : reason === "early_completion" && Number.isFinite(requestedAt)
          ? Math.min(now, requestedAt)
          : now;
      const startedAt = currentSession?.startedAt ? Date.parse(currentSession.startedAt) : recordedAt;
      const closeEvent: StudyEventPayload = {
        type: "source_view_closed",
        clientTimestamp: new Date(recordedAt).toISOString(),
        elapsedMs: Math.max(0, Math.min(STUDY_DURATION_SECONDS * 1_000, recordedAt - startedAt)),
        data: {
          clientEventId: createId(),
          anchorId: opened.anchorId,
          durationMs: Math.max(0, recordedAt - opened.timestamp),
        },
      };
      await getEventQueue().enqueue({ queueId: createId(), event: closeEvent });
    }
    await getEventQueue().flush();
    let saved = false;
    try {
      const pendingEvents = getEventQueue().pending().map((entry: QueuedStudyEvent) => entry.event);
      const response = await fetch("/api/study/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studyId,
          sessionToken,
          reason,
          clientEndedAt: reason === "early_completion" ? intent.requestedAt : undefined,
          pendingEvents,
        }),
        keepalive: true,
      });
      if (!response.ok) throw new Error(await readApiError(response, "The research record could not be finalized."));
      const result = await response.json() as { session: StudySession };
      setSession(result.session);
      sessionRef.current = result.session;
      writeEventQueue(studyId, []);
      finalizationIntentRef.current = null;
      writeFinalizationIntent(studyId, null);
      setPendingFinalizationReason(null);
      setFinalizationStatus("saved");
      setError(null);
      saved = true;
    } catch (caught) {
      setTechnicalFailure(true);
      setFinalizationStatus("retrying");
      setError(caught instanceof Error ? caught.message : "The research record could not be finalized.");
    } finally {
      sourceOpenedAtRef.current = null;
      finalizingRef.current = false;
      if (!saved) {
        finalizeRetryTimerRef.current = window.setTimeout(() => {
          finalizeRetryTimerRef.current = null;
          finalizeStudyRef.current(reason);
        }, 2_000);
      }
    }
  }, [getEventQueue, sessionToken, studyId]);

  useEffect(() => {
    finalizeStudyRef.current = (reason) => void finalizeStudy(reason);
  }, [finalizeStudy]);

  useEffect(() => {
    if (!pendingFinalizationReason || session?.status !== "active" || !studyId || !sessionToken) return;
    const timer = window.setTimeout(() => void finalizeStudy(pendingFinalizationReason), 0);
    return () => window.clearTimeout(timer);
  }, [finalizeStudy, pendingFinalizationReason, session?.status, sessionToken, studyId]);

  useEffect(() => () => {
    if (finalizeRetryTimerRef.current !== null) window.clearTimeout(finalizeRetryTimerRef.current);
    responseAbortControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      await Promise.resolve();
      const resolvedStudyId = initialStudyId || sessionStorage.getItem(currentStudyKey()) || "";
      if (!resolvedStudyId || !/^APTT-\d{3}$/.test(resolvedStudyId)) {
        if (!cancelled) {
          setError("No prepared study session was found. Please return the computer to the researcher.");
          setLoading(false);
        }
        return;
      }
      const token = sessionStorage.getItem(studyTokenKey(resolvedStudyId)) || "";
      if (!token) {
        if (!cancelled) {
          setError("This study session cannot be recovered. Please return the computer to the researcher.");
          setLoading(false);
        }
        return;
      }
      if (cancelled) return;
      setStudyId(resolvedStudyId);
      setSessionToken(token);
      const storedMessages = sessionStorage.getItem(messageStorageKey(resolvedStudyId));
      if (storedMessages) {
        try {
          const parsed = JSON.parse(storedMessages) as StudyChatMessage[];
          if (Array.isArray(parsed)) setMessages(parsed);
        } catch {
          sessionStorage.removeItem(messageStorageKey(resolvedStudyId));
        }
      }

      try {
        const response = await fetch(`/api/study/recover?studyId=${encodeURIComponent(resolvedStudyId)}`, {
          cache: "no-store",
          headers: { "x-study-session-token": token },
        });
        if (!response.ok) throw new Error(await readApiError(response, "This study session could not be recovered."));
        const result = await response.json() as { session: StudySession };
        if (cancelled) return;
        setSession(result.session);
        sessionRef.current = result.session;
        const remaining = remainingFromSession(result.session);
        setRemainingSeconds(remaining);
        const storedFinalizationIntent = readFinalizationIntent(resolvedStudyId);
        if (result.session.status === "active" && storedFinalizationIntent?.reason === "early_completion") {
          finalizationIntentRef.current = storedFinalizationIntent;
          setEnded(true);
          finishingRef.current = true;
          setFinalizationStatus("retrying");
          setRequestedFinalizationReason("early_completion");
          setPendingFinalizationReason("early_completion");
        }
        if (
          result.session.status === "completed" ||
          result.session.status === "interrupted" ||
          result.session.status === "withdrawn" ||
          (result.session.status === "active" && remaining <= 0)
        ) {
          setEnded(true);
          finishingRef.current = true;
          setFinalizationStatus("saved");
          finalizationIntentRef.current = null;
          writeFinalizationIntent(resolvedStudyId, null);
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "This study session could not be recovered.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void initialize();
    return () => {
      cancelled = true;
    };
  }, [initialStudyId]);

  useEffect(() => {
    if (!studyId || messages.length === 0) return;
    sessionStorage.setItem(messageStorageKey(studyId), JSON.stringify(messages));
  }, [messages, studyId]);

  useEffect(() => {
    if (session?.status !== "active" || ended) return;
    const update = () => {
      const current = sessionRef.current;
      if (!current) return;
      const remaining = remainingFromSession(current);
      setRemainingSeconds(remaining);
      if (remaining <= 0) void finalizeStudy("time_limit");
    };
    update();
    const interval = window.setInterval(update, 250);
    return () => window.clearInterval(interval);
  }, [ended, finalizeStudy, session?.status]);

  useEffect(() => {
    if (session?.status !== "active" || ended) return;
    const onVisibility = () => void logEvent({
      type: document.visibilityState === "hidden" ? "window_hidden" : "window_visible",
      data: { visibilityState: document.visibilityState },
    });
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [ended, logEvent, session?.status]);

  useEffect(() => {
    if (session?.status !== "active" || ended || !studyId || !sessionToken) return;
    const flush = () => void getEventQueue().flush();
    flush();
    const interval = window.setInterval(flush, 5_000);
    window.addEventListener("online", flush);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", flush);
    };
  }, [ended, getEventQueue, session?.status, sessionToken, studyId]);

  useEffect(() => {
    if (session?.status !== "active" || ended) return;
    history.pushState({ studySession: true }, "", window.location.href);
    const preventBackNavigation = () => {
      history.pushState({ studySession: true }, "", window.location.href);
      void logEvent({ type: "back_navigation_blocked" });
    };
    window.addEventListener("popstate", preventBackNavigation);
    return () => window.removeEventListener("popstate", preventBackNavigation);
  }, [ended, logEvent, session?.status]);

  useEffect(() => {
    const conversation = conversationRef.current;
    if (!conversation || session?.status !== "active" || ended) return;
    const markUserScrollIntent = () => {
      lastUserScrollIntentRef.current = Date.now();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(event.key)) {
        markUserScrollIntent();
      }
    };
    const onScroll = () => {
      if (programmaticScrollRef.current) return;
      if (Date.now() - lastUserScrollIntentRef.current > 1_500) return;
      const available = conversation.scrollHeight - conversation.clientHeight;
      if (available <= 0) return;
      const percentage = Math.round((conversation.scrollTop / available) * 100);
      for (const checkpoint of [25, 50, 75, 100]) {
        if (percentage >= checkpoint && !scrollCheckpointsRef.current.has(checkpoint)) {
          scrollCheckpointsRef.current.add(checkpoint);
          void logEvent({ type: "conversation_scroll_checkpoint", data: { checkpoint } });
        }
      }
    };
    conversation.addEventListener("wheel", markUserScrollIntent, { passive: true });
    conversation.addEventListener("touchmove", markUserScrollIntent, { passive: true });
    conversation.addEventListener("keydown", onKeyDown);
    conversation.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      conversation.removeEventListener("wheel", markUserScrollIntent);
      conversation.removeEventListener("touchmove", markUserScrollIntent);
      conversation.removeEventListener("keydown", onKeyDown);
      conversation.removeEventListener("scroll", onScroll);
    };
  }, [ended, logEvent, session?.status]);

  useEffect(() => {
    const conversation = conversationRef.current;
    if (!conversation || messages.length === 0) return;
    programmaticScrollRef.current = true;
    lastUserScrollIntentRef.current = 0;
    conversation.scrollTo({
      top: messages.length === 1 ? 0 : conversation.scrollHeight,
      behavior: "auto",
    });
    const frame = window.requestAnimationFrame(() => {
      programmaticScrollRef.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages]);

  async function requestInitialExplanation() {
    const controller = new AbortController();
    responseAbortControllerRef.current = controller;
    try {
      const response = await fetch("/api/study/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studyId,
          sessionToken,
          initial: true,
          question: "",
          history: [],
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await readApiError(response, "The lecture guide could not be prepared."));
      const result = unwrapStudyResponse(await response.json() as StudyResponse | { response: StudyResponse });
      if (finishingRef.current) return;
      const message: StudyChatMessage = {
        id: createId(),
        role: "assistant",
        content: plainAnswer(result),
        answer: result.answer,
        citations: result.citations,
        createdAt: new Date().toISOString(),
      };
      setMessages([message]);
      await logEvent({
        type: "initial_explanation_shown",
        data: {
          answerCoreId: result.answer.coreId,
          answerCoreHash: result.answer.coreHash,
          answer: message.content,
          citationCount: result.citations.flatMap((citation) => citation.anchors).length,
          version: result.version,
        },
      });
    } finally {
      if (responseAbortControllerRef.current === controller) responseAbortControllerRef.current = null;
    }
  }

  async function startLearning() {
    if (!session || session.status !== "prepared" || starting) return;
    setStarting(true);
    setError(null);
    try {
      const response = await fetch("/api/study/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studyId, sessionToken }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "The learning session could not be started."));
      const result = await response.json() as { session: StudySession };
      finishingRef.current = false;
      finalizingRef.current = false;
      setFinalizationStatus("idle");
      setRequestedFinalizationReason(null);
      writeEventQueue(studyId, []);
      finalizationIntentRef.current = null;
      writeFinalizationIntent(studyId, null);
      setEnded(false);
      setSession(result.session);
      sessionRef.current = result.session;
      setRemainingSeconds(remainingFromSession(result.session));
      setMessages([]);
      sessionStorage.removeItem(messageStorageKey(studyId));
      await requestInitialExplanation();
    } catch (caught) {
      if (finishingRef.current && isAbortError(caught)) return;
      setTechnicalFailure(true);
      setError(caught instanceof Error ? caught.message : "The learning session could not be started.");
    } finally {
      setStarting(false);
    }
  }

  async function sendQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || sending || ended || session?.status !== "active") return;
    const requestStarted = performance.now();
    const userMessage: StudyChatMessage = {
      id: createId(),
      role: "user",
      content: trimmed,
      createdAt: new Date().toISOString(),
    };
    const priorMessages = messages;
    setMessages((current) => [...current, userMessage]);
    setQuestion("");
    setSending(true);
    setError(null);
    await logEvent({ type: "question_submitted", data: { messageId: userMessage.id, question: trimmed } });
    const controller = new AbortController();
    responseAbortControllerRef.current = controller;
    try {
      const history = priorMessages.map((message) => ({ role: message.role, content: message.content }));
      const response = await fetch("/api/study/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studyId, sessionToken, question: trimmed, history }),
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 409) void finalizeStudy("time_limit");
        throw new Error(await readApiError(response, "The tutor could not answer this question."));
      }
      const result = unwrapStudyResponse(await response.json() as StudyResponse | { response: StudyResponse });
      if (finishingRef.current) return;
      const assistantMessage: StudyChatMessage = {
        id: createId(),
        role: "assistant",
        content: plainAnswer(result),
        answer: result.answer,
        citations: result.citations,
        createdAt: new Date().toISOString(),
      };
      setMessages((current) => [...current, assistantMessage]);
      await logEvent({
        type: "answer_shown",
        data: {
          messageId: assistantMessage.id,
          questionMessageId: userMessage.id,
          answer: assistantMessage.content,
          answerCoreId: result.answer.coreId,
          answerCoreHash: result.answer.coreHash,
          citationCount: result.citations.flatMap((citation) => citation.anchors).length,
          latencyMs: Math.round(performance.now() - requestStarted),
          version: result.version,
        },
      });
    } catch (caught) {
      if (isAbortError(caught) && finishingRef.current) return;
      setTechnicalFailure(true);
      setError(caught instanceof Error ? caught.message : "The tutor could not answer this question.");
      await logEvent({
        type: "answer_failed",
        data: { questionMessageId: userMessage.id, message: caught instanceof Error ? caught.message : "Unknown error" },
      });
    } finally {
      if (responseAbortControllerRef.current === controller) responseAbortControllerRef.current = null;
      setSending(false);
    }
  }

  const closeCurrentSource = useCallback(() => {
    const opened = sourceOpenedAtRef.current;
    if (!opened) return;
    sourceOpenedAtRef.current = null;
    void logEvent({
      type: "source_view_closed",
      data: { anchorId: opened.anchorId, durationMs: Math.max(0, Date.now() - opened.timestamp) },
    });
  }, [logEvent]);

  useEffect(() => {
    if (session?.status === "active" && !ended && remainingSeconds <= 1 && sourceOpenedAtRef.current) {
      closeCurrentSource();
    }
  }, [closeCurrentSource, ended, remainingSeconds, session?.status]);

  const handleCitationClick = useCallback((anchor: EvidenceAnchor, sourceNumber: number, messageId: string) => {
    closeCurrentSource();
    sourceOpenedAtRef.current = { anchorId: anchor.anchorId, timestamp: Date.now() };
    setActiveAnchor(anchor);
    void logEvent({
      type: "source_view_opened",
      data: { messageId, sourceNumber, anchorId: anchor.anchorId, pdfPage: anchor.pdfPage },
    });
    void logEvent({
      type: "citation_clicked",
      data: { messageId, sourceNumber, anchorId: anchor.anchorId, pdfPage: anchor.pdfPage, lectureSlide: anchor.lectureSlide },
    });
  }, [closeCurrentSource, logEvent]);

  const handlePageViewed = useCallback((page: number, source: "manual" | "citation") => {
    if (source === "manual") {
      closeCurrentSource();
      setActiveAnchor(null);
    }
    void logEvent({
      type: source === "manual" ? "manual_pdf_page_changed" : "pdf_page_changed",
      data: { pdfPage: page, navigation: source },
    });
  }, [closeCurrentSource, logEvent]);

  const handleAnchorRendered = useCallback((anchor: EvidenceAnchor, success: boolean) => {
    void logEvent({
      type: success ? "citation_highlight_rendered" : "citation_highlight_failed",
      data: { anchorId: anchor.anchorId, pdfPage: anchor.pdfPage, origin: anchor.origin },
    });
  }, [logEvent]);

  function handleMeaningfulClick(event: MouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    const actionable = target.closest<HTMLElement>("[data-study-action]");
    const action = actionable?.dataset.studyAction;
    if (action) void logEvent({ type: "ui_click", data: { action } });
  }

  function confirmEarlyCompletion() {
    if (sessionRef.current?.status !== "active" || finishingRef.current) return;
    void finalizeStudy("early_completion");
  }

  const active = session?.status === "active" && !ended && remainingSeconds > 0;
  const timerUrgent = remainingSeconds <= 120;
  const endedEarly = (session?.completionReason ?? requestedFinalizationReason) === "early_completion";
  const statusLabel = useMemo(() => {
    if (loading) return "Recovering study session…";
    if (ended) return endedEarly ? "Learning completed early" : "Learning session complete";
    if (session?.status === "prepared") return "Ready to begin";
    return "Learning in progress";
  }, [ended, endedEarly, loading, session?.status]);

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f4f7fb] p-6">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-6 py-4 text-sm font-medium text-slate-600 shadow-lg">
          <LoaderCircle className="h-5 w-5 animate-spin text-blue-600" aria-hidden="true" />
          Recovering the prepared study session…
        </div>
      </main>
    );
  }

  if (!session || (error && !sessionToken)) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f4f7fb] p-6">
        <section className="max-w-md rounded-3xl border border-red-200 bg-white p-8 text-center shadow-xl">
          <CircleAlert className="mx-auto h-10 w-10 text-red-500" aria-hidden="true" />
          <h1 className="mt-4 text-xl font-bold">Study session unavailable</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">{error}</p>
          <p className="mt-5 text-xs text-slate-500">Please return the computer to the researcher.</p>
        </section>
      </main>
    );
  }

  if (session.status === "prepared") {
    return (
      <main className="relative grid min-h-screen place-items-center overflow-hidden bg-[#f4f7fb] p-5">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_5%,rgba(37,99,235,0.14),transparent_36%),radial-gradient(circle_at_85%_12%,rgba(99,102,241,0.13),transparent_34%)]" />
        <section className="relative w-full max-w-2xl overflow-hidden rounded-[2rem] border border-slate-200 bg-white text-center shadow-[0_30px_90px_rgba(15,23,42,0.14)]">
          <div className="border-b border-slate-100 bg-gradient-to-br from-slate-950 via-blue-950 to-indigo-900 px-7 py-10 text-white sm:px-12">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-white/12 ring-1 ring-white/20">
              <BookOpen className="h-8 w-8" aria-hidden="true" />
            </div>
            <p className="mt-6 text-xs font-bold uppercase tracking-[0.18em] text-blue-200">AI-PPT Tutor Study</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight">Relational Model learning session</h1>
            <p className="mt-4 text-sm leading-6 text-blue-100/85">
              You may study for up to 25 minutes, inspect the original lecture and ask the tutor questions.
            </p>
          </div>
          <div className="px-7 py-8 sm:px-12">
            <div className="mx-auto grid max-w-lg gap-3 text-left sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Study ID</p>
                <p className="mt-1 font-mono text-sm font-bold text-slate-900">{studyId}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Learning time</p>
                <p className="mt-1 text-sm font-bold text-slate-900">Up to 25 minutes</p>
              </div>
            </div>
            <p className="mx-auto mt-6 max-w-lg text-sm leading-6 text-slate-600">
              Click Start Learning only when you are ready. The timer and interaction recording begin together; you may finish early when you have completed learning.
            </p>
            {error ? (
              <div role="alert" className="mt-5 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-left text-sm text-red-800">
                <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            ) : null}
            <button
              type="button"
              onClick={startLearning}
              disabled={starting}
              className="mt-7 inline-flex h-13 min-w-56 items-center justify-center gap-2 rounded-xl bg-blue-600 px-7 text-sm font-bold text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700 disabled:cursor-wait disabled:bg-blue-400"
            >
              {starting ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Play className="h-5 w-5 fill-current" aria-hidden="true" />}
              {starting ? "Starting…" : "Start Learning"}
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main onClickCapture={handleMeaningfulClick} className="flex h-screen min-h-[680px] flex-col overflow-hidden bg-[#edf1f6] text-slate-900">
      <div className="fixed inset-0 z-[90] hidden items-center justify-center bg-slate-950 p-6 text-center text-white max-lg:flex">
        <section className="max-w-md rounded-3xl border border-white/15 bg-white/10 p-8 backdrop-blur">
          <CircleAlert className="mx-auto h-10 w-10 text-amber-300" aria-hidden="true" />
          <h2 className="mt-4 text-xl font-bold">A larger display is required</h2>
          <p className="mt-3 text-sm leading-6 text-slate-200">
            This controlled study uses the lecture and tutor side by side. Please inform the researcher and use the designated experiment window.
          </p>
        </section>
      </div>
      <header className="flex h-[72px] shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 shadow-[0_1px_0_rgba(15,23,42,0.03)] sm:px-7">
        <div className="flex min-w-0 items-center gap-3.5">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-100">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-base font-bold tracking-tight sm:text-lg">AI-PPT Tutor Study</h1>
              <span className="hidden h-1 w-1 rounded-full bg-slate-300 sm:block" />
              <span className="hidden truncate text-sm text-slate-500 sm:block">DBI · The Relational Model</span>
            </div>
            <p className="mt-0.5 text-[11px] font-medium text-slate-500">
              <span className="font-mono">{studyId}</span>
              <span className="mx-2">·</span>
              {statusLabel}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          {active ? (
            <button
              type="button"
              data-study-action="open-finish-learning-confirmation"
              onClick={() => setShowFinishConfirmation(true)}
              aria-label="Finish Learning Early"
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-bold text-slate-600 shadow-sm transition hover:border-red-200 hover:bg-red-50 hover:text-red-700 focus:outline-none focus:ring-4 focus:ring-red-100"
            >
              <Flag className="h-4 w-4" aria-hidden="true" />
              Finish Learning Early
            </button>
          ) : null}
          <div className={`flex items-center gap-2 rounded-xl border px-3.5 py-2 tabular-nums ${timerUrgent ? "border-red-200 bg-red-50 text-red-700" : "border-slate-200 bg-slate-50 text-slate-800"}`} aria-label={`${remainingSeconds} seconds remaining`}>
            <Clock3 className={`h-4 w-4 ${timerUrgent ? "text-red-600" : "text-blue-600"}`} aria-hidden="true" />
            <span className="font-mono text-base font-bold tracking-wide">{formatTimer(remainingSeconds)}</span>
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(300px,1fr)]">
        <section className="flex min-h-0 min-w-0 flex-col border-r border-slate-200 bg-[#f7f9fc]" aria-label="Lecture explanation and conversation">
          <div ref={conversationRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-4xl space-y-5 pb-3">
              {messages.map((message, index) => message.role === "user" ? (
                <div key={message.id} className="ml-auto max-w-[80%] rounded-2xl rounded-br-md bg-slate-900 px-5 py-3.5 text-sm leading-6 text-white shadow-sm">
                  {message.content}
                </div>
              ) : (
                <StudyAnswerCard
                  key={message.id}
                  message={message}
                  initial={index === 0}
                  onCitationClick={handleCitationClick}
                />
              ))}
              {sending ? (
                <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-500 shadow-sm">
                  <LoaderCircle className="h-4 w-4 animate-spin text-blue-600" aria-hidden="true" />
                  The tutor is preparing a response…
                </div>
              ) : null}
              {error && active ? (
                <div role="alert" className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                  <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                  <div>
                    <p className="font-semibold">The response could not be completed.</p>
                    <p className="mt-1">{error} Please inform the researcher if the problem continues.</p>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="shrink-0 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-6 lg:px-8">
            <form onSubmit={sendQuestion} className="mx-auto max-w-4xl">
              <div className="flex items-end gap-3 rounded-2xl border border-slate-200 bg-white p-2.5 shadow-[0_10px_32px_rgba(15,23,42,0.08)] transition focus-within:border-blue-300 focus-within:ring-4 focus-within:ring-blue-50">
                <textarea
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  onFocus={() => {
                    if (!inputFocusedRef.current) {
                      inputFocusedRef.current = true;
                      void logEvent({ type: "chat_input_focused" });
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  disabled={!active || sending}
                  rows={2}
                  maxLength={2_000}
                  className="max-h-32 min-h-14 flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-6 text-slate-800 placeholder:text-slate-400 disabled:cursor-not-allowed"
                  placeholder="Ask a question about the lecture…"
                  aria-label="Ask a question about the lecture"
                />
                <button
                  type="submit"
                  data-study-action="send-question"
                  disabled={!active || sending || !question.trim()}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-600 text-white shadow-md shadow-blue-100 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
                  aria-label="Send question"
                >
                  {sending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </div>
              <p className="mt-2 text-center text-[11px] text-slate-400">
                AI-generated information may contain errors. Use the original lecture available in this interface as needed.
              </p>
            </form>
          </div>
        </section>

        <aside className="hidden min-h-0 min-w-0 lg:block" aria-label="Original lecture">
          <LectureViewer
            activeAnchor={activeAnchor}
            disabled={!active}
            onPageViewed={handlePageViewed}
            onAnchorRendered={handleAnchorRendered}
          />
        </aside>
      </div>

      {showFinishConfirmation && active ? (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/55 p-5 backdrop-blur-sm">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="finish-learning-title"
            aria-describedby="finish-learning-description"
            className="w-full max-w-md overflow-hidden rounded-[1.75rem] border border-white/20 bg-white shadow-[0_35px_100px_rgba(15,23,42,0.38)]"
          >
            <div className="border-b border-slate-100 bg-gradient-to-br from-slate-50 to-red-50/70 px-7 py-6">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-red-100 text-red-700">
                <Flag className="h-6 w-6" aria-hidden="true" />
              </div>
              <h2 id="finish-learning-title" className="mt-5 text-xl font-bold tracking-tight text-slate-950">
                Finish learning early?
              </h2>
              <p id="finish-learning-description" className="mt-2 text-sm leading-6 text-slate-600">
                This immediately stops the timer, locks the tutor and original lecture, and saves your current learning time. You cannot return to this learning session.
              </p>
            </div>
            <div className="flex justify-end gap-3 px-7 py-5">
              <button
                type="button"
                data-study-action="cancel-finish-learning"
                onClick={() => setShowFinishConfirmation(false)}
                className="h-11 rounded-xl border border-slate-200 bg-white px-5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-100"
              >
                Continue Learning
              </button>
              <button
                type="button"
                data-study-action="confirm-finish-learning-early"
                onClick={confirmEarlyCompletion}
                className="h-11 rounded-xl bg-red-600 px-5 text-sm font-bold text-white shadow-md shadow-red-200 transition hover:bg-red-700 focus:outline-none focus:ring-4 focus:ring-red-100"
              >
                Finish Now
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {ended ? (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/60 p-5 backdrop-blur-sm">
          <section className="w-full max-w-lg rounded-[2rem] border border-white/20 bg-white p-8 text-center shadow-[0_35px_100px_rgba(15,23,42,0.35)] sm:p-10">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-slate-100 text-slate-700">
              <LockKeyhole className="h-8 w-8" aria-hidden="true" />
            </div>
            <p className="mt-6 text-xs font-bold uppercase tracking-[0.18em] text-blue-600">Study session complete</p>
            <h2 className="mt-3 text-2xl font-bold tracking-tight">
              {endedEarly ? "You have finished learning." : "The learning time has ended."}
            </h2>
            <p className="mt-4 text-sm leading-6 text-slate-600">
              The tutor and original lecture are now locked. This session cannot be resumed.
            </p>
            <div className="mt-6 rounded-2xl border border-blue-100 bg-blue-50/70 p-5 text-left">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-700">Continue in this order</p>
              <ol className="mt-3 space-y-3 text-sm text-slate-700">
                <li className="flex gap-3">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-blue-600 text-xs font-bold text-white">1</span>
                  <span><strong>Form 3 — Unaided Quiz.</strong> Complete the quiz without using the tutor or lecture.</span>
                </li>
                <li className="flex gap-3">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-indigo-600 text-xs font-bold text-white">2</span>
                  <span><strong>Form 2 — Post-Learning Questionnaire.</strong> Complete it only after submitting Form 3.</span>
                </li>
              </ol>
            </div>
            <p className="mt-4 text-xs leading-5 text-slate-500">Please inform the researcher before continuing.</p>
            <div className={`mx-auto mt-5 inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-semibold ${
              finalizationStatus === "saved"
                ? "bg-emerald-50 text-emerald-700"
                : finalizationStatus === "retrying"
                  ? "bg-amber-50 text-amber-800"
                  : "bg-blue-50 text-blue-700"
            }`} role="status">
              {finalizationStatus === "saved" ? (
                "Research record saved"
              ) : (
                <>
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  {finalizationStatus === "retrying" ? "Retrying secure save…" : "Securing research record…"}
                </>
              )}
            </div>
            {finalizationStatus === "retrying" && error ? (
              <p className="mt-3 text-xs leading-5 text-amber-700">{error} Keep this page open; saving will retry automatically.</p>
            ) : null}
          </section>
        </div>
      ) : null}

      {technicalFailure && !ended && session.status === "active" ? (
        <div className="pointer-events-none fixed bottom-24 left-1/2 z-40 -translate-x-1/2 rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-800 shadow-lg">
          A technical issue has been recorded.
        </div>
      ) : null}
    </main>
  );
}
