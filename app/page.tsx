"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import {
  BookOpen,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  FileCheck2,
  FileText,
  FolderOpen,
  GraduationCap,
  Highlighter,
  Layers3,
  LoaderCircle,
  Menu,
  MessageCircleQuestion,
  PanelRightClose,
  PanelRightOpen,
  RefreshCcw,
  RotateCcw,
  Search,
  Send,
  ShieldQuestion,
  Sparkles,
  Square,
  ThumbsDown,
  ThumbsUp,
  UploadCloud,
  X,
} from "lucide-react";
import type {
  ApiError,
  ChatMessage,
  CitationSource,
  DocumentIndex,
  LearningMode,
  RetrievalMetadata,
  StructuredAnswer,
  UploadPhase,
} from "./types";
import { clearWorkspace, loadWorkspace, saveWorkspace } from "@/lib/client-storage";

const MAX_FILE_BYTES = 20 * 1024 * 1024;

const MODES: Record<
  LearningMode,
  {
    label: string;
    shortLabel: string;
    description: string;
    icon: typeof BookOpen;
    accent: string;
    suggestions: string[];
  }
> = {
  explain: {
    label: "深入讲解",
    shortLabel: "讲解",
    description: "目标、例子、易错点与自检",
    icon: GraduationCap,
    accent: "bg-blue-50 text-blue-700 border-blue-200",
    suggestions: ["请先概览这份课件的知识结构。", "从零开始讲解第一个核心概念。"],
  },
  qa: {
    label: "课件问答",
    shortLabel: "问答",
    description: "只依据材料回答并标注来源",
    icon: MessageCircleQuestion,
    accent: "bg-violet-50 text-violet-700 border-violet-200",
    suggestions: ["这份课件最重要的结论是什么？", "解释课件中的关键术语，并给出来源。"],
  },
  quiz: {
    label: "生成练习",
    shortLabel: "练习",
    description: "带答案、解析和课件依据",
    icon: FileCheck2,
    accent: "bg-emerald-50 text-emerald-700 border-emerald-200",
    suggestions: ["根据当前课件生成 5 道练习题。", "出一组从基础到应用的复习题。"],
  },
  review: {
    label: "复习总结",
    shortLabel: "复习",
    description: "重点、混淆点与复习顺序",
    icon: Layers3,
    accent: "bg-amber-50 text-amber-800 border-amber-200",
    suggestions: ["生成一份考前复习提纲。", "整理高频重点和容易混淆的内容。"],
  },
};

const UPLOAD_COPY: Record<UploadPhase, { title: string; detail: string }> = {
  idle: { title: "等待上传", detail: "支持 PDF / PPTX，最大 20MB" },
  uploading: { title: "正在上传课件", detail: "请保持页面打开" },
  parsing: { title: "正在解析文字与结构", detail: "按页或幻灯片保留来源" },
  indexing: { title: "正在建立课件索引", detail: "马上就可以开始学习" },
  ready: { title: "课件已准备好", detail: "现在可以讲解、问答或练习" },
  error: { title: "课件处理失败", detail: "请根据提示重试" },
};

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function citationMarkdown(content: string) {
  return content.replace(/\[来源\s*(\d+)\]/g, "[来源$1](#source-$1)");
}

function MessageCard({
  message,
  onCitationClick,
  onFeedback,
}: {
  message: ChatMessage;
  onCitationClick: (sourceId: number, sources: CitationSource[]) => void;
  onFeedback: (messageId: string, feedback: "helpful" | "inaccurate") => void;
}) {
  const [showAnswers, setShowAnswers] = useState(false);
  if (message.role === "user") {
    return (
      <div className="ml-auto max-w-2xl rounded-2xl rounded-br-md bg-slate-900 px-5 py-3.5 text-sm leading-6 text-white shadow-sm">
        {message.content}
      </div>
    );
  }

  const mode = MODES[message.mode];
  const Icon = message.refused ? ShieldQuestion : mode.icon;
  const cardStyle = message.refused
    ? "border-slate-200 bg-slate-50"
    : "border-slate-200 bg-white";

  return (
    <article className={`max-w-3xl overflow-hidden rounded-2xl border shadow-sm ${cardStyle}`}>
      <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className={`flex h-8 w-8 items-center justify-center rounded-lg border ${mode.accent}`}>
            <Icon size={16} aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              {message.refused ? "课件中未找到依据" : mode.label}
            </h2>
            <p className="text-xs text-slate-500">
              {message.refused ? "系统没有使用课外内容猜测" : mode.description}
            </p>
          </div>
        </div>
        {message.grounded && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
            <CheckCircle2 size={12} aria-hidden="true" /> 已关联课件
          </span>
        )}
      </header>
      {message.mode === "quiz" && message.structured?.quiz.length ? (
        <div className="space-y-4 px-5 py-5 text-sm text-slate-700">
          <div className="space-y-3">
            {message.structured.quiz.map((item, index) => (
              <div key={`${message.id}-quiz-${index}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-500">{item.difficulty}</span>
                    <p className="mt-2 leading-6 text-slate-800">{item.question}</p>
                    {showAnswers && (
                      <div className="mt-3 border-t border-slate-200 pt-3">
                        <p><strong>答案：</strong>{item.answer}</p>
                        <p className="mt-2 leading-6"><strong>解析：</strong>{item.explanation}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {item.citations.map((sourceId) => (
                            <button key={sourceId} type="button" className="citation-chip" onClick={() => onCitationClick(sourceId, message.sources ?? [])}>来源{sourceId}</button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setShowAnswers((current) => !current)} className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100">
            <ChevronDown size={14} className={`transition ${showAnswers ? "rotate-180" : ""}`} />
            {showAnswers ? "收起答案与解析" : "显示答案与解析"}
          </button>
          {message.structured.partialRefusal && (
            <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
              {message.structured.partialRefusal}
            </p>
          )}
        </div>
      ) : (
        <div className="markdown-body px-5 py-5 text-sm leading-7 text-slate-700">
          <ReactMarkdown
            components={{
              a: ({ href, children }) => {
                const match = href?.match(/^#source-(\d+)$/);
                if (match) {
                  const sourceId = Number(match[1]);
                  return (
                    <button type="button" className="citation-chip" onClick={() => onCitationClick(sourceId, message.sources ?? [])} aria-label={`查看来源 ${sourceId}`}>
                      {children}
                    </button>
                  );
                }
                return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
              },
            }}
          >
            {citationMarkdown(message.content)}
          </ReactMarkdown>
        </div>
      )}
      {!!message.sources?.length && (
        <footer className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-3">
          <span className="text-xs font-medium text-slate-500">引用</span>
          {message.sources.map((source) => (
            <button
              key={`${message.id}-${source.id}`}
              type="button"
              onClick={() => onCitationClick(source.id, message.sources ?? [])}
              className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-blue-300 hover:text-blue-700"
            >
              {source.id} · {source.label}
            </button>
          ))}
        </footer>
      )}
      <div className="flex items-center justify-between border-t border-slate-100 px-5 py-2.5">
        <span className="text-[11px] text-slate-400">
          {message.retrieval?.mode === "hybrid" ? "关键词＋语义检索" : "关键词检索"}
          {message.retrieval?.reranked ? " · 已重排序" : ""}
        </span>
        <div className="flex items-center gap-1" aria-label="回答反馈">
          <button type="button" onClick={() => onFeedback(message.id, "helpful")} aria-label="回答有帮助" className={`rounded-lg p-1.5 transition ${message.feedback === "helpful" ? "bg-emerald-50 text-emerald-700" : "text-slate-400 hover:bg-slate-50 hover:text-slate-700"}`}><ThumbsUp size={14} /></button>
          <button type="button" onClick={() => onFeedback(message.id, "inaccurate")} aria-label="回答不准确" className={`rounded-lg p-1.5 transition ${message.feedback === "inaccurate" ? "bg-red-50 text-red-700" : "text-slate-400 hover:bg-slate-50 hover:text-slate-700"}`}><ThumbsDown size={14} /></button>
        </div>
      </div>
    </article>
  );
}

function HighlightedExcerpt({ source }: { source: CitationSource }) {
  const highlight = source.highlight?.trim();
  const index = highlight ? source.excerpt.indexOf(highlight) : -1;
  if (!highlight || index < 0) return <>{source.excerpt}</>;
  return (
    <>
      {source.excerpt.slice(0, index)}
      <mark className="rounded bg-amber-200/80 px-0.5 text-slate-800">{highlight}</mark>
      {source.excerpt.slice(index + highlight.length)}
    </>
  );
}

function SourcePanel({
  sources,
  selectedSourceId,
  onSelect,
  onClose,
}: {
  sources: CitationSource[];
  selectedSourceId: number | null;
  onSelect: (sourceId: number) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 px-5 py-5">
        <div className="flex items-center justify-between gap-3 text-slate-900">
          <div className="flex items-center gap-2">
            <Highlighter size={18} className="text-blue-600" aria-hidden="true" />
            <h2 className="font-semibold">课件依据</h2>
          </div>
          <button type="button" onClick={onClose} className="hidden rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 lg:block" aria-label="收起来源栏"><PanelRightClose size={17} /></button>
        </div>
        <p className="mt-1 text-xs leading-5 text-slate-500">点击回答中的来源标记，可在这里查看对应原文片段。</p>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {sources.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center text-slate-400">
            <Search size={28} strokeWidth={1.5} aria-hidden="true" />
            <p className="mt-3 text-sm font-medium text-slate-500">暂无引用</p>
            <p className="mt-1 text-xs leading-5">完成一次讲解或问答后，相关课件片段会显示在这里。</p>
          </div>
        ) : (
          sources.map((source) => {
            const selected = source.id === selectedSourceId;
            return (
              <button
                key={`${source.chunkId}-${source.id}`}
                id={`source-panel-${source.id}`}
                type="button"
                onClick={() => onSelect(source.id)}
                className={`w-full rounded-xl border p-4 text-left transition ${
                  selected
                    ? "border-blue-300 bg-blue-50 shadow-sm"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700">
                    <FileText size={13} aria-hidden="true" /> 来源 {source.id}
                  </span>
                  <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                    {source.label}
                  </span>
                </div>
                {source.title && <p className="mt-3 truncate text-xs font-semibold text-slate-700">{source.title}</p>}
                <p className="mt-2 line-clamp-8 text-xs leading-5 text-slate-600"><HighlightedExcerpt source={source} /></p>
                <p className="mt-3 truncate text-[11px] text-slate-400">{source.fileName}</p>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [documentIndex, setDocumentIndex] = useState<DocumentIndex | null>(null);
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadDetail, setUploadDetail] = useState<{ current: number; total: number | null; message: string } | null>(null);
  const [uploadError, setUploadError] = useState<ApiError | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [mode, setMode] = useState<LearningMode>("explain");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [activeSources, setActiveSources] = useState<CitationSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<number | null>(null);
  const [mobileTab, setMobileTab] = useState<"files" | "learn" | "sources">("learn");
  const [sourcePanelOpen, setSourcePanelOpen] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const uploadRequestRef = useRef<XMLHttpRequest | null>(null);
  const generationControllerRef = useRef<AbortController | null>(null);
  const lastUploadFileRef = useRef<File | null>(null);

  const activeMode = MODES[mode];
  const uploadBusy = ["uploading", "parsing", "indexing"].includes(uploadPhase);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  useEffect(() => {
    return () => {
      uploadRequestRef.current?.abort();
      generationControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadWorkspace()
      .then((snapshot) => {
        if (cancelled || !snapshot || snapshot.version !== 1) return;
        setDocumentIndex(snapshot.documentIndex);
        setMessages(snapshot.messages);
        setMode(snapshot.mode);
        if (snapshot.documentIndex) setUploadPhase("ready");
        const latestAssistant = [...snapshot.messages].reverse().find((message) => message.role === "assistant");
        setActiveSources(latestAssistant?.sources ?? []);
        setSelectedSourceId(latestAssistant?.sources?.[0]?.id ?? null);
      })
      .catch((error) => console.error("Workspace restore failed", error))
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      void saveWorkspace({
        version: 1,
        documentIndex,
        messages,
        mode,
        savedAt: Date.now(),
      }).catch((error) => console.error("Workspace persistence failed", error));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [documentIndex, hydrated, messages, mode]);

  const recentHistory = useMemo(
    () =>
      messages.slice(-10).map(({ role, content }) => ({
        role,
        content,
      })),
    [messages],
  );

  const cancelUpload = () => {
    uploadRequestRef.current?.abort();
    uploadRequestRef.current = null;
    setUploadPhase(documentIndex ? "ready" : "idle");
    setUploadProgress(0);
    setUploadDetail(null);
  };

  const processDocument = (file: File) => {
    lastUploadFileRef.current = file;
    const extension = file.name.toLowerCase().split(".").pop();
    if (!extension || !["pdf", "pptx"].includes(extension)) {
      setUploadError({ code: "UNSUPPORTED_FORMAT", message: "暂不支持该格式，请上传 PDF 或 PPTX。" });
      setUploadPhase("error");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setUploadError({ code: "FILE_TOO_LARGE", message: "文件超过 20MB 限制，请压缩后重试。" });
      setUploadPhase("error");
      return;
    }

    setUploadError(null);
    setRequestError(null);
    setUploadProgress(0);
    setUploadDetail(null);
    setUploadPhase("uploading");
    const formData = new FormData();
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    let responseOffset = 0;
    let responseBuffer = "";
    let receivedTerminalEvent = false;
    uploadRequestRef.current = xhr;
    xhr.open("POST", "/api/documents");
    xhr.setRequestHeader("Accept", "application/x-ndjson");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) setUploadProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.upload.onload = () => {
      setUploadProgress(100);
      setUploadPhase("parsing");
      setUploadProgress(0);
    };
    xhr.onerror = () => {
      setUploadError({ code: "NETWORK_ERROR", message: "上传失败，请检查网络连接后重试。" });
      setUploadPhase("error");
      uploadRequestRef.current = null;
    };
    xhr.onabort = () => {
      uploadRequestRef.current = null;
    };

    const applyStreamEvent = (event: {
      type?: "progress" | "complete" | "error";
      phase?: "parsing" | "indexing" | "embedding";
      current?: number;
      total?: number | null;
      message?: string;
      document?: DocumentIndex;
      error?: ApiError;
    }) => {
      if (event.type === "progress" && event.phase) {
        const phase = event.phase === "parsing" ? "parsing" : "indexing";
        const current = Number(event.current ?? 0);
        const total = event.total == null ? null : Number(event.total);
        setUploadPhase(phase);
        setUploadDetail({ current, total, message: event.message ?? UPLOAD_COPY[phase].detail });
        setUploadProgress(total && total > 0 ? Math.round((current / total) * 100) : 0);
      } else if (event.type === "complete" && event.document) {
        receivedTerminalEvent = true;
        lastUploadFileRef.current = null;
        setDocumentIndex(event.document);
        setMessages([]);
        setActiveSources([]);
        setSelectedSourceId(null);
        setUploadDetail(null);
        setUploadProgress(100);
        setUploadPhase("ready");
        setMobileTab("learn");
      } else if (event.type === "error") {
        receivedTerminalEvent = true;
        setUploadError(event.error ?? { code: "UPLOAD_FAILED", message: "课件处理失败，请稍后重试。" });
        setUploadPhase("error");
      }
    };

    const consumeResponse = (final = false) => {
      const nextText = xhr.responseText.slice(responseOffset);
      responseOffset = xhr.responseText.length;
      responseBuffer += nextText;
      const lines = responseBuffer.split("\n");
      const remainder = lines.pop() ?? "";
      responseBuffer = final ? "" : remainder;
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          applyStreamEvent(JSON.parse(line));
        } catch {
          if (final) setUploadError({ code: "INVALID_RESPONSE", message: "服务器返回了无法识别的处理结果。" });
        }
      }
      if (final && remainder.trim()) {
        try {
          applyStreamEvent(JSON.parse(remainder));
        } catch {
          setUploadError({ code: "INVALID_RESPONSE", message: "服务器返回了无法识别的处理结果。" });
        }
      }
    };

    xhr.onprogress = () => consumeResponse(false);
    xhr.onload = () => {
      uploadRequestRef.current = null;
      if (xhr.status < 200 || xhr.status >= 300) {
        try {
          const response = JSON.parse(xhr.responseText) as { error?: ApiError };
          setUploadError(response.error ?? { code: "UPLOAD_FAILED", message: "课件处理失败，请稍后重试。" });
        } catch {
          setUploadError({ code: "UPLOAD_FAILED", message: "课件处理失败，请稍后重试。" });
        }
        setUploadPhase("error");
        return;
      }
      consumeResponse(true);
      if (!receivedTerminalEvent) {
        setUploadError({ code: "INCOMPLETE_RESPONSE", message: "课件处理未完成，请重试。" });
        setUploadPhase("error");
      }
    };
    xhr.send(formData);
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) processDocument(file);
  };

  const askAI = async (customText?: string) => {
    const question = (customText ?? input).trim();
    if (!question || !documentIndex || loading) return;

    const userMessage: ChatMessage = {
      id: createId(),
      role: "user",
      content: question,
      mode,
    };
    setMessages((current) => [...current, userMessage]);
    setInput("");
    setRequestError(null);
    setLoading(true);
    const controller = new AbortController();
    generationControllerRef.current = controller;

    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          mode,
          document: documentIndex,
          history: recentHistory,
        }),
        signal: controller.signal,
      });
      const data = (await response.json()) as {
        content?: string;
        grounded?: boolean;
        refused?: boolean;
        sources?: CitationSource[];
        structured?: StructuredAnswer;
        retrieval?: RetrievalMetadata;
        error?: ApiError;
      };
      if (!response.ok || data.error || !data.content) {
        throw new Error(data.error?.message ?? "生成失败，请稍后重试。");
      }

      const assistantMessage: ChatMessage = {
        id: createId(),
        role: "assistant",
        content: data.content,
        mode,
        grounded: data.grounded,
        refused: data.refused,
        sources: data.sources ?? [],
        structured: data.structured,
        retrieval: data.retrieval,
      };
      setMessages((current) => [...current, assistantMessage]);
      setActiveSources(assistantMessage.sources ?? []);
      setSelectedSourceId(assistantMessage.sources?.[0]?.id ?? null);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setMessages((current) => [
          ...current,
          {
            id: createId(),
            role: "assistant",
            content: "生成已停止。你可以修改问题或切换学习模式后重试。",
            mode,
            grounded: false,
          },
        ]);
      } else {
        setRequestError(error instanceof Error ? error.message : "生成失败，请稍后重试。");
      }
    } finally {
      if (generationControllerRef.current === controller) generationControllerRef.current = null;
      setLoading(false);
    }
  };

  const stopGeneration = () => {
    generationControllerRef.current?.abort();
  };

  const handleCitationClick = (sourceId: number, sources: CitationSource[]) => {
    setActiveSources(sources);
    setSelectedSourceId(sourceId);
    setMobileTab("sources");
    setSourcePanelOpen(true);
    window.setTimeout(() => {
      document.getElementById(`source-panel-${sourceId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  };

  const clearConversation = () => {
    if (messages.length > 0 && !window.confirm("确定清空当前学习记录吗？此操作无法撤销。")) return;
    setMessages([]);
    setActiveSources([]);
    setSelectedSourceId(null);
    setRequestError(null);
  };

  const removeDocument = () => {
    if (messages.length > 0 && !window.confirm("移除课件会同时清空当前学习记录，确定继续吗？")) return;
    setDocumentIndex(null);
    setMessages([]);
    setActiveSources([]);
    setSelectedSourceId(null);
    setUploadError(null);
    setUploadPhase("idle");
    setMobileTab("files");
    void clearWorkspace();
  };

  const handleFeedback = (messageId: string, feedback: "helpful" | "inaccurate") => {
    setMessages((current) => current.map((message) =>
      message.id === messageId
        ? { ...message, feedback: message.feedback === feedback ? undefined : feedback }
        : message,
    ));
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void askAI();
    }
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-slate-100 text-slate-900 lg:flex-row">
      <nav className="grid grid-cols-3 border-b border-slate-200 bg-white p-2 lg:hidden" aria-label="移动端工作区导航">
        {([
          ["files", FolderOpen, "文件"],
          ["learn", BookOpen, "学习"],
          ["sources", Highlighter, "引用"],
        ] as const).map(([tab, Icon, label]) => (
          <button
            key={tab}
            type="button"
            onClick={() => setMobileTab(tab)}
            className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${
              mobileTab === tab ? "bg-blue-50 text-blue-700" : "text-slate-500"
            }`}
          >
            <Icon size={16} aria-hidden="true" /> {label}
          </button>
        ))}
      </nav>

      <aside
        className={`${mobileTab === "files" ? "flex" : "hidden"} h-full w-full flex-col border-r border-slate-200 bg-white lg:flex lg:w-64 lg:shrink-0`}
      >
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm shadow-blue-200">
            <Brain size={22} aria-hidden="true" />
          </span>
          <div>
            <p className="font-semibold tracking-tight text-slate-950">AI PPT Tutor</p>
            <p className="text-xs text-slate-500">基于课件的学习工作区</p>
          </div>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-4">
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">课件文件</h2>
              {documentIndex && (
                <button type="button" onClick={removeDocument} className="text-xs text-slate-400 hover:text-red-600">
                  移除
                </button>
              )}
            </div>

            <label
              className={`block cursor-pointer rounded-2xl border-2 border-dashed p-4 transition ${
                dragging
                  ? "border-blue-400 bg-blue-50"
                  : uploadError
                    ? "border-red-200 bg-red-50"
                    : "border-slate-200 bg-slate-50 hover:border-blue-300 hover:bg-blue-50/50"
              }`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
            >
              <input
                type="file"
                className="sr-only"
                accept=".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                disabled={uploadBusy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) processDocument(file);
                  event.target.value = "";
                }}
              />
              <div className="flex items-start gap-3">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${uploadError ? "bg-red-100 text-red-600" : "bg-white text-blue-600 shadow-sm"}`}>
                  {uploadBusy ? <LoaderCircle size={18} className="animate-spin" /> : <UploadCloud size={18} />}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{UPLOAD_COPY[uploadPhase].title}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{uploadError?.message ?? uploadDetail?.message ?? UPLOAD_COPY[uploadPhase].detail}</p>
                </div>
              </div>
              {uploadBusy && (
                <div className="mt-4">
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-full rounded-full bg-blue-600 transition-all ${uploadPhase !== "uploading" && !uploadDetail?.total ? "animate-pulse" : ""}`}
                      style={{ width: `${uploadPhase === "uploading" || uploadDetail?.total ? uploadProgress : 100}%` }}
                    />
                  </div>
                  <button type="button" onClick={(event) => { event.preventDefault(); cancelUpload(); }} className="mt-3 text-xs font-medium text-slate-500 hover:text-red-600">
                    取消处理
                  </button>
                </div>
              )}
              {uploadPhase === "error" && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (lastUploadFileRef.current) processDocument(lastUploadFileRef.current);
                  }}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold text-red-700 shadow-sm hover:bg-red-100"
                >
                  <RefreshCcw size={13} /> 重试上次文件
                </button>
              )}
            </label>

            {documentIndex && uploadPhase === "ready" && (
              <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <div className="flex items-start gap-2.5">
                  <FileCheck2 size={17} className="mt-0.5 shrink-0 text-emerald-700" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-emerald-900" title={documentIndex.name}>{documentIndex.name}</p>
                    <p className="mt-1 text-xs text-emerald-700">
                      {documentIndex.sectionCount} 个来源 · {documentIndex.chunkCount} 个索引片段 · {formatBytes(documentIndex.size)}
                    </p>
                    <p className="mt-1 text-[11px] text-emerald-700/80">
                      {documentIndex.retrievalMode === "hybrid" ? "语义＋关键词混合索引" : "关键词索引（语义服务已降级）"}
                    </p>
                    {documentIndex.truncated && <p className="mt-2 text-xs text-amber-700">课件较长，已在安全上限内建立索引。</p>}
                  </div>
                </div>
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">学习模式</h2>
            <div className="space-y-1.5">
              {(Object.entries(MODES) as [LearningMode, (typeof MODES)[LearningMode]][]).map(([key, item]) => {
                const Icon = item.icon;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => { setMode(key); setMobileTab("learn"); }}
                    className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                      mode === key ? item.accent : "border-transparent text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <Icon size={17} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{item.label}</span>
                      <span className="block truncate text-[11px] opacity-75">{item.description}</span>
                    </span>
                    <ChevronRight size={14} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        <div className="border-t border-slate-100 p-4">
          <button
            type="button"
            onClick={clearConversation}
            disabled={messages.length === 0}
            className="flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-slate-500 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw size={15} aria-hidden="true" /> 清空学习记录
          </button>
        </div>
      </aside>

      <main className={`${mobileTab === "learn" ? "flex" : "hidden"} min-w-0 flex-1 flex-col bg-[#f7f9fc] lg:flex`}>
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 lg:px-7">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
              <BookOpen size={13} aria-hidden="true" /> 学习工作区
            </div>
            <h1 className="mt-1 truncate text-base font-semibold text-slate-950">
              {documentIndex?.name ?? "上传课件后开始学习"}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <span className={`hidden items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold sm:inline-flex ${activeMode.accent}`}>
              <activeMode.icon size={14} aria-hidden="true" /> {activeMode.label}
            </span>
            <button
              type="button"
              onClick={() => setSourcePanelOpen((current) => !current)}
              className="hidden rounded-lg border border-slate-200 p-2 text-slate-500 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 lg:block"
              aria-label={sourcePanelOpen ? "收起来源栏" : "展开来源栏"}
            >
              {sourcePanelOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full max-w-4xl flex-col px-4 py-6 sm:px-6 lg:py-8">
            {!documentIndex ? (
              <div className="flex flex-1 flex-col items-center justify-center text-center">
                <span className="flex h-16 w-16 items-center justify-center rounded-2xl border border-blue-100 bg-blue-50 text-blue-600">
                  <UploadCloud size={28} strokeWidth={1.8} aria-hidden="true" />
                </span>
                <h2 className="mt-5 text-xl font-semibold tracking-tight text-slate-900">先添加一份课件</h2>
                <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                  系统会按页或幻灯片建立索引。之后的讲解、回答和练习都会显示课件来源。
                </p>
                <button type="button" onClick={() => setMobileTab("files")} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 lg:hidden">
                  <Menu size={16} /> 打开文件面板
                </button>
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
                <span className={`flex h-14 w-14 items-center justify-center rounded-2xl border ${activeMode.accent}`}>
                  <activeMode.icon size={25} aria-hidden="true" />
                </span>
                <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">{activeMode.shortLabel}模式</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{activeMode.label}</h2>
                <p className="mt-2 max-w-lg text-sm leading-6 text-slate-500">{activeMode.description}。回答会优先显示可核查的课件来源。</p>
                <div className="mt-7 grid w-full max-w-2xl gap-3 sm:grid-cols-2">
                  {activeMode.suggestions.map((suggestion) => (
                    <button key={suggestion} type="button" onClick={() => void askAI(suggestion)} className="group flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 text-left text-sm font-medium leading-6 text-slate-700 shadow-sm transition hover:border-blue-300 hover:shadow-md">
                      <span>{suggestion}</span>
                      <Sparkles size={16} className="shrink-0 text-blue-500 transition group-hover:rotate-6" />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-5 pb-6">
                {messages.map((message) => (
                  <MessageCard key={message.id} message={message} onCitationClick={handleCitationClick} onFeedback={handleFeedback} />
                ))}
                {loading && (
                  <div className="max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-live="polite">
                    <div className="flex items-center gap-3">
                      <LoaderCircle size={18} className="animate-spin text-blue-600" />
                      <div>
                        <p className="text-sm font-semibold text-slate-800">正在检索课件并生成{activeMode.shortLabel}</p>
                        <p className="mt-1 text-xs text-slate-500">只会使用与当前问题相关的课件片段。</p>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={scrollRef} />
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-slate-200 bg-white px-4 py-4 sm:px-6">
          <div className="mx-auto max-w-4xl">
            {requestError && (
              <div className="mb-3 flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
                <span className="flex items-start gap-2"><CircleAlert size={16} className="mt-0.5 shrink-0" />{requestError}</span>
                <button type="button" onClick={() => setRequestError(null)} aria-label="关闭错误提示"><X size={15} /></button>
              </div>
            )}
            <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_8px_30px_rgba(15,23,42,0.08)] focus-within:border-blue-300 focus-within:ring-4 focus-within:ring-blue-50">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleInputKeyDown}
                disabled={!documentIndex || loading}
                rows={2}
                maxLength={2000}
                placeholder={documentIndex ? `在${activeMode.shortLabel}模式下输入问题…` : "请先上传课件"}
                className="max-h-36 min-h-14 w-full resize-none bg-transparent px-3 py-2 text-sm leading-6 text-slate-800 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
                aria-label="学习问题"
              />
              <div className="flex items-center justify-between gap-3 px-2 pb-1">
                <p className="text-[11px] text-slate-400">Enter 发送 · Shift+Enter 换行</p>
                {loading ? (
                  <button type="button" onClick={stopGeneration} className="inline-flex h-9 items-center gap-2 rounded-xl bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-700">
                    <Square size={13} fill="currentColor" /> 停止
                  </button>
                ) : (
                  <button type="button" onClick={() => void askAI()} disabled={!documentIndex || !input.trim()} className="inline-flex h-9 items-center gap-2 rounded-xl bg-blue-600 px-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400">
                    <Send size={15} /> 发送
                  </button>
                )}
              </div>
            </div>
            <p className="mt-2 text-center text-[11px] text-slate-400">AI 可能出错，请通过引用核对课件原文。</p>
          </div>
        </div>
      </main>

      <aside className={`${mobileTab === "sources" ? "block" : "hidden"} h-full w-full shrink-0 border-l border-slate-200 bg-white ${sourcePanelOpen ? "lg:block lg:w-80" : "lg:hidden"}`}>
        <SourcePanel sources={activeSources} selectedSourceId={selectedSourceId} onSelect={setSelectedSourceId} onClose={() => setSourcePanelOpen(false)} />
      </aside>
    </div>
  );
}
