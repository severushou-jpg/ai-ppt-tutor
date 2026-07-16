import type { ChatMessage, DocumentIndex, LearningMode, OcrMode } from "@/app/types";

const DATABASE_NAME = "ai-ppt-tutor";
const STORE_NAME = "workspace";
const SNAPSHOT_KEY = "current";

export interface WorkspaceSnapshot {
  version: 1;
  documentIndex: DocumentIndex | null;
  messages: ChatMessage[];
  mode: LearningMode;
  ocrMode?: OcrMode;
  savedAt: number;
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadWorkspace(): Promise<WorkspaceSnapshot | null> {
  const database = await openDatabase();
  if (!database) return null;
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(SNAPSHOT_KEY);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
  });
}

export async function saveWorkspace(snapshot: WorkspaceSnapshot): Promise<void> {
  const database = await openDatabase();
  if (!database) return;
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(snapshot, SNAPSHOT_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function clearWorkspace(): Promise<void> {
  const database = await openDatabase();
  if (!database) return;
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(SNAPSHOT_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}
