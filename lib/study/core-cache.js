import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { configuredStudyRecordRoot } from "./constants.js";

const CACHE_KEY_PATTERN = /^[a-f0-9]{64}$/;
const memoryCache = new Map();

function cacheDirectory(options = {}) {
  return path.join(path.resolve(options.root || configuredStudyRecordRoot()), ".study-cache", "core");
}

function cachePath(key, options = {}) {
  if (!CACHE_KEY_PATTERN.test(String(key))) throw new TypeError("Invalid study cache key.");
  return path.join(cacheDirectory(options), `${key}.json`);
}

export async function readCachedCore(key, options = {}) {
  if (memoryCache.has(key)) return memoryCache.get(key);
  try {
    const parsed = JSON.parse(await readFile(cachePath(key, options), "utf8"));
    if (!parsed?.answer?.coreHash || parsed.cacheKey !== key) return null;
    memoryCache.set(key, parsed);
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    return null;
  }
}

export async function writeCachedCore(key, value, options = {}) {
  const directory = cacheDirectory(options);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = cachePath(key, options);
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  const payload = { ...value, cacheKey: key };
  await writeFile(temporary, `${JSON.stringify(payload)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, target);
  memoryCache.set(key, payload);
  return payload;
}

export function clearStudyCoreMemoryCache() {
  memoryCache.clear();
}

