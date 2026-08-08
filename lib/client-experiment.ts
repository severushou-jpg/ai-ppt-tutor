import type {
  ExperimentCondition,
  ExperimentEvent,
  ExperimentEventName,
  ExperimentSessionMetadata,
} from "@/app/types";

const DATABASE_NAME = "ai-ppt-tutor-experiment";
const DATABASE_VERSION = 1;
const EVENTS_STORE = "events";
const SESSION_KEY = "ai-ppt-tutor-rq1-session-v1";

function createId(prefix: string) {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${id}`;
}

function safeParticipantId(value?: string) {
  const normalized = String(value ?? "").trim().replace(/[^a-z0-9_-]/gi, "").slice(0, 64);
  return normalized || `P-${createId("").replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase()}`;
}

export function createExperimentSession(
  condition: ExperimentCondition = "full_evidence",
  participantId?: string,
): ExperimentSessionMetadata {
  return {
    participantId: safeParticipantId(participantId),
    sessionId: createId("session"),
    condition,
    materialVersion: "unassigned",
    startedAt: Date.now(),
  };
}

export function loadExperimentSession(): ExperimentSessionMetadata {
  if (typeof sessionStorage === "undefined") return createExperimentSession();
  try {
    const parsed = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null") as ExperimentSessionMetadata | null;
    if (
      parsed &&
      typeof parsed.participantId === "string" &&
      typeof parsed.sessionId === "string" &&
      ["full_evidence", "baseline"].includes(parsed.condition)
    ) {
      return { ...parsed, materialVersion: parsed.materialVersion || "unassigned" };
    }
  } catch {
    // A corrupt session is replaced with a fresh anonymous session.
  }
  const created = createExperimentSession();
  saveExperimentSession(created);
  return created;
}

export function saveExperimentSession(session: ExperimentSessionMetadata) {
  if (typeof sessionStorage !== "undefined") sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(EVENTS_STORE)) {
        const store = request.result.createObjectStore(EVENTS_STORE, { keyPath: "eventId" });
        store.createIndex("timestamp", "timestamp");
        store.createIndex("sessionId", "sessionId");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function logExperimentEvent(
  session: ExperimentSessionMetadata,
  event: ExperimentEventName,
  data: ExperimentEvent["data"] = {},
) {
  const record: ExperimentEvent = {
    eventId: createId("event"),
    event,
    timestamp: Date.now(),
    participantId: safeParticipantId(session.participantId),
    sessionId: session.sessionId,
    condition: session.condition,
    materialVersion: session.materialVersion,
    data,
  };
  const database = await openDatabase();
  if (!database) return record;
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(EVENTS_STORE, "readwrite");
    transaction.objectStore(EVENTS_STORE).put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  database.close();
  return record;
}

export async function listExperimentEvents(): Promise<ExperimentEvent[]> {
  const database = await openDatabase();
  if (!database) return [];
  const records = await new Promise<ExperimentEvent[]>((resolve, reject) => {
    const request = database.transaction(EVENTS_STORE, "readonly").objectStore(EVENTS_STORE).getAll();
    request.onsuccess = () => resolve(request.result as ExperimentEvent[]);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return records.sort((left, right) => left.timestamp - right.timestamp);
}

function csvCell(value: unknown) {
  const text = value == null ? "" : typeof value === "string" ? value : JSON.stringify(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function experimentEventsToCsv(events: ExperimentEvent[]) {
  const headers = [
    "event_id", "timestamp_iso", "participant_id", "session_id", "condition",
    "material_version", "event", "data_json",
  ];
  const rows = events.map((event) => [
    event.eventId,
    new Date(event.timestamp).toISOString(),
    event.participantId,
    event.sessionId,
    event.condition,
    event.materialVersion,
    event.event,
    event.data,
  ]);
  return [headers.map(csvCell).join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\n");
}

export async function downloadExperimentEvents(format: "json" | "csv") {
  const events = await listExperimentEvents();
  const content = format === "json" ? JSON.stringify({ schemaVersion: 1, events }, null, 2) : experimentEventsToCsv(events);
  const blob = new Blob([content], { type: format === "json" ? "application/json" : "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `ai-ppt-tutor-rq1-events-${new Date().toISOString().slice(0, 10)}.${format}`;
  anchor.click();
  URL.revokeObjectURL(url);
  return events.length;
}
