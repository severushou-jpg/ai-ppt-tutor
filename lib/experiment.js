export const EXPERIMENT_CONDITIONS = Object.freeze({
  FULL_EVIDENCE: "full_evidence",
  BASELINE: "baseline",
});

export const DEFAULT_EXPERIMENT_CONDITION = EXPERIMENT_CONDITIONS.FULL_EVIDENCE;
export const PROMPT_VERSION = "rq1-grounding-v1";
export const DEFAULT_TEXT_MODEL = "qwen-plus";

const VALID_CONDITIONS = new Set(Object.values(EXPERIMENT_CONDITIONS));

function safeIdentifier(value, fallback, maximum = 96) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[^a-z0-9_-]/gi, "")
    .slice(0, maximum);
  return normalized || fallback;
}

export function parseExperimentMetadata(value, materialFallback = "unknown") {
  const condition = VALID_CONDITIONS.has(value?.condition)
    ? value.condition
    : DEFAULT_EXPERIMENT_CONDITION;
  return {
    participantId: safeIdentifier(value?.participantId, "anonymous"),
    sessionId: safeIdentifier(value?.sessionId, "untracked"),
    condition,
    materialVersion: safeIdentifier(value?.materialVersion, materialFallback, 128),
    startedAt: Number.isFinite(Number(value?.startedAt)) ? Number(value.startedAt) : 0,
  };
}

export function isGroundingEnabled(condition) {
  return condition === EXPERIMENT_CONDITIONS.FULL_EVIDENCE;
}

export function generationVersionMetadata(experiment, model = DEFAULT_TEXT_MODEL) {
  return {
    promptVersion: PROMPT_VERSION,
    modelVersion: model,
    materialVersion: experiment.materialVersion,
    condition: experiment.condition,
  };
}
