import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDocumentIndex,
  buildGroundingContext,
  createSources,
  extractSections,
  retrieveChunks,
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
  assert.equal(relevant[0].label, "幻灯片 1");
  assert.equal(relevant[1].label, "幻灯片 2");
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
  assert.match(context, /\[来源1｜intro\.pptx｜幻灯片 2\]/);
});
