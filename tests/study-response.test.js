import assert from "node:assert/strict";
import test from "node:test";
import {
  createCoreCacheIdentity,
  createCoreCacheKey,
  stripAttributionMarkup,
} from "../lib/study/canonical.js";
import {
  factorsForCondition,
  parseStudyCondition,
} from "../lib/study/conditions.js";
import {
  getFrozenInitialResponse,
  validateFrozenInitialAnswerPack,
} from "../lib/study/frozen-initial-answer.js";
import {
  addDeterministicDirectAttributions,
  buildAttributionCandidates,
  buildCoreGenerationMessages,
  createStudyResponse,
  gateGroundedCoreByVerifiedEvidence,
  HYPOTHETICAL_EXAMPLE_LABEL,
  LECTURE_EXAMPLE_LABEL,
  normalizeStudyCoreAnswer,
  normalizeVerifiedAttributions,
  questionRequestsExample,
  serializeParticipantStudyResponse,
  studyStyleInstructionForQuestion,
} from "../lib/study/response-engine.js";
import { RELATIONAL_MODEL_CHUNKS } from "../lib/study/relational-model-material.js";

function memoryCache() {
  const values = new Map();
  return {
    readCache: async (key) => values.get(key) ?? null,
    writeCache: async (key, value) => {
      const stored = { ...value, cacheKey: key };
      values.set(key, stored);
      return stored;
    },
  };
}

function fakeModel(calls) {
  return async (messages, options) => {
    calls.push({ messages, options });
    if (options.purpose === "attribution") {
      const candidate = messages[1].content.match(/- (dbi-rm-p\d+-a1):/);
      return JSON.stringify({
        attributions: candidate
          ? [{ claimId: "claim-1-1", anchorIds: [candidate[1]] }]
          : [],
      });
    }
    return JSON.stringify({
      summary: "A concise explanation.",
      sections: [{
        heading: "Core concept",
        claims: [{ text: "Cardinality is the number of tuples in a relation." }],
      }],
    });
  };
}

test("the four conditions form an orthogonal 2x2 design", () => {
  assert.deepEqual(factorsForCondition("A"), { grounding: false, attribution: false, coreVariant: "U" });
  assert.deepEqual(factorsForCondition("B"), { grounding: true, attribution: false, coreVariant: "G" });
  assert.deepEqual(factorsForCondition("C"), { grounding: false, attribution: true, coreVariant: "U" });
  assert.deepEqual(factorsForCondition("D"), { grounding: true, attribution: true, coreVariant: "G" });
  assert.throws(() => parseStudyCondition("baseline"), /invalid/i);
});

test("the frozen pack has exactly two cores and attribution never changes them", () => {
  const validation = validateFrozenInitialAnswerPack();
  assert.equal(validation.valid, true, validation.errors.join(", "));
  const A = getFrozenInitialResponse("A");
  const B = getFrozenInitialResponse("B");
  const C = getFrozenInitialResponse("C");
  const D = getFrozenInitialResponse("D");
  assert.strictEqual(A.answer, C.answer);
  assert.strictEqual(B.answer, D.answer);
  assert.equal(A.answer.content, C.answer.content);
  assert.equal(B.answer.content, D.answer.content);
  assert.notEqual(A.answer.coreHash, B.answer.coreHash);
  assert.doesNotMatch(A.answer.content, /OfficeID|Employee\.DID|Department–Employee|Student\(Name, Age\)|John, 23/);
  assert.deepEqual(A.citations, []);
  assert.deepEqual(B.citations, []);
  assert.ok(C.citations.length > 0);
  assert.ok(D.citations.length > 0);
  assert.ok(C.citations.every((citation) => citation.anchors.length <= 3));
  assert.ok(D.citations.every((citation) => citation.anchors.length <= 3));
  assert.equal(C.citations.some((citation) => citation.claimId === "u-9"), false);
  assert.equal(C.citations.some((citation) => citation.claimId === "u-4"), false);
  assert.equal(C.citations.some((citation) => citation.claimId === "u-13"), false);
  assert.equal(A.answer.content.split(HYPOTHETICAL_EXAMPLE_LABEL).length - 1, 3);
  assert.equal(C.answer.content.split(HYPOTHETICAL_EXAMPLE_LABEL).length - 1, 3);
  assert.doesNotMatch(B.answer.content, /Hypothetical example/i);
  assert.doesNotMatch(D.answer.content, /Hypothetical example/i);
});

test("cache identity excludes attribution and canonical history strips citation display markup", () => {
  const base = {
    question: "What is cardinality?",
    history: [{ role: "assistant", content: "It counts tuples. [Source 3]" }],
  };
  assert.equal(createCoreCacheKey({ ...base, condition: "A" }), createCoreCacheKey({
    ...base,
    condition: "C",
    history: [{ role: "assistant", content: "It counts tuples." }],
  }));
  assert.equal(createCoreCacheKey({ ...base, condition: "B" }), createCoreCacheKey({
    ...base,
    condition: "D",
  }));
  assert.notEqual(createCoreCacheKey({ ...base, condition: "A" }), createCoreCacheKey({
    ...base,
    condition: "B",
  }));
  assert.equal(stripAttributionMarkup("One fact [Citation 2]\nAnother [3]."), "One fact\nAnother.");
  assert.equal(Object.hasOwn(createCoreCacheIdentity({ ...base, condition: "C" }), "attribution"), false);
});

test("grounding alone controls whether fixed lecture evidence enters generation", () => {
  const ungrounded = buildCoreGenerationMessages({
    condition: "A",
    question: "Explain cardinality",
    history: [],
  });
  assert.doesNotMatch(ungrounded[0].content, /FIXED LECTURE EVIDENCE/);
  assert.doesNotMatch(ungrounded[0].content, /Lecture slide 10/);

  const grounded = buildCoreGenerationMessages({
    condition: "B",
    question: "Explain cardinality",
    history: [],
    evidence: [RELATIONAL_MODEL_CHUNKS.find((chunk) => chunk.number === 13)],
  });
  assert.match(grounded[0].content, /FIXED LECTURE EVIDENCE/);
  assert.match(grounded[0].content, /cardinality is the number of tuples/i);
});

test("live teaching style and length are derived only from the question", () => {
  assert.match(studyStyleInstructionForQuestion("Define a tuple."), /100–160 words.*2 concise/i);
  assert.match(studyStyleInstructionForQuestion("Explain candidate keys with an example."), /180–260 words.*2–4/i);
  assert.match(studyStyleInstructionForQuestion("Give a detailed step-by-step explanation of candidate keys."), /300–450 words.*3–4/i);

  const question = "Explain candidate keys with an example.";
  const evidence = [RELATIONAL_MODEL_CHUNKS.find((chunk) => chunk.number === 20)];
  const A = buildCoreGenerationMessages({ condition: "A", question, history: [] })[0].content;
  const B = buildCoreGenerationMessages({ condition: "B", question, history: [], evidence })[0].content;
  const sharedStyle = studyStyleInstructionForQuestion(question);
  assert.match(A, new RegExp(sharedStyle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(B, new RegExp(sharedStyle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(A, /same clear, neutral and encouraging early-university teaching tone/i);
  assert.match(B, /same clear, neutral and encouraging early-university teaching tone/i);
});

test("constructed examples are labelled and unsafe illustrative overclaims are softened", () => {
  assert.equal(questionRequestsExample("Give me a vivid example of a relation."), true);
  assert.equal(questionRequestsExample("Compare candidate and primary keys."), false);
  const raw = JSON.stringify({
    summary: "A student relation can make the idea concrete.",
    sections: [{
      heading: "A concrete example",
      claims: [
        { text: "This relation contains only facts that are true." },
        { text: "StudentID is unique and Year has the domain {1, 2, 3, 4}." },
      ],
    }],
  });
  const answer = normalizeStudyCoreAnswer(raw, {
    question: "Give me a vivid example of a relation.",
    grounding: false,
  });
  assert.match(answer.content, new RegExp(HYPOTHETICAL_EXAMPLE_LABEL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(answer.content, /Suppose the following data and constraints are assumed only for illustration/i);
  assert.doesNotMatch(answer.content, /contains only facts that are true/i);
  assert.match(answer.content, /suppose the listed records are treated as valid/i);

  const spontaneous = normalizeStudyCoreAnswer(JSON.stringify({
    summary: "A compact illustration helps.",
    sections: [{
      heading: "Application",
      claims: [{ text: "For example, Student(Name, Age) could contain (Amina, 21)." }],
    }],
  }), {
    question: "Explain relations.",
    grounding: false,
  });
  assert.match(spontaneous.content, /Hypothetical example - not taken directly from the lecture/i);
  const provenanceClaim = spontaneous.sections
    .flatMap((section) => section.claims)
    .find((claim) => claim.text.startsWith(HYPOTHETICAL_EXAMPLE_LABEL));
  const provenanceCandidate = buildAttributionCandidates(spontaneous, "Explain relations.")
    .find((candidate) => candidate.claimId === provenanceClaim?.id);
  assert.deepEqual(provenanceCandidate?.anchors, []);
});

test("example provenance is conservative for ungrounded answers and explicit in both prompts", () => {
  const modelValue = JSON.stringify({
    summary: "An example follows.",
    sections: [{
      heading: "Example",
      claims: [{ text: `${LECTURE_EXAMPLE_LABEL} Student(Name, Age) illustrates a schema.` }],
    }],
  });
  const ungroundedAnswer = normalizeStudyCoreAnswer(modelValue, {
    question: "Give an example.",
    grounding: false,
  });
  assert.match(ungroundedAnswer.content, /Hypothetical example - not taken directly from the lecture/);
  assert.doesNotMatch(ungroundedAnswer.content, /Lecture example - taken directly/);

  const evidence = [RELATIONAL_MODEL_CHUNKS.find((chunk) => chunk.number === 9)];
  const ungroundedPrompt = buildCoreGenerationMessages({
    condition: "A",
    question: "Give a vivid example of a relation.",
    history: [],
  })[0].content;
  const groundedPrompt = buildCoreGenerationMessages({
    condition: "B",
    question: "Give a vivid example of a relation.",
    history: [],
    evidence,
  })[0].content;
  assert.match(ungroundedPrompt, /every concrete example must use the required hypothetical-example label/i);
  assert.match(groundedPrompt, /use an example directly supported by the supplied evidence/i);
  assert.match(groundedPrompt, /do not construct a new example for a grounded response/i);
  assert.match(groundedPrompt, /Lecture example - taken directly from the lecture/);
  assert.match(groundedPrompt, /Never claim that a relation or database necessarily contains only true facts/i);
});

test("dynamic A/C and B/D share a core while only attribution-on cells expose anchors", async () => {
  const calls = [];
  const cache = memoryCache();
  const dependencies = { ...cache, callModel: fakeModel(calls) };
  const request = { question: "What is cardinality?", history: [] };

  const A = await createStudyResponse({ ...request, condition: "A" }, dependencies);
  const C = await createStudyResponse({ ...request, condition: "C" }, dependencies);
  const B = await createStudyResponse({ ...request, condition: "B" }, dependencies);
  const D = await createStudyResponse({ ...request, condition: "D" }, dependencies);

  assert.strictEqual(A.answer, C.answer);
  assert.strictEqual(B.answer, D.answer);
  assert.equal(A.answer.coreHash, C.answer.coreHash);
  assert.equal(B.answer.coreHash, D.answer.coreHash);
  assert.deepEqual(A.citations, []);
  assert.deepEqual(B.citations, []);
  assert.ok(C.citations.length > 0);
  assert.ok(D.citations.length > 0);
  assert.equal(A.grounding.evidenceCount, 0);
  assert.ok(B.grounding.evidenceCount > 0);
  assert.equal(calls.filter((call) => call.options.purpose === "core").length, 2);
  assert.equal(calls.filter((call) => call.options.purpose === "attribution").length, 4);
});

test("the four-condition matrix preserves paired cores across teaching scenarios", async () => {
  const scenarios = [
    { question: "Give an overview of the relational model.", history: [] },
    { question: "Explain primary keys in a detailed step-by-step way.", history: [] },
    { question: "Give me a vivid example of a relation.", history: [] },
    { question: "Compare candidate keys and primary keys.", history: [] },
    {
      question: "Why does that distinction matter?",
      history: [
        { role: "user", content: "What is cardinality?" },
        { role: "assistant", content: "Cardinality counts tuples. [Source 2]" },
      ],
    },
  ];

  for (const scenario of scenarios) {
    const calls = [];
    const cache = memoryCache();
    const callModel = async (messages, options) => {
      calls.push({ messages, options });
      if (options.purpose === "core") {
        return JSON.stringify({
          summary: "A focused explanation.",
          sections: [{
            heading: "Core concept",
            claims: [{ text: "Cardinality is the number of tuples in a relation." }],
          }],
        });
      }
      const content = messages[1].content;
      const match = content.match(
        /CLAIM (claim-\d+-\d+): Cardinality is the number of tuples in a relation\.[\s\S]*?CANDIDATES:\n- (dbi-rm-p\d+-a\d+):/,
      );
      return JSON.stringify({
        attributions: match ? [{ claimId: match[1], anchorIds: [match[2]] }] : [],
      });
    };
    const dependencies = { ...cache, callModel };
    const A = await createStudyResponse({ ...scenario, condition: "A" }, dependencies);
    const C = await createStudyResponse({ ...scenario, condition: "C" }, dependencies);
    const B = await createStudyResponse({ ...scenario, condition: "B" }, dependencies);
    const D = await createStudyResponse({ ...scenario, condition: "D" }, dependencies);

    assert.strictEqual(A.answer, C.answer, scenario.question);
    assert.strictEqual(B.answer, D.answer, scenario.question);
    assert.equal(A.answer.content, C.answer.content, scenario.question);
    assert.equal(B.answer.content, D.answer.content, scenario.question);
    assert.deepEqual(A.citations, [], scenario.question);
    assert.deepEqual(B.citations, [], scenario.question);
    assert.ok(C.citations.length > 0, scenario.question);
    assert.ok(D.citations.length > 0, scenario.question);
    assert.equal(A.grounding.evidenceCount, 0, scenario.question);
    assert.ok(B.grounding.evidenceCount > 0, scenario.question);
    assert.equal(calls.filter((call) => call.options.purpose === "core").length, 2, scenario.question);
    assert.equal(calls.filter((call) => call.options.purpose === "attribution").length, 4, scenario.question);
    assert.doesNotMatch(A.answer.content, /condition [ABCD]|grounding|attribution/i, scenario.question);
    assert.doesNotMatch(B.answer.content, /condition [ABCD]|grounding|attribution/i, scenario.question);
    if (questionRequestsExample(scenario.question)) {
      assert.match(A.answer.content, /Hypothetical example - not taken directly from the lecture/i);
      assert.doesNotMatch(B.answer.content, /Hypothetical example - not taken directly from the lecture/i);
    }
  }
});

test("known cardinality slips are corrected identically before any condition-specific stage", () => {
  const raw = JSON.stringify({
    summary: "Cardinality is a row count.",
    sections: [{
      heading: "Changes",
      claims: [{ text: "It changes as rows are inserted, deleted or updated." }],
    }],
  });
  const ungrounded = normalizeStudyCoreAnswer(raw, {
    question: "What is cardinality?",
    grounding: false,
  });
  const grounded = normalizeStudyCoreAnswer(raw, {
    question: "What is cardinality?",
    grounding: true,
  });
  assert.match(ungrounded.content, /rows are inserted or deleted/i);
  assert.doesNotMatch(ungrounded.content, /deleted or updated/i);
  assert.equal(ungrounded.content, grounded.content);
});

test("grounded claim gating keeps only whole-claim verified content and fails closed", () => {
  const answer = normalizeStudyCoreAnswer(JSON.stringify({
    summary: "Cardinality and degree describe relation size.",
    sections: [{
      heading: "Definitions",
      claims: [
        { text: "Cardinality is the number of tuples in a relation." },
        { text: "An empty relation always has cardinality zero while retaining its degree." },
      ],
    }],
  }), { question: "Explain cardinality.", grounding: true });
  const gated = gateGroundedCoreByVerifiedEvidence(answer, [{
    claimId: "claim-1-1",
    anchors: [RELATIONAL_MODEL_CHUNKS.find((chunk) => chunk.number === 13).anchor],
  }]);
  assert.equal(gated.summary, "");
  assert.equal(gated.sections.length, 1);
  assert.equal(gated.sections[0].claims.length, 1);
  assert.match(gated.content, /number of tuples/i);
  assert.doesNotMatch(gated.content, /empty relation/i);

  const refusal = gateGroundedCoreByVerifiedEvidence(answer, []);
  assert.match(refusal.summary, /does not provide enough directly supported information/i);
  assert.deepEqual(refusal.sections, []);
});

test("grounded first-use certification is stable for B-first, D-first and concurrent access", async () => {
  for (const order of [["B", "D"], ["D", "B"]]) {
    const cache = memoryCache();
    const calls = [];
    const dependencies = { ...cache, callModel: fakeModel(calls) };
    const first = await createStudyResponse({ condition: order[0], question: "What is cardinality?", history: [] }, dependencies);
    const second = await createStudyResponse({ condition: order[1], question: "What is cardinality?", history: [] }, dependencies);
    assert.equal(first.answer.content, second.answer.content);
    assert.equal(first.answer.coreHash, second.answer.coreHash);
  }

  const cache = memoryCache();
  const calls = [];
  const dependencies = { ...cache, callModel: fakeModel(calls) };
  const [B, D] = await Promise.all([
    createStudyResponse({ condition: "B", question: "What is degree?", history: [] }, dependencies),
    createStudyResponse({ condition: "D", question: "What is degree?", history: [] }, dependencies),
  ]);
  assert.equal(B.answer.content, D.answer.content);
  assert.equal(B.answer.coreHash, D.answer.coreHash);
  assert.equal(calls.filter((call) => call.options.purpose === "core").length, 1);
  assert.equal(calls.filter((call) => call.options.purpose === "attribution").length, 2);
});

test("participant serialization never exposes factor or cache diagnostics", () => {
  const internal = getFrozenInitialResponse("D");
  const exposed = serializeParticipantStudyResponse({
    ...internal,
    cacheKey: "secret-cache-key",
    cacheHit: true,
  });
  assert.deepEqual(Object.keys(exposed).sort(), ["answer", "citations", "frozen", "version"]);
  assert.equal(Object.hasOwn(exposed, "grounding"), false);
  assert.equal(Object.hasOwn(exposed, "attribution"), false);
  assert.equal(Object.hasOwn(exposed, "cacheKey"), false);
  assert.doesNotMatch(Object.keys(exposed.version).join(" "), /prompt|model|citation|ground|attribution/i);
  assert.doesNotMatch(exposed.answer.coreId, /initial-[ug]-/i);
});

test("post-hoc attribution rejects topic similarity that does not support the whole claim", () => {
  const anchor = RELATIONAL_MODEL_CHUNKS.find((chunk) => chunk.number === 13).anchor;
  const unsupported = [{
    claimId: "claim-1-1",
    claimText: "Cardinality changes when tuples are inserted, deleted, or updated.",
    anchors: [anchor],
  }];
  const supported = [{
    claimId: "claim-1-1",
    claimText: "Cardinality is the number of tuples or rows in a relation.",
    anchors: [anchor],
  }];
  const providerSelection = { attributions: [{ claimId: "claim-1-1", anchorIds: [anchor.anchorId] }] };
  assert.deepEqual(normalizeVerifiedAttributions(providerSelection, unsupported), []);
  assert.equal(normalizeVerifiedAttributions(providerSelection, supported).length, 1);
});

test("a deterministic fallback recovers only high-coverage direct definitions", () => {
  const cardinality = RELATIONAL_MODEL_CHUNKS.find((chunk) => chunk.number === 13).anchor;
  const candidates = [{
    claimId: "summary",
    claimText: "Cardinality is the number of tuples or rows in a relation at a given time.",
    anchors: [cardinality],
  }, {
    claimId: "claim-1-1",
    claimText: "Cardinality changes when tuples are inserted or deleted.",
    anchors: [cardinality],
  }];
  const recovered = addDeterministicDirectAttributions(candidates, []);
  assert.deepEqual(recovered.map((citation) => citation.claimId), ["summary"]);
  assert.equal(recovered[0].anchors[0].anchorId, cardinality.anchorId);
});
