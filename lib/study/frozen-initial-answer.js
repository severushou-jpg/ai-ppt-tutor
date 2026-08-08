import {
  coreAnswerHash,
  STUDY_MATERIAL_VERSION,
  STUDY_PROMPT_VERSION,
} from "./canonical.js";
import { factorsForCondition } from "./conditions.js";
import { getRelationalModelAnchor } from "./relational-model-material.js";

export const FROZEN_ANSWER_PACK_VERSION = "relational-model-initial-v3-grounded-audit";
export const FROZEN_CITATION_MAP_VERSION = "relational-model-citations-v1";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

function renderCoreMarkdown(answer) {
  const lines = [];
  if (answer.summary) lines.push(answer.summary);
  for (const section of answer.sections) {
    lines.push(`## ${section.heading}`);
    for (const claim of section.claims) lines.push(`- ${claim.text}`);
  }
  return lines.join("\n\n");
}

function createCore(summary, sections) {
  const answer = { summary, sections };
  const coreHash = coreAnswerHash(answer);
  return deepFreeze({
    coreId: `initial-${coreHash.slice(0, 16)}`,
    coreHash,
    summary,
    sections,
    content: renderCoreMarkdown(answer),
  });
}

const UNGROUNDED_CORE = createCore(
  "The relational model organises data as relations and gives us precise language for describing rows, columns, schemas and the connections between tables.",
  [
    {
      id: "u-section-1",
      heading: "1. The big picture",
      claims: [
        { id: "u-1", text: "A relational database represents data through relations, normally shown as tables, while queries specify what information is wanted rather than a step-by-step storage procedure." },
        { id: "u-2", text: "A table is the visual representation; formally, a relation is a set of tuples that share the same schema." },
      ],
    },
    {
      id: "u-section-2",
      heading: "2. Relation, schema, attribute, domain and tuple",
      claims: [
        { id: "u-3", text: "An attribute is a named column, while a tuple is one row in a relation." },
        { id: "u-3b", text: "A schema is the collection of attributes, and a domain is the permitted set of values for one attribute." },
        { id: "u-4", text: "Hypothetical example - not taken directly from the lecture. Suppose Person(Name, Age) is a relation: Person is the relation name, (Name, Age) is the schema, Name and Age are attributes, and (Amina, 21) is one illustrative tuple." },
      ],
    },
    {
      id: "u-section-3",
      heading: "3. Size and properties of a relation",
      claims: [
        { id: "u-5", text: "Degree counts the attributes or columns; cardinality counts the tuples or rows." },
        { id: "u-6", text: "Each cell contains one value, and values in an attribute come from the same domain." },
        { id: "u-6b", text: "The order of rows or columns does not change the relation's meaning." },
      ],
    },
    {
      id: "u-section-4",
      heading: "4. From superkeys to primary keys",
      claims: [
        { id: "u-7", text: "A superkey uniquely identifies a tuple, while a candidate key is a minimal superkey." },
        { id: "u-7b", text: "A candidate key must satisfy both uniqueness and irreducibility." },
        { id: "u-8", text: "A primary key is the candidate key selected to serve as the main identifier for tuples in a relation." },
      ],
    },
    {
      id: "u-section-5",
      heading: "5. Reasoning about candidate keys",
      claims: [
        { id: "u-9", text: "Hypothetical example - not taken directly from the lecture. Suppose Account(AccountID, Email, DisplayName) is a relation: AccountID and Email could each be candidate keys if the assumed data rules guarantee that each is unique." },
        { id: "u-10", text: "A table snapshot may happen to contain unique values without proving that an attribute is a valid key; key selection also depends on the real-world rules." },
      ],
    },
    {
      id: "u-section-6",
      heading: "6. Foreign keys and referential integrity",
      claims: [
        { id: "u-11", text: "Hypothetical example - not taken directly from the lecture. Suppose Enrolment(StudentID, CourseID) is a relation: StudentID could reference a Student relation and CourseID could reference a Course relation." },
        { id: "u-12", text: "Referential integrity requires every non-NULL foreign-key value to match an eligible key value in the referenced relation." },
      ],
    },
    {
      id: "u-section-7",
      heading: "7. A compact way to remember the topic",
      claims: [
        { id: "u-13", text: "Think in this order: describe the relation's structure, count its degree and cardinality, identify minimal unique keys, select a primary key, and then check foreign-key references." },
        { id: "u-14", text: "The key distinction is purpose: candidate keys are eligible identifiers, the primary key is the chosen identifier, and a foreign key creates a reference to another relation." },
      ],
    },
  ],
);

const GROUNDED_CORE = createCore(
  "This lecture develops the relational model from its basic data structure through keys and referential integrity, using Student, Employee, Office and Department examples.",
  [
    {
      id: "g-section-1",
      heading: "1. The lecture's central idea",
      claims: [
        { id: "g-1", text: "The relational model was introduced by E. F. Codd and underpins most modern database management systems." },
        { id: "g-1b", text: "It provides a declarative way to specify data and queries." },
        { id: "g-2", text: "The lecture moves from relational terminology to candidate and primary keys, then to foreign keys and referential integrity." },
      ],
    },
    {
      id: "g-section-2",
      heading: "2. Building a relation",
      claims: [
        { id: "g-3", text: "A relation is a set of tuples with the same schema: attributes form the named columns and tuples form the rows." },
        { id: "g-3b", text: "The schema defines the attributes, and each attribute draws values from its domain." },
        { id: "g-4", text: "The lecture writes the example as Student(Name, Age), with schema (Name, Age) and a tuple such as (John, 23)." },
      ],
    },
    {
      id: "g-section-3",
      heading: "3. Describing relation size and behaviour",
      claims: [
        { id: "g-5", text: "Degree is the number of attributes, whereas cardinality is the number of tuples." },
        { id: "g-5b", text: "The Employee example therefore has degree 4 and cardinality 5." },
        { id: "g-6", text: "The lecture states that each cell contains one value and that attribute values share a domain." },
        { id: "g-6b", text: "Neither tuple order nor attribute order is significant." },
      ],
    },
    {
      id: "g-section-4",
      heading: "4. Candidate and primary keys",
      claims: [
        { id: "g-7", text: "A superkey uniquely identifies a tuple, while a candidate key is a minimal superkey." },
        { id: "g-7b", text: "Candidate keys satisfy uniqueness and irreducibility: no proper subset remains unique." },
        { id: "g-8", text: "A primary key is selected from the relation's candidate keys to identify its tuples." },
      ],
    },
    {
      id: "g-section-5",
      heading: "5. Applying the key definitions to Office",
      claims: [
        { id: "g-9", text: "For Office, the lecture identifies four candidate keys: OfficeID, Phone, (Name, Postcode), and (Name, Country)." },
        { id: "g-10", text: "The lecture warns that candidate keys cannot necessarily be inferred from the current rows alone; real-world knowledge is required." },
      ],
    },
    {
      id: "g-section-6",
      heading: "6. Linking Department and Employee",
      claims: [
        { id: "g-11", text: "A foreign key in one relation matches a candidate key in another relation; in the example, DID is the foreign key of Employee." },
        { id: "g-12", text: "Referential integrity requires each foreign-key value to match a primary or candidate key value in the referenced relation, or to be NULL." },
      ],
    },
    {
      id: "g-section-7",
      heading: "7. The reasoning sequence to practise",
      claims: [
        { id: "g-14", text: "Keep the roles separate: candidate keys are all minimal eligible identifiers, the primary key is the one selected, and a foreign key expresses a cross-relation reference." },
      ],
    },
  ],
);

export const FROZEN_INITIAL_CORES = deepFreeze({
  U: UNGROUNDED_CORE,
  G: GROUNDED_CORE,
});

const ATTRIBUTION_IDS = deepFreeze({
  U: {
    "u-1": ["dbi-rm-p7-a1", "dbi-rm-p6-a1"],
    "u-2": ["dbi-rm-p7-a1", "dbi-rm-p10-a3"],
    "u-3": ["dbi-rm-p7-a2", "dbi-rm-p7-a3"],
    "u-3b": ["dbi-rm-p10-a2", "dbi-rm-p8-a1"],
    "u-5": ["dbi-rm-p13-a2", "dbi-rm-p13-a1"],
    "u-6": ["dbi-rm-p16-a2", "dbi-rm-p16-a3"],
    "u-6b": ["dbi-rm-p16-a1", "dbi-rm-p16-a4"],
    "u-7": ["dbi-rm-p20-a2", "dbi-rm-p20-a1"],
    "u-7b": ["dbi-rm-p20-a3", "dbi-rm-p20-a4"],
    "u-8": ["dbi-rm-p23-a1"],
    "u-10": ["dbi-rm-p22-a2"],
    "u-12": ["dbi-rm-p25-a3", "dbi-rm-p25-a4"],
    "u-14": ["dbi-rm-p20-a1", "dbi-rm-p23-a1", "dbi-rm-p25-a2"],
  },
  G: {
    summary: ["dbi-rm-p9-a1", "dbi-rm-p14-a1", "dbi-rm-p24-a1"],
    "g-1": ["dbi-rm-p6-a2", "dbi-rm-p6-a3"],
    "g-1b": ["dbi-rm-p6-a1"],
    "g-2": ["dbi-rm-p3-a1", "dbi-rm-p3-a2", "dbi-rm-p3-a3"],
    "g-3": ["dbi-rm-p10-a3", "dbi-rm-p7-a2", "dbi-rm-p7-a3"],
    "g-3b": ["dbi-rm-p10-a2", "dbi-rm-p8-a1"],
    "g-4": ["dbi-rm-p9-a1", "dbi-rm-p9-a2", "dbi-rm-p9-a4"],
    "g-5": ["dbi-rm-p13-a2", "dbi-rm-p13-a1"],
    "g-5b": ["dbi-rm-p15-a1", "dbi-rm-p15-a2"],
    "g-6": ["dbi-rm-p16-a2", "dbi-rm-p16-a3"],
    "g-6b": ["dbi-rm-p16-a1", "dbi-rm-p16-a4"],
    "g-7": ["dbi-rm-p20-a2", "dbi-rm-p20-a1"],
    "g-7b": ["dbi-rm-p20-a3", "dbi-rm-p20-a4"],
    "g-8": ["dbi-rm-p23-a1"],
    "g-9": ["dbi-rm-p22-a1"],
    "g-10": ["dbi-rm-p22-a2"],
    "g-11": ["dbi-rm-p25-a2", "dbi-rm-p27-a1"],
    "g-12": ["dbi-rm-p25-a3", "dbi-rm-p25-a4"],
    "g-14": ["dbi-rm-p20-a1", "dbi-rm-p23-a1", "dbi-rm-p25-a2"],
  },
});

function citationsForVariant(variant) {
  return Object.entries(ATTRIBUTION_IDS[variant]).map(([claimId, anchorIds]) => ({
    claimId,
    anchors: anchorIds.map((anchorId) => getRelationalModelAnchor(anchorId)).filter(Boolean),
  }));
}

export function getFrozenInitialResponse(condition) {
  const factors = factorsForCondition(condition);
  const answer = FROZEN_INITIAL_CORES[factors.coreVariant];
  return deepFreeze({
    answer,
    citations: factors.attribution ? citationsForVariant(factors.coreVariant) : [],
    grounding: {
      enabled: factors.grounding,
      strategy: factors.grounding ? "frozen_grounded" : "frozen_ungrounded",
      evidenceCount: factors.grounding ? 20 : 0,
    },
    attribution: { enabled: factors.attribution },
    frozen: true,
    version: {
      answerPack: FROZEN_ANSWER_PACK_VERSION,
      citationMap: FROZEN_CITATION_MAP_VERSION,
      material: STUDY_MATERIAL_VERSION,
      prompt: STUDY_PROMPT_VERSION,
    },
  });
}

export function validateFrozenInitialAnswerPack() {
  const packages = Object.fromEntries(
    ["A", "B", "C", "D"].map((condition) => [condition, getFrozenInitialResponse(condition)]),
  );
  const errors = [];
  if (packages.A.answer.coreHash !== packages.C.answer.coreHash) errors.push("A/C core hash mismatch");
  if (packages.B.answer.coreHash !== packages.D.answer.coreHash) errors.push("B/D core hash mismatch");
  if (packages.A.citations.length !== 0 || packages.B.citations.length !== 0) {
    errors.push("Attribution-off packages contain citations");
  }
  if (packages.C.citations.length === 0 || packages.D.citations.length === 0) {
    errors.push("Attribution-on packages have no citations");
  }
  if (new Set(Object.values(packages).map((entry) => entry.answer.coreHash)).size !== 2) {
    errors.push("Frozen pack must contain exactly two unique core answers");
  }
  return { valid: errors.length === 0, errors, packages };
}
