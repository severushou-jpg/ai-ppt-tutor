import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { parseDocument } from "../lib/document-parser.js";
import { selectDocumentCoverage } from "../lib/rag.js";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: node --env-file=.env.local scripts/generate-evaluation-dataset.mjs <pdf...>");
  process.exit(1);
}
const apiKey = process.env.DASHSCOPE_API_KEY;
if (!apiKey) throw new Error("DASHSCOPE_API_KEY is required");

function parseJson(value) {
  const text = String(value ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  }
}

async function generateCases(document) {
  const coverage = selectDocumentCoverage(document.chunks, { maxChunks: 36, maxCharacters: 30_000 });
  const allowedIds = new Set(coverage.map((chunk) => chunk.id));
  const context = coverage.map((chunk) =>
    `[${chunk.id}｜${chunk.label}｜${chunk.title}]\n${chunk.text.slice(0, 900)}`,
  ).join("\n\n---\n\n");
  const response = await fetch("https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "qwen-plus",
      input: { messages: [{
        role: "user",
        content: `你正在为大学课件建立正式评测集。只能使用下面提供的课件证据，不得使用课外知识。请生成 10 道真实学习问题：overview 1道、detail 3道、visual 2道（优先代码/表格/图表；如果证据只含文字则仍标记 needsVisualReview=true）、review 1道、comparison 2道、unanswerable 1道。unanswerable 必须是与课程相关但证据无法回答的问题。严格返回 JSON 对象：{"cases":[{"category":"overview|detail|visual|review|comparison|unanswerable","question":"...","referenceAnswer":"...","relevantChunkIds":["page-1-chunk-1"],"shouldRefuse":false,"needsVisualReview":false,"difficulty":"easy|medium|hard"}]}。relevantChunkIds 只能使用证据方括号中的 ID；每个可回答问题必须至少有一个 ID；答案中的每个事实都必须由这些片段支持。\n\n课件：${document.name}\n\n${context}`,
      }] },
      parameters: {
        result_format: "message",
        response_format: { type: "json_object" },
        temperature: 0.1,
        max_tokens: 4_000,
      },
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.code) throw new Error(data?.message || `Question generation failed: ${response.status}`);
  const parsed = parseJson(data?.output?.choices?.[0]?.message?.content);
  return (Array.isArray(parsed?.cases) ? parsed.cases : []).slice(0, 12).map((item, index) => {
    const relevantChunkIds = Array.isArray(item?.relevantChunkIds)
      ? [...new Set(item.relevantChunkIds.map(String).filter((id) => allowedIds.has(id)))]
      : [];
    const category = ["overview", "detail", "visual", "review", "comparison", "unanswerable"].includes(item?.category)
      ? item.category : "detail";
    const shouldRefuse = category === "unanswerable" || item?.shouldRefuse === true;
    return {
      id: `${document.id.slice(0, 8)}-${String(index + 1).padStart(2, "0")}`,
      category,
      mode: category === "review" ? "review" : category === "overview" ? "explain" : "qa",
      question: String(item?.question ?? "").trim(),
      referenceAnswer: String(item?.referenceAnswer ?? "").trim(),
      relevantChunkIds: shouldRefuse ? [] : relevantChunkIds,
      shouldRefuse,
      needsVisualReview: category === "visual" || item?.needsVisualReview === true,
      difficulty: ["easy", "medium", "hard"].includes(item?.difficulty) ? item.difficulty : "medium",
      reviewStatus: "pending_human_review",
    };
  }).filter((item) => item.question && (item.shouldRefuse || item.relevantChunkIds.length > 0));
}

const documents = [];
const cases = [];
for (const [fileIndex, filePath] of files.entries()) {
  const bytes = await readFile(filePath);
  const name = path.basename(filePath);
  const file = new File([bytes], name, { type: "application/pdf" });
  console.error(`[${fileIndex + 1}/${files.length}] Parsing ${name}`);
  const document = await parseDocument(file, { ocrMode: "none" });
  const fingerprint = crypto.createHash("sha256").update(bytes).digest("hex");
  documents.push({
    id: document.id,
    name,
    fingerprint,
    pageCount: document.sectionCount,
    chunkCount: document.chunkCount,
    reviewStatus: "pending_human_review",
    chunks: document.chunks.map((chunk) => {
      const serializable = { ...chunk };
      delete serializable.embedding;
      delete serializable.visual;
      return serializable;
    }),
  });
  console.error(`[${fileIndex + 1}/${files.length}] Generating questions for ${name}`);
  const generated = await generateCases({ ...document, name });
  generated.forEach((item) => cases.push({ ...item, documentId: document.id }));
}

const dataset = {
  version: 1,
  name: "10 科目真实课件候选评测集 v1",
  generatedAt: new Date().toISOString(),
  reviewStatus: "pending_human_review",
  priorities: { overview: 0.30, detail: 0.25, visual: 0.20, review: 0.15, comparison: 0.10 },
  documents,
  cases,
  ocrSamples: [],
  humanReview: {
    required: true,
    note: "问题、参考答案、相关片段和视觉证据须经人工复核；OCR 字符准确率需另行录入人工转写样本。",
  },
};
const outputPath = path.resolve("evaluation/datasets/real-lectures-v1.json");
await writeFile(outputPath, `${JSON.stringify(dataset, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, documentCount: documents.length, caseCount: cases.length }, null, 2));
