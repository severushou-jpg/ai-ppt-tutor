import assert from "node:assert/strict";
import test from "node:test";
import {
  generationVersionMetadata,
  isGroundingEnabled,
  parseExperimentMetadata,
  PROMPT_VERSION,
} from "../lib/experiment.js";
import { parseStructuredResponse } from "../lib/structured-response.js";

test("experiment metadata defaults safely and strips identifiers", () => {
  const parsed = parseExperimentMetadata({
    participantId: "P 001<script>",
    sessionId: "session/1",
    condition: "invalid",
  }, "material-1");
  assert.equal(parsed.participantId, "P001script");
  assert.equal(parsed.sessionId, "session1");
  assert.equal(parsed.condition, "full_evidence");
  assert.equal(isGroundingEnabled(parsed.condition), true);
});

test("baseline structured output remains readable without citations", () => {
  const structured = parseStructuredResponse(JSON.stringify({
    summary: "概述",
    sections: [{ heading: "解释", items: [{ text: "一般性回答", citations: [], supported: true }] }],
    quiz: [],
    partialRefusal: null,
    suggestedQuestions: [],
  }), [], "explain", { requireCitations: false });
  assert.equal(structured.sections[0].items[0].supported, true);
  assert.equal(structured.supportedClaimCount, 1);
});

test("generation metadata records prompt, model, material and condition", () => {
  const metadata = generationVersionMetadata({ condition: "baseline", materialVersion: "sha256" }, "qwen-plus");
  assert.equal(metadata.promptVersion, PROMPT_VERSION);
  assert.equal(metadata.modelVersion, "qwen-plus");
  assert.equal(metadata.condition, "baseline");
});
