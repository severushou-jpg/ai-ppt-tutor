function cleanText(value, maximum = 2_000) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function validCitationIds(value, validIds) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((id) => Number.isInteger(id) && validIds.has(id)))];
}

function citationSuffix(citations) {
  return citations.map((id) => `[来源${id}]`).join(" ");
}

export function parseStructuredResponse(content, sources, mode, options = {}) {
  let raw;
  try {
    raw = typeof content === "string" ? JSON.parse(content) : content;
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;

  const validIds = new Set(sources.map((source) => source.id));
  const requireCitations = options.requireCitations !== false;
  const sections = (Array.isArray(raw.sections) ? raw.sections : [])
    .slice(0, 8)
    .map((section) => ({
      heading: cleanText(section?.heading, 120) || "核心内容",
      items: (Array.isArray(section?.items) ? section.items : [])
        .slice(0, 12)
        .map((item) => {
          const citations = validCitationIds(item?.citations, validIds);
          return {
            text: cleanText(item?.text),
            citations,
            supported: item?.supported !== false && (!requireCitations || citations.length > 0),
          };
        })
        .filter((item) => item.text),
    }))
    .filter((section) => section.items.length > 0);

  const quizCandidates = (Array.isArray(raw.quiz) ? raw.quiz : [])
    .slice(0, 8)
    .map((item) => ({
      question: cleanText(item?.question, 800),
      difficulty: ["基础", "进阶", "应用"].includes(item?.difficulty) ? item.difficulty : "基础",
      answer: cleanText(item?.answer, 1_200),
      explanation: cleanText(item?.explanation, 1_600),
      citations: validCitationIds(item?.citations, validIds),
    }))
    .filter((item) => item.question && item.answer);
  const quiz = requireCitations
    ? quizCandidates.filter((item) => item.citations.length > 0)
    : quizCandidates;

  const suggestedQuestions = (Array.isArray(raw.suggestedQuestions) ? raw.suggestedQuestions : [])
    .map((item) => cleanText(item, 180))
    .filter(Boolean)
    .slice(0, 3);
  const summary = cleanText(raw.summary, 1_000);
  const partialRefusal = cleanText(raw.partialRefusal, 800) ||
    (requireCitations && mode === "quiz" && quiz.length < quizCandidates.length
      ? `${quizCandidates.length - quiz.length} 道题因缺少可核查的课件引用而未显示。`
      : null);
  if (!summary && sections.length === 0 && quiz.length === 0 && !partialRefusal) return null;

  const structured = {
    summary,
    sections,
    quiz: mode === "quiz" ? quiz : [],
    partialRefusal,
    suggestedQuestions,
  };
  const supportedClaimCount = sections.reduce(
    (count, section) => count + section.items.filter((item) => item.supported).length,
    0,
  ) + quiz.filter((item) => !requireCitations || item.citations.length > 0).length;
  return { ...structured, supportedClaimCount };
}

export function renderStructuredMarkdown(structured, mode) {
  const lines = [];

  for (const section of structured.sections) {
    lines.push(`## ${section.heading}`);
    for (const item of section.items) {
      lines.push(
        item.supported
          ? `- ${item.text} ${citationSuffix(item.citations)}`
          : `- **当前课件未提及：** ${item.text}`,
      );
    }
  }

  if (mode === "quiz" && structured.quiz.length > 0) {
    lines.push("## 练习题");
    structured.quiz.forEach((item, index) => {
      lines.push(`${index + 1}. **[${item.difficulty}]** ${item.question}`);
    });
    lines.push("## 答案与解析");
    structured.quiz.forEach((item, index) => {
      const citation = citationSuffix(item.citations);
      lines.push(`${index + 1}. **答案：** ${item.answer}\n\n   **解析：** ${item.explanation} ${citation}`);
    });
  }

  if (structured.partialRefusal) {
    lines.push(`> **课件未覆盖的部分：** ${structured.partialRefusal}`);
  }
  return lines.filter(Boolean).join("\n\n").trim();
}

export function createRefusalStructured(message) {
  return {
    summary: "",
    sections: [],
    quiz: [],
    partialRefusal: message,
    suggestedQuestions: [],
    supportedClaimCount: 0,
  };
}
