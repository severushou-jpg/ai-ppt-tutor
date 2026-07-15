import assert from "node:assert/strict";
import test from "node:test";
import {
  parseStructuredResponse,
  renderStructuredMarkdown,
} from "../lib/structured-response.js";

const sources = [
  { id: 1, label: "第 1 页" },
  { id: 2, label: "第 2 页" },
];

test("structured claims keep valid citations and downgrade invalid ones", () => {
  const raw = JSON.stringify({
    summary: "回答概览",
    sections: [{
      heading: "结论",
      items: [
        { text: "有效结论", citations: [1], supported: true },
        { text: "无效引用", citations: [99], supported: true },
      ],
    }],
    quiz: [],
    partialRefusal: "第二项没有材料",
    suggestedQuestions: [],
  });
  const parsed = parseStructuredResponse(raw, sources, "qa");
  assert.equal(parsed.supportedClaimCount, 1);
  assert.equal(parsed.sections[0].items[1].supported, false);
  assert.deepEqual(parsed.sections[0].items[1].citations, []);
  assert.match(renderStructuredMarkdown(parsed, "qa"), /当前课件未提及/);
});

test("quiz questions and answers remain separate structured fields", () => {
  const raw = JSON.stringify({
    summary: "练习",
    sections: [],
    quiz: [{
      question: "什么是进程？",
      difficulty: "基础",
      answer: "执行中的程序",
      explanation: "依据定义",
      citations: [2],
    }],
    partialRefusal: null,
    suggestedQuestions: [],
  });
  const parsed = parseStructuredResponse(raw, sources, "quiz");
  assert.equal(parsed.quiz[0].question, "什么是进程？");
  assert.equal(parsed.quiz[0].answer, "执行中的程序");
  const markdown = renderStructuredMarkdown(parsed, "quiz");
  assert(markdown.indexOf("## 练习题") < markdown.indexOf("## 答案与解析"));
});

test("quiz items without valid evidence are not exposed as grounded answers", () => {
  const raw = JSON.stringify({
    summary: "练习",
    sections: [],
    quiz: [
      { question: "有依据", difficulty: "基础", answer: "答案", explanation: "解析", citations: [1] },
      { question: "无依据", difficulty: "基础", answer: "猜测", explanation: "猜测", citations: [] },
    ],
    partialRefusal: null,
    suggestedQuestions: [],
  });
  const parsed = parseStructuredResponse(raw, sources, "quiz");
  assert.equal(parsed.quiz.length, 1);
  assert.match(parsed.partialRefusal, /1 道题/);
});
