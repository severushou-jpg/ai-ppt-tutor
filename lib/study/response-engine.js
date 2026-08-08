import { StudyError } from "./validation.js";
import {
  canonicalText,
  canonicalizeHistory,
  coreAnswerHash,
  createCoreCacheKey,
  STUDY_MATERIAL_VERSION,
  STUDY_MODEL_VERSION,
  STUDY_PROMPT_VERSION,
} from "./canonical.js";
import { factorsForCondition } from "./conditions.js";
import { readCachedCore, writeCachedCore } from "./core-cache.js";
import { getFrozenInitialResponse } from "./frozen-initial-answer.js";
import {
  buildRelationalModelGroundingContext,
  getRelationalModelAnchorsForChunk,
  retrieveRelationalModelEvidence,
} from "./relational-model-material.js";

const MAX_SECTIONS = 8;
const MAX_CLAIMS_PER_SECTION = 8;
export const HYPOTHETICAL_EXAMPLE_LABEL = "Hypothetical example - not taken directly from the lecture.";
export const LECTURE_EXAMPLE_LABEL = "Lecture example - taken directly from the lecture.";

export function questionRequestsExample(question) {
  return /\b(example|examples|scenario|illustrate|illustration|analogy|vivid|concrete case|worked example)\b/i
    .test(canonicalText(question, 2_000));
}

function softenUnsafeExampleClaim(value) {
  return canonicalText(value, 1_600)
    .replace(
      /\b(?:this|the) relation contains only facts that are true\b/gi,
      "For this hypothetical example, suppose the listed records are treated as valid",
    )
    // Updating values in an existing tuple does not change the number of
    // tuples. Apply the same deterministic correction in all four cells so a
    // provider slip cannot introduce a course misconception or a confound.
    .replace(
      /\b(rows|tuples) are inserted, deleted or updated\b/gi,
      (_, noun) => `${noun} are inserted or deleted`,
    )
    .replace(
      /\b(rows|tuples) are added, removed or updated\b/gi,
      (_, noun) => `${noun} are added or removed`,
    );
}

function answerContainsConcreteExample(answer) {
  const text = [answer.summary, ...answer.sections.flatMap((section) => [section.heading, ...section.claims])]
    .join("\n");
  return /\b(example|scenario|suppose|consider|for illustration|for instance|e\.g\.|contains only facts that are true)\b/i.test(text)
    || /\b[A-Z][A-Za-z0-9_]*\([^\n)]*,[^\n)]*\)/.test(text);
}

function normalizeExampleProvenance(answer, options = {}) {
  const grounding = options.grounding === true;
  let summary = softenUnsafeExampleClaim(answer.summary);
  const sections = answer.sections.map((section) => ({
    ...section,
    claims: section.claims.map(softenUnsafeExampleClaim),
  }));
  const corrected = { ...answer, summary, sections };
  if (!questionRequestsExample(options.question) && !answerContainsConcreteExample(corrected)) {
    return corrected;
  }
  if (sections.length === 0) sections.push({ heading: "Illustrative example", claims: [] });
  const allText = [summary, ...sections.flatMap((section) => [section.heading, ...section.claims])]
    .join("\n");
  const hasLectureLabel = allText.includes(LECTURE_EXAMPLE_LABEL);

  // An ungrounded answer cannot know that an example came from the lecture.
  // Convert any accidental lecture-origin claim into the conservative label.
  if (!grounding && hasLectureLabel) {
    summary = summary.replaceAll(LECTURE_EXAMPLE_LABEL, HYPOTHETICAL_EXAMPLE_LABEL);
    for (const section of sections) {
      section.claims = section.claims.map((claim) =>
        claim.replaceAll(LECTURE_EXAMPLE_LABEL, HYPOTHETICAL_EXAMPLE_LABEL));
    }
  }

  const normalizedText = [summary, ...sections.flatMap((section) => section.claims)].join("\n");
  const hasAcceptedLabel = normalizedText.includes(HYPOTHETICAL_EXAMPLE_LABEL)
    || (grounding && normalizedText.includes(LECTURE_EXAMPLE_LABEL));
  if (!hasAcceptedLabel && !grounding) {
    const exampleSectionIndex = Math.max(
      0,
      sections.findIndex((section) => /\b(example|scenario|illustration|application)\b/i.test(section.heading)),
    );
    sections[exampleSectionIndex].claims.unshift(
      `${HYPOTHETICAL_EXAMPLE_LABEL} Suppose the following data and constraints are assumed only for illustration.`,
    );
  }
  return { ...answer, summary, sections };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

export function renderStudyCoreMarkdown(answer) {
  const lines = answer.summary ? [answer.summary] : [];
  for (const section of answer.sections) {
    lines.push(`## ${section.heading}`);
    for (const claim of section.claims) lines.push(`- ${claim.text}`);
  }
  return lines.join("\n\n").trim();
}

function parseJsonObject(value, code) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") throw new StudyError(code, "The model returned an invalid response.", 502);
  const trimmed = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    // The public error intentionally does not reveal provider internals.
  }
  throw new StudyError(code, "The model returned an invalid response.", 502);
}

export function normalizeStudyCoreAnswer(value, options = {}) {
  const raw = parseJsonObject(value, "INVALID_STUDY_MODEL_RESPONSE");
  const summary = canonicalText(raw.summary, 1_200);
  const sectionDrafts = (Array.isArray(raw.sections) ? raw.sections : [])
    .slice(0, MAX_SECTIONS)
    .map((section, sectionIndex) => ({
      heading: canonicalText(section?.heading, 160) || `Section ${sectionIndex + 1}`,
      claims: (Array.isArray(section?.claims) ? section.claims : [])
        .slice(0, MAX_CLAIMS_PER_SECTION)
        .map((claim) => canonicalText(typeof claim === "string" ? claim : claim?.text, 1_600))
        .filter(Boolean),
    }))
    .filter((section) => section.claims.length > 0);
  if (!summary && sectionDrafts.length === 0) {
    throw new StudyError("EMPTY_STUDY_MODEL_RESPONSE", "The model returned no usable answer.", 502);
  }
  const normalized = normalizeExampleProvenance({ summary, sections: sectionDrafts }, options);
  const sections = normalized.sections.map((section, sectionIndex) => ({
    id: `section-${sectionIndex + 1}`,
    heading: section.heading,
    claims: section.claims.map((text, claimIndex) => ({
      id: `claim-${sectionIndex + 1}-${claimIndex + 1}`,
      text,
    })),
  }));
  const answerBody = { summary: normalized.summary, sections };
  const coreHash = coreAnswerHash(answerBody);
  return deepFreeze({
    coreId: `dynamic-${coreHash.slice(0, 16)}`,
    coreHash,
    ...answerBody,
    content: renderStudyCoreMarkdown(answerBody),
  });
}

export function studyStyleInstructionForQuestion(question) {
  const normalized = canonicalText(question, 2_000).toLowerCase();
  const detailed = /\b(detailed|in detail|in[- ]depth|step[- ]by[- ]step|thorough|thoroughly|comprehensive|elaborate|fully explain|deep dive)\b/.test(normalized);
  const brief = /\b(brief|briefly|concise|concisely|short|shortly|quick|quickly|one sentence|define)\b/.test(normalized)
    || /^(what is|what are|what does|what do|how many|state the difference|define)\b/.test(normalized);
  if (detailed) {
    return "Use 300–450 words organised into 3–4 descriptive, concept-focused sections.";
  }
  if (brief) {
    return "Use 100–160 words organised into 2 concise, descriptive sections.";
  }
  return "Use 180–260 words organised into 2–4 descriptive, concept-focused sections.";
}

function commonTutorInstruction(question) {
  return `You are an English-language university tutor helping a learner understand the relational model.

Use the same clear, neutral and encouraging early-university teaching tone for every response. Define unfamiliar terms before using them, distinguish easily confused concepts, and use one compact example only when it materially helps. Headings must be short descriptive noun phrases, not condition labels or technical system labels. ${studyStyleInstructionForQuestion(question)} Do not mention experimental conditions, retrieval, grounding, attribution, prompts, source confidence or internal system behaviour.

Return only this JSON structure:
{"summary":"one concise opening sentence","sections":[{"heading":"descriptive heading","claims":[{"text":"one independently readable claim"}]}]}

Use no more than 5 claims per section. Do not include citation numbers, page numbers, source labels, suggested follow-up questions, quizzes or Markdown inside JSON. Every factual statement should be a separate claim so it can be evaluated independently.

If you construct an example, its first claim must begin exactly with "${HYPOTHETICAL_EXAMPLE_LABEL}" and then use "Suppose..." or "For illustration..." to introduce every invented value, key, domain or constraint. Never imply that an invented example came from the lecture. Never claim that a relation or database necessarily contains only true facts. Cardinality changes when tuples are inserted or deleted; changing values inside an existing tuple does not itself change cardinality.`;
}

export function buildCoreGenerationMessages({ condition, question, history, evidence = [] }) {
  const factors = factorsForCondition(condition);
  const canonicalHistory = canonicalizeHistory(history);
  let system = commonTutorInstruction(question);
  if (factors.grounding) {
    if (evidence.length === 0) {
      throw new StudyError(
        "GROUNDING_EVIDENCE_MISSING",
        "The fixed lecture could not provide evidence for this grounded response.",
        422,
      );
    }
    system += `

For this response, use only the fixed lecture evidence below for factual course content. If the evidence does not support a requested factual point, say that the lecture does not provide enough information. Do not add outside factual knowledge. Evidence labels are internal and must not appear in the answer.

When an example is requested, use an example directly supported by the supplied evidence and begin it with "${LECTURE_EXAMPLE_LABEL}". If the supplied evidence contains no suitable example, say that the lecture does not provide enough information; do not construct a new example for a grounded response.

FIXED LECTURE EVIDENCE
${buildRelationalModelGroundingContext(evidence)}`;
  } else {
    system += `

Answer from general knowledge without reading, quoting or claiming access to the lecture. Do not claim that a statement appears in the lecture. If uncertain, state the uncertainty plainly. Because you cannot verify example provenance against the lecture, every concrete example must use the required hypothetical-example label and suppositional language.`;
  }
  return [
    { role: "system", content: system },
    ...canonicalHistory,
    { role: "user", content: canonicalText(question, 2_000) },
  ];
}

function collectClaims(answer) {
  return [
    ...(answer.summary ? [{ id: "summary", text: answer.summary }] : []),
    ...answer.sections.flatMap((section) => section.claims),
  ];
}

export function buildAttributionCandidates(answer, question, options = {}) {
  const maxPerClaim = Math.max(1, Math.min(6, Number(options.maxPerClaim) || 4));
  return collectClaims(answer).map((claim) => {
    if (claim.text.startsWith(HYPOTHETICAL_EXAMPLE_LABEL)) {
      return { claimId: claim.id, claimText: claim.text, anchors: [] };
    }
    const evidence = retrieveRelationalModelEvidence(`${question}\n${claim.text}`, { topK: maxPerClaim });
    const terms = new Set(canonicalText(claim.text).toLowerCase().match(/[a-z0-9]+/g) ?? []);
    const rankedAnchors = evidence
      .flatMap((chunk) => getRelationalModelAnchorsForChunk(chunk.id))
      .map((anchor) => ({
        anchor,
        score: (canonicalText(anchor.exactQuote).toLowerCase().match(/[a-z0-9]+/g) ?? [])
          .reduce((total, term) => total + (terms.has(term) ? 1 : 0), 0),
      }))
      .sort((left, right) => right.score - left.score)
      .map((entry) => entry.anchor);
    return {
      claimId: claim.id,
      claimText: claim.text,
      anchors: [...new Map(rankedAnchors.map((anchor) => [anchor.anchorId, anchor])).values()]
        .slice(0, maxPerClaim),
    };
  });
}

export function buildAttributionVerificationMessages(answer, candidates) {
  const candidateText = candidates.map((candidate) => {
    const anchors = candidate.anchors.map((anchor) =>
      `- ${anchor.anchorId}: ${anchor.exactQuote}`,
    ).join("\n");
    return `CLAIM ${candidate.claimId}: ${candidate.claimText}\nCANDIDATES:\n${anchors || "- none"}`;
  }).join("\n\n");
  return [
    {
      role: "system",
      content: `You verify claim-level attribution against a fixed lecture. Do not rewrite, correct or expand any claim. A source may be assigned only when its quoted text directly supports the whole claim. Topic similarity, shared keywords or background relevance is not enough. Omit unsupported claims. Return only JSON: {"attributions":[{"claimId":"claim-1-1","anchorIds":["anchor-id"]}]}. Use only the supplied claim IDs and anchor IDs.`,
    },
    {
      role: "user",
      content: `ANSWER CORE HASH: ${answer.coreHash}\n\n${candidateText}`,
    },
  ];
}

const ATTRIBUTION_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "each", "for", "from", "has", "have",
  "in", "is", "it", "its", "of", "on", "one", "or", "that", "the", "their", "this", "to",
  "used", "using", "while", "with", "within",
]);
const NUMBER_WORDS = Object.freeze({
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5",
  six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
});

function attributionToken(term) {
  const numeric = NUMBER_WORDS[term];
  if (numeric) return numeric;
  if (term.endsWith("ies") && term.length > 4) return `${term.slice(0, -3)}y`;
  if (term.endsWith("ing") && term.length > 5) return term.slice(0, -3);
  if (term.endsWith("ed") && term.length > 4) return term.slice(0, -2);
  if (term.endsWith("s") && !term.endsWith("ss") && term.length > 3) return term.slice(0, -1);
  return term;
}

function attributionTerms(value) {
  const withoutProvenanceLabels = canonicalText(value)
    .replaceAll(HYPOTHETICAL_EXAMPLE_LABEL, "")
    .replaceAll(LECTURE_EXAMPLE_LABEL, "");
  return (withoutProvenanceLabels.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((term) => !ATTRIBUTION_STOP_WORDS.has(term))
    .map(attributionToken)
    .filter((term) => term.length >= 2 || /^\d+$/.test(term));
}

const ATTRIBUTION_CRITICAL_TERMS = new Set([
  "0", "add", "alter", "chang", "change", "decreas", "decrease", "delet", "delete",
  "empty", "fix", "increas", "increase", "insert", "never", "no", "not", "null",
  "remov", "remove", "updat", "update", "without",
]);

export function directAttributionCoverage(claimText, anchors) {
  const claimTerms = [...new Set(attributionTerms(claimText))];
  if (claimTerms.length === 0) return 0;
  const evidenceTerms = new Set(anchors.flatMap((anchor) => attributionTerms(anchor.exactQuote)));
  const unmatchedCriticalTerm = claimTerms.some((term) =>
    (/^\d+$/.test(term) || ATTRIBUTION_CRITICAL_TERMS.has(term)) && !evidenceTerms.has(term));
  if (unmatchedCriticalTerm) return 0;
  const matches = claimTerms.filter((term) => evidenceTerms.has(term)).length;
  if (matches < 2 || evidenceTerms.size === 0) return 0;
  // Measure in the claim direction. A short topic-similar quote must not be
  // allowed to license a much longer compound assertion.
  return matches / claimTerms.length;
}

export function normalizeVerifiedAttributions(value, candidates) {
  const raw = parseJsonObject(value, "INVALID_ATTRIBUTION_RESPONSE");
  const candidateByClaim = new Map(candidates.map((candidate) => [candidate.claimId, candidate]));
  const results = [];
  const seenClaims = new Set();
  for (const item of Array.isArray(raw.attributions) ? raw.attributions : []) {
    const claimId = canonicalText(item?.claimId, 120);
    const candidate = candidateByClaim.get(claimId);
    if (!candidate || seenClaims.has(claimId)) continue;
    const allowed = new Map(candidate.anchors.map((anchor) => [anchor.anchorId, anchor]));
    const anchors = [...new Set(Array.isArray(item?.anchorIds) ? item.anchorIds.map(String) : [])]
      .map((anchorId) => allowed.get(anchorId))
      .filter(Boolean)
      .slice(0, 3);
    if (anchors.length === 0) continue;
    // The verifier is intentionally followed by a conservative lexical guard.
    // It prevents topic-similar pages from being exposed as direct support for
    // new facts (for example, claiming insertion/deletion behaviour from only a
    // definition of cardinality). False negatives are preferable to false cites.
    if (directAttributionCoverage(candidate.claimText, anchors) < 0.4) continue;
    seenClaims.add(claimId);
    results.push({ claimId, anchors });
  }
  return deepFreeze(results);
}

/**
 * Provider verification is deliberately conservative and can occasionally
 * omit a near-verbatim definition. Recover only high-overlap cases locally:
 * the selected quote set must cover at least 70% of the claim terms and still
 * pass the critical-number/negation/operation veto in
 * directAttributionCoverage. This can add a missed direct citation, but can
 * never rescue a merely topic-similar compound claim.
 */
export function addDeterministicDirectAttributions(candidates, verifiedCitations) {
  const results = [...verifiedCitations];
  const seenClaims = new Set(results.map((citation) => citation.claimId));
  for (const candidate of candidates) {
    if (seenClaims.has(candidate.claimId) || candidate.anchors.length === 0) continue;
    const anchors = candidate.anchors.slice(0, 4);
    let best = null;
    for (let mask = 1; mask < (1 << anchors.length); mask += 1) {
      const selected = anchors.filter((_, index) => (mask & (1 << index)) !== 0);
      if (selected.length > 3) continue;
      const coverage = directAttributionCoverage(candidate.claimText, selected);
      if (coverage < 0.7) continue;
      if (!best
        || selected.length < best.anchors.length
        || (selected.length === best.anchors.length && coverage > best.coverage)) {
        best = { anchors: selected, coverage };
      }
    }
    if (!best) continue;
    seenClaims.add(candidate.claimId);
    results.push({ claimId: candidate.claimId, anchors: best.anchors });
  }
  return deepFreeze(results);
}

function createVerifiedGroundedCore(summary, sections) {
  const answerBody = { summary, sections };
  const coreHash = coreAnswerHash(answerBody);
  return deepFreeze({
    coreId: `dynamic-${coreHash.slice(0, 16)}`,
    coreHash,
    ...answerBody,
    content: renderStudyCoreMarkdown(answerBody),
  });
}

/**
 * Evidence grounding is enforced independently of whether citations are shown.
 * A grounded answer may retain only claims that passed whole-claim source
 * verification. Existing IDs are preserved so the verified source objects
 * remain valid.
 */
export function gateGroundedCoreByVerifiedEvidence(answer, verifiedCitations) {
  const verifiedClaimIds = new Set(verifiedCitations.map((citation) => citation.claimId));
  const sections = answer.sections
    .map((section) => ({
      ...section,
      claims: section.claims.filter((claim) => verifiedClaimIds.has(claim.id)),
    }))
    .filter((section) => section.claims.length > 0);

  const verifiedSummary = verifiedClaimIds.has("summary") ? answer.summary : "";
  if (!verifiedSummary && sections.length === 0) {
    return createVerifiedGroundedCore(
      "The fixed lecture does not provide enough directly supported information to answer this question.",
      [],
    );
  }
  return createVerifiedGroundedCore(verifiedSummary, sections);
}

async function getOrGenerateCore(input, dependencies) {
  const factors = factorsForCondition(input.condition);
  const evidence = factors.grounding
    ? (dependencies.retrieveEvidence || retrieveRelationalModelEvidence)(input.question, { topK: 8 })
    : [];
  if (factors.grounding && evidence.length === 0) {
    throw new StudyError(
      "GROUNDING_EVIDENCE_MISSING",
      "The fixed lecture could not provide evidence for this grounded response.",
      422,
    );
  }
  const cacheKey = createCoreCacheKey(input);
  const readCache = dependencies.readCache || readCachedCore;
  const writeCache = dependencies.writeCache || writeCachedCore;
  const cached = await readCache(cacheKey, dependencies.cacheOptions);
  if (cached?.answer?.coreHash) {
    return {
      answer: deepFreeze(cached.answer),
      cacheKey,
      cacheHit: true,
      evidence,
      groundingCertified: cached.groundingCertified === true,
      certifiedCitations: deepFreeze(Array.isArray(cached.certifiedCitations)
        ? cached.certifiedCitations
        : []),
    };
  }
  if (typeof dependencies.callModel !== "function") {
    throw new StudyError("STUDY_MODEL_UNAVAILABLE", "The study model is not available.", 503);
  }
  const messages = buildCoreGenerationMessages({ ...input, evidence });
  const generated = await dependencies.callModel(messages, { purpose: "core", grounding: factors.grounding });
  const answer = normalizeStudyCoreAnswer(generated, {
    question: input.question,
    grounding: factors.grounding,
  });
  await writeCache(cacheKey, {
    answer,
    grounding: factors.grounding,
    createdAt: new Date().toISOString(),
    materialVersion: STUDY_MATERIAL_VERSION,
    modelVersion: STUDY_MODEL_VERSION,
    promptVersion: STUDY_PROMPT_VERSION,
  }, dependencies.cacheOptions);
  return {
    answer,
    cacheKey,
    cacheHit: false,
    evidence,
    groundingCertified: false,
    certifiedCitations: [],
  };
}

const groundedResponseLocks = new Map();

async function withGroundedResponseLock(cacheKey, task) {
  const previous = groundedResponseLocks.get(cacheKey) ?? Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const tail = previous.catch(() => {}).then(() => gate);
  groundedResponseLocks.set(cacheKey, tail);
  await previous.catch(() => {});
  try {
    return await task();
  } finally {
    release();
    if (groundedResponseLocks.get(cacheKey) === tail) groundedResponseLocks.delete(cacheKey);
  }
}

async function createDynamicStudyResponse(input, dependencies, factors, question) {
  const core = await getOrGenerateCore({
    condition: input.condition,
    question,
    history: input.history,
  }, dependencies);
  const hashBeforeAttribution = core.answer.coreHash;
  if (typeof dependencies.callModel !== "function") {
    throw new StudyError("ATTRIBUTION_UNAVAILABLE", "Source verification is not available.", 503);
  }
  // Run the same post-hoc verification stage in all four cells. Only its
  // visibility changes. This prevents attribution-on cells from having a
  // systematically longer response pipeline than attribution-off cells.
  const candidates = buildAttributionCandidates(core.answer, question);
  const verification = await dependencies.callModel(
    buildAttributionVerificationMessages(core.answer, candidates),
    { purpose: "attribution", grounding: factors.grounding },
  );
  const modelVerifiedCitations = normalizeVerifiedAttributions(verification, candidates);
  const verifiedCitations = addDeterministicDirectAttributions(
    candidates,
    modelVerifiedCitations,
  );
  if (core.answer.coreHash !== hashBeforeAttribution || coreAnswerHash(core.answer) !== hashBeforeAttribution) {
    throw new StudyError(
      "ATTRIBUTION_MUTATED_CORE",
      "Source attribution attempted to change the answer body.",
      500,
    );
  }
  const answer = factors.grounding && !core.groundingCertified
    ? gateGroundedCoreByVerifiedEvidence(core.answer, verifiedCitations)
    : core.answer;
  const certificationCitations = factors.grounding && core.groundingCertified
    ? core.certifiedCitations
    : verifiedCitations;
  const retainedClaimIds = new Set(collectClaims(answer).map((claim) => claim.id));
  const retainedCitations = certificationCitations
    .filter((citation) => retainedClaimIds.has(citation.claimId));
  const citations = factors.attribution ? retainedCitations : [];

  // Store the evidence-gated body under the grounding-only cache identity.
  // Consequently B and D receive the exact same answer body regardless of
  // which condition is run first; citation visibility never enters the key.
  if (factors.grounding && !core.groundingCertified) {
    const writeCache = dependencies.writeCache || writeCachedCore;
    await writeCache(core.cacheKey, {
      answer,
      grounding: true,
      groundingCertified: true,
      certifiedCitations: retainedCitations,
      createdAt: new Date().toISOString(),
      materialVersion: STUDY_MATERIAL_VERSION,
      modelVersion: STUDY_MODEL_VERSION,
      promptVersion: STUDY_PROMPT_VERSION,
    }, dependencies.cacheOptions);
  }
  return {
    answer,
    citations,
    grounding: {
      enabled: factors.grounding,
      strategy: factors.grounding ? "fixed_lecture_retrieval" : "none",
      evidenceCount: core.evidence.length,
    },
    attribution: { enabled: factors.attribution },
    cacheKey: core.cacheKey,
    cacheHit: core.cacheHit,
    frozen: false,
    version: {
      material: STUDY_MATERIAL_VERSION,
      model: STUDY_MODEL_VERSION,
      prompt: STUDY_PROMPT_VERSION,
    },
  };
}

export async function createStudyResponse(input, dependencies = {}) {
  const factors = factorsForCondition(input?.condition);
  if (input?.initial === true) return getFrozenInitialResponse(input.condition);
  const question = canonicalText(input?.question, 2_000);
  if (!question) throw new StudyError("QUESTION_REQUIRED", "Enter a question about the lecture.");
  if (!factors.grounding) {
    return createDynamicStudyResponse(input, dependencies, factors, question);
  }
  const cacheKey = createCoreCacheKey({
    condition: input.condition,
    question,
    history: input.history,
  });
  return withGroundedResponseLock(cacheKey, () =>
    createDynamicStudyResponse(input, dependencies, factors, question));
}

/**
 * Participant responses expose only renderable study content. Factor state,
 * cache behaviour, provider identity and prompt details remain server-side so
 * the manipulation cannot be discovered from the browser response payload.
 */
export function serializeParticipantStudyResponse(response) {
  return {
    answer: response.answer,
    citations: response.citations,
    frozen: response.frozen,
    version: {
      content: response.frozen ? "initial-content-v1" : "dialogue-content-v1",
      material: "dbi-rm-v1",
    },
  };
}
