import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  expandWithAdjacentChunks,
  retrieveChunks,
  selectDiverseEvidence,
  selectDocumentCoverage,
} from "../lib/rag.js";
import { embedDocumentChunks, embedTexts, rerankChunks } from "../lib/dashscope-retrieval.js";
import {
  ndcgAtK,
  ocrCharacterAccuracy,
  recallAtK,
  reciprocalRank,
  summarizeRetrievalCases,
} from "../lib/evaluation.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argumentsList = process.argv.slice(2);
const online = argumentsList.includes("--online");
const datasetArgument = argumentsList.find((argument) => !argument.startsWith("--"));
const datasetPath = datasetArgument
  ? path.resolve(datasetArgument)
  : path.join(root, "evaluation", "datasets", "joint-v1.json");
const dataset = JSON.parse(await readFile(datasetPath, "utf8"));
const apiKey = process.env.DASHSCOPE_API_KEY;
if (online && !apiKey) throw new Error("--online requires DASHSCOPE_API_KEY");

const preparedDocuments = [];
for (const [index, document] of dataset.documents.entries()) {
  if (!online) {
    preparedDocuments.push(document);
    continue;
  }
  console.error(`[embedding ${index + 1}/${dataset.documents.length}] ${document.name ?? document.id}`);
  preparedDocuments.push({
    ...document,
    chunks: await embedDocumentChunks(document.chunks, apiKey, { timeoutMs: 30_000 }),
  });
}
const documents = new Map(preparedDocuments.map((document) => [document.id, document]));
const scoredCases = dataset.cases.filter((testCase) => !testCase.shouldRefuse && testCase.relevantChunkIds?.length);
const queryEmbeddings = new Map();
if (online) {
  for (let start = 0; start < scoredCases.length; start += 10) {
    const batch = scoredCases.slice(start, start + 10);
    const vectors = await embedTexts(batch.map((testCase) => testCase.question), apiKey, { timeoutMs: 30_000 });
    batch.forEach((testCase, index) => queryEmbeddings.set(testCase.id, vectors[index]));
  }
}

async function mapWithConcurrency(items, concurrency, operation) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await operation(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

const cases = await mapWithConcurrency(scoredCases, online ? 3 : 1, async (testCase, caseIndex) => {
  const document = documents.get(testCase.documentId);
  if (!document) throw new Error(`Missing document fixture: ${testCase.documentId}`);
  const documentWide = testCase.category === "overview" || testCase.mode === "review";
  let selected;
  if (documentWide) {
    selected = selectDocumentCoverage(document.chunks);
  } else {
    const candidates = retrieveChunks({
      question: testCase.question,
      chunks: document.chunks,
      mode: testCase.mode,
      topK: online ? 40 : 10,
      queryEmbedding: queryEmbeddings.get(testCase.id),
    });
    let ranked = candidates;
    if (online && candidates.length) {
      try {
        ranked = await rerankChunks(testCase.question, candidates, apiKey, {
          topK: Math.min(12, candidates.length),
          timeoutMs: 30_000,
        });
        if (testCase.mode === "qa") ranked = ranked.filter((chunk) => chunk.rerankScore >= 0.12);
      } catch (error) {
        console.error(`[rerank fallback] ${testCase.id}: ${error.message}`);
      }
      selected = expandWithAdjacentChunks(
        selectDiverseEvidence(ranked, 8),
        document.chunks,
        10,
      );
    } else {
      selected = ranked;
    }
  }
  if (online && (caseIndex + 1) % 10 === 0) console.error(`[retrieval ${caseIndex + 1}/${scoredCases.length}]`);
  const retrieved = selected.map((chunk) => chunk.id);
  const metricK = documentWide ? Math.max(retrieved.length, 1) : 10;
  const recall = recallAtK(retrieved, testCase.relevantChunkIds, metricK);
  return {
    id: testCase.id,
    category: testCase.category,
    evaluationKind: documentWide ? "document_coverage" : online ? "hybrid_reranked" : "offline_retrieval",
    retrieved,
    recallAt10: recall,
    mrr: documentWide ? recall : reciprocalRank(retrieved, testCase.relevantChunkIds),
    ndcgAt10: documentWide ? recall : ndcgAtK(retrieved, testCase.relevantChunkIds, 10),
  };
});
const retrieval = summarizeRetrievalCases(cases, dataset.priorities);
const ocrSamples = Array.isArray(dataset.ocrSamples) ? dataset.ocrSamples : [];
const ocrAccuracy = ocrSamples.reduce(
  (sum, sample) => sum + ocrCharacterAccuracy(sample.actual, sample.expected),
  0,
) / Math.max(ocrSamples.length, 1);
const refusalCases = dataset.cases.filter((testCase) => testCase.shouldRefuse);
const categoryScoreValues = Object.values(retrieval.categoryScores).filter(Number.isFinite);
const report = {
  dataset: dataset.name,
  mode: online ? "hybrid_embedding_reranker" : "offline_keyword_multi_query",
  generatedAt: new Date().toISOString(),
  priorities: dataset.priorities,
  retrieval,
  ocr: {
    characterAccuracy: ocrSamples.length ? ocrAccuracy : null,
    sampleCount: ocrSamples.length,
    status: ocrSamples.length ? "scored" : "pending_human_ground_truth",
  },
  refusal: {
    caseCount: refusalCases.length,
    status: refusalCases.length ? "pending_end_to_end_answer_review" : "not_applicable",
  },
  cases,
  gates: {
    retrievalRecallAt10: retrieval.recallAt10 >= 0.85,
    retrievalMrr: retrieval.mrr >= 0.75,
    scenarioCategoryFloor: categoryScoreValues.length > 0 && Math.min(...categoryScoreValues) >= 0.75,
    ...(ocrSamples.length ? { ocrCharacterAccuracy: ocrAccuracy >= 0.9 } : {}),
  },
};
const reportsDirectory = path.join(root, "evaluation", "reports");
await mkdir(reportsDirectory, { recursive: true });
await writeFile(path.join(reportsDirectory, "latest.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  dataset: report.dataset,
  mode: report.mode,
  retrieval: report.retrieval,
  ocr: report.ocr,
  refusal: report.refusal,
  gates: report.gates,
  reportPath: path.join(reportsDirectory, "latest.json"),
}, null, 2));
if (Object.values(report.gates).some((passed) => !passed)) process.exitCode = 1;
