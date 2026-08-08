export const STUDY_CONDITIONS = Object.freeze({
  A: "A",
  B: "B",
  C: "C",
  D: "D",
});

export const STUDY_FACTORS = Object.freeze({
  A: Object.freeze({ grounding: false, attribution: false, coreVariant: "U" }),
  B: Object.freeze({ grounding: true, attribution: false, coreVariant: "G" }),
  C: Object.freeze({ grounding: false, attribution: true, coreVariant: "U" }),
  D: Object.freeze({ grounding: true, attribution: true, coreVariant: "G" }),
});

const VALID_CONDITIONS = new Set(Object.values(STUDY_CONDITIONS));

/**
 * Study conditions fail closed. A malformed condition must never silently place a
 * participant in another experimental cell.
 */
export function parseStudyCondition(value) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (!VALID_CONDITIONS.has(normalized)) {
    const error = new Error("The study condition is missing or invalid.");
    error.code = "INVALID_STUDY_CONDITION";
    error.status = 409;
    throw error;
  }
  return normalized;
}

export function factorsForCondition(condition) {
  return STUDY_FACTORS[parseStudyCondition(condition)];
}

export function isStudyGroundingEnabled(condition) {
  return factorsForCondition(condition).grounding;
}

export function isStudyAttributionEnabled(condition) {
  return factorsForCondition(condition).attribution;
}

export function coreVariantForCondition(condition) {
  return factorsForCondition(condition).coreVariant;
}

