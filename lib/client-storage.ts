import type {
  ApiError,
  ChatMessage,
  DocumentIndex,
  LearningMode,
  OcrMode,
  StudyProgress,
  UploadPhase,
} from "@/app/types";
import type { OcrManifest } from "@/lib/client-ocr/types";

const DATABASE_NAME = "ai-ppt-tutor";
const DATABASE_VERSION = 2;
const LEGACY_STORE_NAME = "workspace";
const WORKSPACES_STORE = "workspaces";
const DOCUMENTS_STORE = "documents";
const JOBS_STORE = "processing-jobs";
const META_STORE = "meta";
const ACTIVE_WORKSPACE_KEY = "active-workspace-id";

export interface WorkspaceSnapshot {
  version: 2;
  id: string;
  fingerprint: string;
  documentIndex: DocumentIndex;
  messages: ChatMessage[];
  mode: LearningMode;
  ocrMode: OcrMode;
  progress: StudyProgress;
  createdAt: number;
  savedAt: number;
}

export interface WorkspaceSummary {
  id: string;
  fingerprint: string;
  name: string;
  mastery: StudyProgress["mastery"];
  messageCount: number;
  savedAt: number;
}

export interface CachedDocument {
  fingerprint: string;
  documentIndex: DocumentIndex;
  ocrMode: OcrMode;
  cachedAt: number;
}

export interface ProcessingJob {
  version: 1;
  id: string;
  fingerprint: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  fileBlob: Blob;
  ocrMode: OcrMode;
  phase: UploadPhase;
  status: "processing" | "paused" | "failed";
  progress: number;
  current: number;
  total: number | null;
  message: string;
  startedAt: number;
  updatedAt: number;
  ocrManifest?: OcrManifest;
  checkpointStage?: "parsed" | "vision";
  documentCheckpoint?: DocumentIndex;
  error?: ApiError;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = (event) => {
      const database = request.result;
      if (!database.objectStoreNames.contains(WORKSPACES_STORE)) {
        database.createObjectStore(WORKSPACES_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(DOCUMENTS_STORE)) {
        database.createObjectStore(DOCUMENTS_STORE, { keyPath: "fingerprint" });
      }
      if (!database.objectStoreNames.contains(JOBS_STORE)) {
        database.createObjectStore(JOBS_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE);
      }

      if ((event.oldVersion ?? 0) < 2 && database.objectStoreNames.contains(LEGACY_STORE_NAME)) {
        const transaction = request.transaction;
        if (!transaction) return;
        const legacyRequest = transaction.objectStore(LEGACY_STORE_NAME).get("current");
        legacyRequest.onsuccess = () => {
          const legacy = legacyRequest.result as {
            documentIndex?: DocumentIndex | null;
            messages?: ChatMessage[];
            mode?: LearningMode;
            ocrMode?: OcrMode;
            savedAt?: number;
          } | null;
          if (!legacy?.documentIndex) return;
          const timestamp = legacy.savedAt ?? Date.now();
          const id = `workspace-${legacy.documentIndex.id}`;
          const fingerprint = `legacy-${legacy.documentIndex.id}`;
          const snapshot: WorkspaceSnapshot = {
            version: 2,
            id,
            fingerprint,
            documentIndex: legacy.documentIndex,
            messages: legacy.messages ?? [],
            mode: legacy.mode ?? "tutor",
            ocrMode: legacy.ocrMode ?? "auto",
            progress: { mastery: "learning", completedChunkIds: [], lastStudiedAt: timestamp },
            createdAt: timestamp,
            savedAt: timestamp,
          };
          transaction.objectStore(WORKSPACES_STORE).put(snapshot);
          transaction.objectStore(DOCUMENTS_STORE).put({
            fingerprint,
            documentIndex: legacy.documentIndex,
            ocrMode: snapshot.ocrMode,
            cachedAt: timestamp,
          } satisfies CachedDocument);
          transaction.objectStore(META_STORE).put(id, ACTIVE_WORKSPACE_KEY);
        };
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withDatabase<T>(operation: (database: IDBDatabase) => Promise<T>): Promise<T | null> {
  const database = await openDatabase();
  if (!database) return null;
  try {
    return await operation(database);
  } finally {
    database.close();
  }
}

export async function getActiveWorkspaceId(): Promise<string | null> {
  return await withDatabase(async (database) => {
    const transaction = database.transaction(META_STORE, "readonly");
    const completed = transactionComplete(transaction);
    const value = await requestResult(transaction.objectStore(META_STORE).get(ACTIVE_WORKSPACE_KEY));
    await completed;
    return typeof value === "string" ? value : null;
  });
}

export async function setActiveWorkspaceId(id: string | null): Promise<void> {
  await withDatabase(async (database) => {
    const transaction = database.transaction(META_STORE, "readwrite");
    const completed = transactionComplete(transaction);
    const store = transaction.objectStore(META_STORE);
    if (id) store.put(id, ACTIVE_WORKSPACE_KEY);
    else store.delete(ACTIVE_WORKSPACE_KEY);
    await completed;
  });
}

export async function loadWorkspace(id?: string | null): Promise<WorkspaceSnapshot | null> {
  const workspaceId = id ?? await getActiveWorkspaceId();
  if (!workspaceId) return null;
  return await withDatabase(async (database) => {
    const transaction = database.transaction(WORKSPACES_STORE, "readonly");
    const completed = transactionComplete(transaction);
    const value = await requestResult(transaction.objectStore(WORKSPACES_STORE).get(workspaceId));
    await completed;
    return (value as WorkspaceSnapshot | undefined) ?? null;
  });
}

export async function listWorkspaces(): Promise<WorkspaceSummary[]> {
  return await withDatabase(async (database) => {
    const transaction = database.transaction(WORKSPACES_STORE, "readonly");
    const completed = transactionComplete(transaction);
    const values = await requestResult(transaction.objectStore(WORKSPACES_STORE).getAll()) as WorkspaceSnapshot[];
    await completed;
    return values
      .map((workspace) => ({
        id: workspace.id,
        fingerprint: workspace.fingerprint,
        name: workspace.documentIndex.name,
        mastery: workspace.progress.mastery,
        messageCount: workspace.messages.length,
        savedAt: workspace.savedAt,
      }))
      .sort((left, right) => right.savedAt - left.savedAt);
  }) ?? [];
}

export async function saveWorkspace(snapshot: WorkspaceSnapshot): Promise<void> {
  await withDatabase(async (database) => {
    const transaction = database.transaction([WORKSPACES_STORE, META_STORE], "readwrite");
    const completed = transactionComplete(transaction);
    transaction.objectStore(WORKSPACES_STORE).put(snapshot);
    transaction.objectStore(META_STORE).put(snapshot.id, ACTIVE_WORKSPACE_KEY);
    await completed;
  });
}

export async function clearWorkspace(id?: string | null): Promise<void> {
  const workspaceId = id ?? await getActiveWorkspaceId();
  if (!workspaceId) return;
  const activeWorkspaceId = await getActiveWorkspaceId();
  await withDatabase(async (database) => {
    const transaction = database.transaction([WORKSPACES_STORE, META_STORE], "readwrite");
    const completed = transactionComplete(transaction);
    transaction.objectStore(WORKSPACES_STORE).delete(workspaceId);
    if (activeWorkspaceId === workspaceId) transaction.objectStore(META_STORE).delete(ACTIVE_WORKSPACE_KEY);
    await completed;
  });
}

export async function getCachedDocument(fingerprint: string): Promise<CachedDocument | null> {
  return await withDatabase(async (database) => {
    const transaction = database.transaction(DOCUMENTS_STORE, "readonly");
    const completed = transactionComplete(transaction);
    const value = await requestResult(transaction.objectStore(DOCUMENTS_STORE).get(fingerprint));
    await completed;
    return (value as CachedDocument | undefined) ?? null;
  });
}

export async function cacheDocument(document: CachedDocument): Promise<void> {
  await withDatabase(async (database) => {
    const transaction = database.transaction(DOCUMENTS_STORE, "readwrite");
    const completed = transactionComplete(transaction);
    transaction.objectStore(DOCUMENTS_STORE).put(document);
    await completed;
  });
}

export async function saveProcessingJob(job: ProcessingJob): Promise<void> {
  await withDatabase(async (database) => {
    const transaction = database.transaction(JOBS_STORE, "readwrite");
    const completed = transactionComplete(transaction);
    transaction.objectStore(JOBS_STORE).put(job);
    await completed;
  });
}

export async function loadProcessingJob(id: string): Promise<ProcessingJob | null> {
  return await withDatabase(async (database) => {
    const transaction = database.transaction(JOBS_STORE, "readonly");
    const completed = transactionComplete(transaction);
    const value = await requestResult(transaction.objectStore(JOBS_STORE).get(id));
    await completed;
    return (value as ProcessingJob | undefined) ?? null;
  });
}

export async function listProcessingJobs(): Promise<ProcessingJob[]> {
  return await withDatabase(async (database) => {
    const transaction = database.transaction(JOBS_STORE, "readonly");
    const completed = transactionComplete(transaction);
    const values = await requestResult(transaction.objectStore(JOBS_STORE).getAll()) as ProcessingJob[];
    await completed;
    return values.sort((left, right) => right.updatedAt - left.updatedAt);
  }) ?? [];
}

export async function deleteProcessingJob(id: string): Promise<void> {
  await withDatabase(async (database) => {
    const transaction = database.transaction(JOBS_STORE, "readwrite");
    const completed = transactionComplete(transaction);
    transaction.objectStore(JOBS_STORE).delete(id);
    await completed;
  });
}
