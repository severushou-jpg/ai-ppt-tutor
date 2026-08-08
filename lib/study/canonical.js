import { createHash } from "node:crypto";
import { factorsForCondition } from "./conditions.js";

export const STUDY_PROMPT_VERSION = "relational-model-study-v4-certified-grounding";
export const STUDY_MATERIAL_VERSION = "dbi-relational-model-fc51ca07-v1";
export const STUDY_MODEL_VERSION = process.env.DASHSCOPE_TEXT_MODEL || "qwen-plus";

const MAX_HISTORY_ITEMS = 20;
const MAX_HISTORY_CONTENT = 6_000;

export function canonicalText(value, maximum = 8_000) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maximum);
}

/**
 * Only citation-free answer bodies belong in model history. The client may send
 * display text containing source markers; remove those deterministically so the
 * attribution factor can never leak into the next generation turn.
 */
export function stripAttributionMarkup(value) {
  return canonicalText(value)
    .replace(/\s*\[(?:source|citation|来源)\s*\d+\]/gi, "")
    .replace(/\s*\[\d+\](?=\s|$|[.,;:!?])/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export function canonicalizeHistory(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(-MAX_HISTORY_ITEMS)
    .filter((item) => item && (item.role === "user" || item.role === "assistant"))
    .map((item) => ({
      role: item.role,
      content: item.role === "assistant"
        ? stripAttributionMarkup(item.content).slice(0, MAX_HISTORY_CONTENT)
        : canonicalText(item.content, MAX_HISTORY_CONTENT),
    }))
    .filter((item) => item.content);
}

export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`;
}

export function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function coreAnswerHash(answer) {
  return sha256(stableStringify({
    summary: answer.summary,
    sections: answer.sections,
  }));
}

/**
 * The cache identity deliberately contains the grounding factor, but never the
 * condition label or attribution factor. Thus A/C share one core-generation
 * cache and B/D share another.
 */
export function createCoreCacheIdentity({
  condition,
  question,
  history,
  promptVersion = STUDY_PROMPT_VERSION,
  materialVersion = STUDY_MATERIAL_VERSION,
  modelVersion = STUDY_MODEL_VERSION,
}) {
  const { grounding } = factorsForCondition(condition);
  return Object.freeze({
    grounding,
    history: canonicalizeHistory(history),
    materialVersion,
    modelVersion,
    promptVersion,
    question: canonicalText(question, 2_000),
  });
}

export function createCoreCacheKey(options) {
  return sha256(stableStringify(createCoreCacheIdentity(options)));
}
