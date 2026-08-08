import {
  expandWithAdjacentChunks,
  retrieveChunks,
  selectDiverseEvidence,
} from "../rag.js";
import { STUDY_MATERIAL_VERSION } from "./canonical.js";
import { rectanglesForRelationalModelAnchor } from "./anchor-rectangles.js";

export const RELATIONAL_MODEL_PDF_SHA256 =
  "fc51ca07bcf6a74cc83b1e790f9a6fda8f73dbbc26ee0b7ac4071ac22ef7f879";
export const RELATIONAL_MODEL_FILE_NAME = "DBI_Relational_Model.pdf";
export const RELATIONAL_MODEL_PUBLIC_PATH = "/study/DBI_Relational_Model.pdf";

function pageChunk(pdfPage, lectureSlide, title, text, exactQuote, contentType = "prose") {
  const id = `dbi-rm-p${pdfPage}`;
  const anchorId = `${id}-a1`;
  return Object.freeze({
    id,
    fileName: RELATIONAL_MODEL_FILE_NAME,
    kind: "page",
    number: pdfPage,
    label: `Lecture slide ${lectureSlide} · PDF page ${pdfPage}`,
    lectureSlide,
    title,
    contentType,
    text,
    textOrigin: "native",
    evidenceWeight: 1,
    anchor: Object.freeze({
      anchorId,
      materialVersion: STUDY_MATERIAL_VERSION,
      pdfSha256: RELATIONAL_MODEL_PDF_SHA256,
      pdfPage,
      lectureSlide,
      origin: "native",
      exactQuote,
      // Coordinates are page-relative (top-left origin) and normalized to 0..1.
      rectangles: Object.freeze(rectanglesForRelationalModelAnchor(anchorId)),
      supportType: "direct",
    }),
  });
}

export const RELATIONAL_MODEL_CHUNKS = Object.freeze([
  pageChunk(3, 1, "Content",
    "The lecture covers the relational model definition, structure and terminology; candidate, primary and foreign keys; and entity and referential integrity.",
    "Relational Model - definition, structure, terminology."),
  pageChunk(4, 2, "Learning Outcomes",
    "Learning outcomes include understanding the relational model and its components, identifying keys, designing primary and foreign keys, and understanding referential integrity.",
    "Understand what is the relational model."),
  pageChunk(6, 3, "What is the Relational Model?",
    "The relational model is an approach to managing data using a structure and language consistent with first-order predicate logic. E. F. Codd introduced it in 1970. It underpins most modern DBMSs and provides a declarative method for specifying data and queries.",
    "Provide a declarative method for specifying data and queries."),
  pageChunk(7, 4, "Relational Data Structure",
    "Data is stored in relations, represented as tables with columns and rows. An attribute is a named column. A relation is a set of tuples (rows), for example (John, 23).",
    "A relation is a set of tuples."),
  pageChunk(8, 5, "Schema and Domain",
    "Each relation has a schema, sometimes called a heading. The schema defines the relation's attributes. Every attribute has a corresponding domain: the set from which its possible values can come.",
    "Each attribute has a corresponding domain."),
  pageChunk(9, 6, "Representing Relations",
    "The Student example uses attributes Name and Age, schema (Name, Age), relation notation Student(Name, Age), and the tuple (John, 23), which can also be written with attribute names.",
    "Student(Name, Age)", "table"),
  pageChunk(10, 7, "Formal Relational Structure",
    "A relational schema is a set of attributes. A tuple assigns a value to each attribute in the schema. A relation is a set of tuples with the same schema.",
    "A tuple assigns a value to each attribute in the schema."),
  pageChunk(13, 10, "Degree and Cardinality",
    "The degree of a relation is the number of attributes in its relational schema, or number of columns. The cardinality is the number of tuples, or number of rows.",
    "Cardinality of a relation: the number of tuples in a relation, i.e., how many rows."),
  pageChunk(14, 11, "Employee Example",
    "The Employee relation has columns ID, Name, Salary and Department and five displayed employee tuples.",
    "ID Name Salary Department", "table"),
  pageChunk(15, 12, "Employee Example Answers",
    "Employee has attributes ID, Name, Salary and Department; schema (ID, Name, Salary, Department); degree 4; and cardinality 5.",
    "Degree: 4"),
  pageChunk(16, 13, "Properties of Relations",
    "Each relation and each attribute has a distinct name. Each cell contains one value, values within an attribute come from the same domain, and neither attribute order nor tuple order has significance.",
    "The order of tuples has no significance."),
  pageChunk(17, 14, "Problems without DBMS",
    "Problems without a DBMS include lack of standards, incompatible file formats, data duplication, data dependence, fixed queries, concurrency and security problems, and lack of theoretical foundations.",
    "Data duplication."),
  pageChunk(20, 17, "Candidate Keys",
    "A superkey is an attribute or set of attributes that uniquely identifies a tuple. A candidate key is a superkey with no proper subset that is itself a superkey. Candidate keys therefore satisfy uniqueness and irreducibility.",
    "Candidate Key: a superkey such that no proper subset is a superkey within the relation."),
  pageChunk(21, 18, "Office Relation",
    "The Office relation contains OfficeID, Name, Country, Postcode and Phone for six offices.",
    "OfficeID Name Country Postcode Phone", "table"),
  pageChunk(22, 19, "Office Candidate Keys",
    "The listed candidate keys for Office are OfficeID, Phone, (Name, Postcode), and (Name, Country). Candidate keys cannot necessarily be inferred from the displayed rows alone; real-world knowledge is needed.",
    "Candidate Keys: OfficeID, Phone, (Name, Postcode), (Name, Country)"),
  pageChunk(23, 20, "Primary Keys and NULLs",
    "A primary key is selected from the set of candidate keys to identify tuples in a relation. NULL indicates a missing or unknown value.",
    "A primary key is selected from the set of candidate key to identify tuples in a relation."),
  pageChunk(24, 21, "Department and Employee Relations",
    "Department contains DID and DName. Employee contains EID, EName and DID. Employee examples include DID values 13, 14, 13 and NULL.",
    "EID EName DID", "table"),
  pageChunk(25, 22, "Foreign Keys and Referential Integrity",
    "An attribute or attribute set F in one relation is a foreign key if it matches a candidate key in another relation. Referential integrity requires each foreign-key value to match a primary or candidate key value in the referenced relation, or be NULL.",
    "each value of F must", "definition"),
  pageChunk(26, 23, "Foreign Key Example",
    "The Department and Employee example asks which Employee attribute forms the foreign key linking the relations.",
    "What is the foreign key?", "table"),
  pageChunk(27, 24, "Foreign Key Answer",
    "DID is the foreign key of Employee.",
    "DID is the foreign key of Employee.", "definition"),
]);

const CHUNK_BY_ID = new Map(RELATIONAL_MODEL_CHUNKS.map((chunk) => [chunk.id, chunk]));

function additionalAnchor(pdfPage, lectureSlide, index, exactQuote) {
  const anchorId = `dbi-rm-p${pdfPage}-a${index}`;
  return Object.freeze({
    anchorId,
    materialVersion: STUDY_MATERIAL_VERSION,
    pdfSha256: RELATIONAL_MODEL_PDF_SHA256,
    pdfPage,
    lectureSlide,
    origin: "native",
    exactQuote,
    rectangles: Object.freeze(rectanglesForRelationalModelAnchor(anchorId)),
    supportType: "direct",
  });
}

const ADDITIONAL_ANCHORS = Object.freeze([
  additionalAnchor(3, 1, 2, "Candidate, Primary and Foreign Keys."),
  additionalAnchor(3, 1, 3, "Entity and Referential Integrity."),
  additionalAnchor(6, 3, 2, "Originally introduced by E.F. Codd in his paper in 1970:"),
  additionalAnchor(6, 3, 3, "The foundation for most (but not all) modern DBMS."),
  additionalAnchor(7, 4, 2, "An attribute of a relation is a column in the table."),
  additionalAnchor(7, 4, 3, "A mathematical relation is a set of tuples(rows)"),
  additionalAnchor(8, 5, 2, "Schemas define the relation’s attributes."),
  additionalAnchor(9, 6, 2, "Attribute: the name of each attribute, e.g., Age"),
  additionalAnchor(9, 6, 3, "E.g., (Name, Age)."),
  additionalAnchor(9, 6, 4, "(John, 23)"),
  additionalAnchor(10, 7, 2, "A relational schema is a set of attributes."),
  additionalAnchor(10, 7, 3, "A relation is a set of tuples with the same schema."),
  additionalAnchor(13, 10, 2, "Degree of a relation: the number of attributes in the relational schema, i.e., how many columns."),
  additionalAnchor(14, 11, 2, "Employee"),
  additionalAnchor(15, 12, 2, "Cardinality: 5"),
  additionalAnchor(15, 12, 3, "Employee(ID, Name, Salary, Department)"),
  additionalAnchor(16, 13, 2, "Each cell contains exactly one single value."),
  additionalAnchor(16, 13, 3, "The values of an attribute are all from the same domain."),
  additionalAnchor(16, 13, 4, "The order of attributes has no significance."),
  additionalAnchor(20, 17, 2, "SuperKey: an attribute, or a set of attributes, that uniquely identifies a tuple within a relation."),
  additionalAnchor(20, 17, 3, "In each tuple of R, the values of K uniquely identify that tuple."),
  additionalAnchor(20, 17, 4, "There is no subset of K can uniquely identify the tuples in R."),
  additionalAnchor(22, 19, 2, "You cannot necessarily infer the candidate keys based solely on the data in your table."),
  additionalAnchor(23, 20, 2, "A NULL indicates a missing or unknown value in a relation."),
  additionalAnchor(25, 22, 2, "An attribute, or set of attributes F within one relation R1 is a foreign key, if it matches the candidate key in another relation."),
  additionalAnchor(25, 22, 3, "matche a primary/candidate key values in R2"),
  additionalAnchor(25, 22, 4, "be Null"),
]);

const ALL_ANCHORS = Object.freeze([
  ...RELATIONAL_MODEL_CHUNKS.map((chunk) => chunk.anchor),
  ...ADDITIONAL_ANCHORS,
]);
export const RELATIONAL_MODEL_ANCHORS = ALL_ANCHORS;
const ANCHOR_BY_ID = new Map(ALL_ANCHORS.map((anchor) => [anchor.anchorId, anchor]));

export function getRelationalModelChunk(chunkId) {
  return CHUNK_BY_ID.get(chunkId) ?? null;
}

export function getRelationalModelAnchor(anchorId) {
  return ANCHOR_BY_ID.get(anchorId) ?? null;
}

export function getRelationalModelAnchorsForChunk(chunkId) {
  const prefix = `${chunkId}-a`;
  return ALL_ANCHORS.filter((anchor) => anchor.anchorId.startsWith(prefix));
}

export function anchorForEvidenceChunk(chunk, supportType = "direct") {
  const anchor = getRelationalModelChunk(chunk.id)?.anchor;
  return anchor ? Object.freeze({ ...anchor, supportType }) : null;
}

export function retrieveRelationalModelEvidence(question, options = {}) {
  const topK = Math.max(1, Math.min(12, Number(options.topK) || 8));
  const candidates = retrieveChunks({
    question,
    chunks: RELATIONAL_MODEL_CHUNKS,
    mode: "explain",
    topK: Math.max(topK * 3, 20),
    queryEmbedding: null,
  });
  if (candidates.length === 0) return [];
  const diverse = selectDiverseEvidence(candidates, Math.min(topK, candidates.length));
  return expandWithAdjacentChunks(diverse, RELATIONAL_MODEL_CHUNKS, topK);
}

export function buildRelationalModelGroundingContext(chunks) {
  return chunks.map((chunk) =>
    `[${chunk.anchor.anchorId}] ${chunk.label} — ${chunk.title}\n${chunk.text}`,
  ).join("\n\n");
}
