import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRetrievalQueries,
  buildDocumentIndex,
  buildGroundingContext,
  createSources,
  evidenceReliability,
  extractSections,
  isDocumentWideQuestion,
  retrieveChunks,
  selectDocumentCoverage,
  tokenize,
} from "../lib/rag.js";

const sampleAst = {
  content: [
    {
      type: "slide",
      metadata: { slideNumber: 1 },
      text: "机器学习基础\n监督学习使用带标签的数据进行训练。分类和回归是常见任务。",
    },
    {
      type: "slide",
      metadata: { slideNumber: 2 },
      text: "无监督学习\n聚类用于发现没有标签的数据结构。K-means 是常见聚类算法。",
    },
  ],
  toText() {
    return this.content.map((node) => node.text).join("\n");
  },
};

test("extractSections preserves slide locators", () => {
  const sections = extractSections(sampleAst, "intro.pptx");
  assert.equal(sections.length, 2);
  assert.equal(sections[0].label, "幻灯片 1");
  assert.equal(sections[1].number, 2);
});

test("buildDocumentIndex creates source-aware chunks", () => {
  const index = buildDocumentIndex(sampleAst, { name: "intro.pptx" });
  assert.equal(index.sections.length, 2);
  assert.equal(index.chunks.length, 2);
  assert.equal(index.chunks[0].fileName, "intro.pptx");
  assert.equal(index.chunks[1].label, "幻灯片 2");
});

test("tokenize supports Chinese bigrams and English terms", () => {
  const tokens = tokenize("K-means 如何用于聚类算法？");
  assert(tokens.includes("k-means"));
  assert(tokens.includes("聚类"));
  assert(tokens.includes("算法"));
});

test("QA retrieval finds relevant evidence and rejects unrelated questions", () => {
  const { chunks } = buildDocumentIndex(sampleAst, { name: "intro.pptx" });
  const relevant = retrieveChunks({ question: "什么是监督学习？", chunks, mode: "qa" });
  const unrelated = retrieveChunks({ question: "法国的首都是哪里？", chunks, mode: "qa" });
  const genericButUnrelated = retrieveChunks({
    question: "这份课件如何进行量子纠缠实验？",
    chunks,
    mode: "qa",
  });
  assert(relevant.some((chunk) => chunk.label === "幻灯片 1"));
  assert(relevant.some((chunk) => chunk.label === "幻灯片 2"));
  assert.equal(unrelated.length, 0);
  assert.equal(genericButUnrelated.length, 0);
});

test("non-QA modes receive diverse document context", () => {
  const { chunks } = buildDocumentIndex(sampleAst, { name: "intro.pptx" });
  const results = retrieveChunks({ question: "请生成复习题", chunks, mode: "quiz" });
  assert.equal(results.length, 2);
});

test("sources and grounding context use stable source numbers", () => {
  const { chunks } = buildDocumentIndex(sampleAst, { name: "intro.pptx" });
  const results = retrieveChunks({ question: "聚类是什么？", chunks, mode: "qa" });
  const sources = createSources(results);
  const context = buildGroundingContext(results);
  assert.equal(sources[0].id, 1);
  assert.match(context, /\[来源1｜intro\.pptx｜幻灯片 2｜/);
});

test("structure-aware chunking preserves definitions, lists, tables and code", () => {
  const ast = {
    content: [{
      type: "slide",
      metadata: { slideNumber: 1 },
      text: "核心概念\n进程是指正在执行的程序。\n\n• 创建进程\n• 调度进程\n\n| 字段 | 含义 |\n| PID | 标识符 |\n\nconst pid = fork();",
    }],
  };
  const { chunks } = buildDocumentIndex(ast, { name: "os.pptx" });
  const types = new Set(chunks.flatMap((chunk) => chunk.structureTypes));
  assert.equal(chunks.length, 1);
  assert(types.has("definition"));
  assert(types.has("list"));
  assert(types.has("table"));
  assert(types.has("code"));
});

test("short slide pages stay intact instead of exhausting the document chunk limit", () => {
  const ast = {
    content: Array.from({ length: 57 }, (_, index) => ({
      type: "page",
      metadata: { pageNumber: index + 1 },
      text: `第 ${index + 1} 页\n• 定义与背景\n• 机制与实现\n• 示例与比较`,
    })),
  };
  const index = buildDocumentIndex(ast, { name: "threads.pdf" });
  assert.equal(index.chunks.length, 57);
  assert.equal(index.chunks.at(-1).number, 57);
  assert.equal(index.truncated, false);
});

test("whole-document questions use ordered document coverage", () => {
  assert.equal(isDocumentWideQuestion("请先概览这份课件的知识结构。", "explain"), true);
  assert.equal(isDocumentWideQuestion("请详细讲解一下这节课的内容。", "explain"), true);
  assert.equal(isDocumentWideQuestion("线程控制块是什么？", "qa"), false);
  const chunks = Array.from({ length: 56 }, (_, index) => ({
    id: `page-${index + 1}`,
    fileName: "threads.pdf",
    kind: "page",
    number: index + 1,
    label: `第 ${index + 1} 页`,
    title: `主题 ${index + 1}`,
    contentType: "list",
    text: `第 ${index + 1} 页的课程内容`,
  }));
  const selected = selectDocumentCoverage(chunks);
  assert.equal(selected.length, 56);
  assert.equal(selected[0].number, 1);
  assert.equal(selected.at(-1).number, 56);
});

test("semantic vectors can recall a chunk without keyword overlap", () => {
  const chunks = [
    { id: "a", fileName: "x.pdf", kind: "page", number: 1, label: "第 1 页", title: "并发", contentType: "prose", text: "线程同步", embedding: [1, 0] },
    { id: "b", fileName: "x.pdf", kind: "page", number: 2, label: "第 2 页", title: "存储", contentType: "prose", text: "磁盘调度", embedding: [0, 1] },
  ];
  const result = retrieveChunks({ question: "parallel execution", chunks, mode: "qa", queryEmbedding: [1, 0] });
  assert.equal(result[0].id, "a");
  assert.equal(result[0].vectorScore, 1);
});

test("sources include a query-focused sentence highlight", () => {
  const { chunks } = buildDocumentIndex(sampleAst, { name: "intro.pptx" });
  const results = retrieveChunks({ question: "聚类算法", chunks, mode: "qa" });
  const sources = createSources(results, "聚类算法");
  assert.match(sources[0].highlight, /聚类/);
  assert(sources[0].excerpt.includes(sources[0].highlight));
});

test("OCR confidence and vision reliability affect evidence weight", () => {
  assert.equal(evidenceReliability({ textOrigin: "native" }), 1);
  assert.ok(evidenceReliability({ textOrigin: "ocr", ocrConfidence: 20 }) <
    evidenceReliability({ textOrigin: "ocr", ocrConfidence: 90 }));
  assert.equal(evidenceReliability({ textOrigin: "vision", evidenceWeight: 0.88 }), 0.88);
});

test("multi-query expansion adds visual and comparison vocabulary", () => {
  const queries = buildRetrievalQueries("对比图表中的性能趋势");
  assert.ok(queries.length >= 3);
  assert.ok(queries.some((query) => /chart/.test(query)));
  assert.ok(queries.some((query) => /versus/.test(query)));
});
