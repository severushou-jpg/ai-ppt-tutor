const HAN_RANGE = /[\u3400-\u9fff]/;
const LATIN_TOKEN = /[a-z0-9][a-z0-9._+-]*/gi;
const HAN_SEQUENCE = /[\u3400-\u9fff]+/g;

const ENGLISH_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
  "how", "in", "is", "it", "of", "on", "or", "that", "the", "this",
  "to", "was", "what", "when", "where", "which", "who", "why", "with",
]);

const CHINESE_STOP_TOKENS = new Set([
  "一个", "一些", "什么", "如何", "可以", "这个", "这些", "那个", "那些",
  "我们", "你们", "他们", "是否", "怎么", "为什么", "请问", "一下",
]);

const CHINESE_STOP_PHRASES =
  /请问|这份|当前|课件中|课件里|课件|文档中|文档里|文档|关于|相关|具体|一下|如何|怎么|为什么|是什么|有哪些|是否|可以|进行|请|的/g;

export const DOCUMENT_LIMITS = Object.freeze({
  maxFileBytes: 20 * 1024 * 1024,
  maxSections: 120,
  maxExtractedCharacters: 180_000,
  maxChunks: 180,
  chunkSize: 1_200,
  chunkOverlap: 160,
});

export function normalizeWhitespace(value) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function collectNodeText(node) {
  const ownText = normalizeWhitespace(node?.text);
  if (ownText) return ownText;
  if (!Array.isArray(node?.children)) return "";
  return normalizeWhitespace(node.children.map(collectNodeText).filter(Boolean).join("\n"));
}

function getSectionDescriptor(node, fallbackIndex) {
  if (node?.type === "slide") {
    const slideNumber = Number(node.metadata?.slideNumber) || fallbackIndex;
    return { kind: "slide", number: slideNumber, label: `幻灯片 ${slideNumber}` };
  }
  if (node?.type === "page") {
    const pageNumber = Number(node.metadata?.pageNumber) || fallbackIndex;
    return { kind: "page", number: pageNumber, label: `第 ${pageNumber} 页` };
  }
  return { kind: "section", number: fallbackIndex, label: `内容片段 ${fallbackIndex}` };
}

function inferTitle(text, fallback) {
  const candidate = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length >= 2 && line.length <= 100 && !/^[•·▪◦*-]\s*/.test(line));
  return candidate ?? fallback;
}

export function extractSections(ast, fileName) {
  const topLevelNodes = Array.isArray(ast?.content) ? ast.content : [];
  const structuredNodes = topLevelNodes.filter(
    (node) => node?.type === "slide" || node?.type === "page",
  );
  const sourceNodes = structuredNodes.length > 0 ? structuredNodes : topLevelNodes;
  const sections = [];

  sourceNodes.forEach((node, index) => {
    const text = collectNodeText(node);
    if (!text) return;
    const descriptor = getSectionDescriptor(node, index + 1);
    sections.push({
      id: `${descriptor.kind}-${descriptor.number}`,
      fileName,
      ...descriptor,
      title: inferTitle(text, descriptor.label),
      text,
    });
  });

  if (sections.length === 0 && typeof ast?.toText === "function") {
    const text = normalizeWhitespace(ast.toText());
    if (text) {
      sections.push({
        id: "section-1",
        fileName,
        kind: "section",
        number: 1,
        label: "文档内容",
        title: inferTitle(text, "文档内容"),
        text,
      });
    }
  }
  return sections;
}

function classifyLine(line) {
  const value = line.trim();
  if (!value) return "blank";
  if (/^```|^(?: {2,}|\t)|\b(?:const|let|var|function|class|import|def|return)\b/.test(line)) return "code";
  if (/^\|.*\|$/.test(value) || /\S\s{3,}\S/.test(line)) return "table";
  if (/^(?:[-*•·▪◦]|\d+[.)]|[一二三四五六七八九十]+[、.])\s*/.test(value)) return "list";
  if (/^.{1,48}(?:是指|定义为|定义：|定义:| means | refers to )/i.test(value)) return "definition";
  if (
    value.length <= 90 &&
    (/^#{1,6}\s+/.test(value) ||
      /^(?:\d+(?:\.\d+)*|[一二三四五六七八九十]+)[、.)]\s*\S+/.test(value) ||
      /^(?=[A-Z0-9][A-Z0-9 &:/_-]{3,}$)(?=.*[A-Z])/.test(value))
  ) return "heading";
  return "prose";
}

function segmentStructuredText(text) {
  const lines = normalizeWhitespace(text).split("\n");
  const units = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    const unitText = normalizeWhitespace(current.lines.join("\n"));
    if (unitText) units.push({ type: current.type, text: unitText });
    current = null;
  };

  for (const line of lines) {
    const type = classifyLine(line);
    if (type === "blank") {
      flush();
      continue;
    }
    if (type === "heading") {
      flush();
      units.push({ type: "heading", text: line.trim() });
      continue;
    }
    if (!current || current.type !== type) {
      flush();
      current = { type, lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  flush();
  return units.length > 0 ? units : [{ type: "prose", text: normalizeWhitespace(text) }];
}

function targetSizeForType(type) {
  if (type === "definition") return 760;
  if (type === "code") return 900;
  if (type === "table" || type === "list") return 1_000;
  return DOCUMENT_LIMITS.chunkSize;
}

function strongerContentType(left, right) {
  const priority = { prose: 0, heading: 0, list: 1, definition: 2, table: 3, code: 4 };
  return (priority[right] ?? 0) > (priority[left] ?? 0) ? right : left;
}

function findNaturalBreak(text, idealEnd, start) {
  if (idealEnd >= text.length) return text.length;
  const lowerBound = Math.max(start + 320, idealEnd - 240);
  for (let index = idealEnd; index >= lowerBound; index -= 1) {
    if (/[。！？.!?；;\n]/.test(text[index])) return index + 1;
  }
  return idealEnd;
}

function splitLongUnit(text, targetSize, overlap) {
  const pieces = [];
  let start = 0;
  while (start < text.length) {
    const end = findNaturalBreak(text, Math.min(text.length, start + targetSize), start);
    const content = normalizeWhitespace(text.slice(start, end));
    if (content) pieces.push(content);
    if (end >= text.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return pieces;
}

function chunkSection(section, maxChunks) {
  const units = segmentStructuredText(section.text);
  const chunks = [];
  let activeTitle = section.title;
  let buffer = [];
  let bufferType = "prose";

  const pushChunk = (text, contentType) => {
    if (!text || chunks.length >= maxChunks) return;
    chunks.push({
      id: `${section.id}-chunk-${chunks.length + 1}`,
      fileName: section.fileName,
      kind: section.kind,
      number: section.number,
      label: section.label,
      title: activeTitle,
      contentType,
      text: normalizeWhitespace(text),
    });
  };

  const flush = () => {
    if (buffer.length === 0) return;
    const joined = normalizeWhitespace(buffer.join("\n"));
    const targetSize = targetSizeForType(bufferType);
    for (const piece of splitLongUnit(joined, targetSize, DOCUMENT_LIMITS.chunkOverlap)) {
      pushChunk(piece, bufferType);
    }
    buffer = [];
    bufferType = "prose";
  };

  for (const unit of units) {
    if (chunks.length >= maxChunks) break;
    if (unit.type === "heading") {
      flush();
      activeTitle = unit.text;
      bufferType = "prose";
      buffer.push(unit.text);
      continue;
    }
    if (["code", "table", "list", "definition"].includes(unit.type)) {
      flush();
      for (const piece of splitLongUnit(unit.text, targetSizeForType(unit.type), DOCUMENT_LIMITS.chunkOverlap)) {
        pushChunk(piece, unit.type);
      }
      continue;
    }
    const combinedType = strongerContentType(bufferType, unit.type);
    const targetSize = targetSizeForType(combinedType);
    const projected = normalizeWhitespace([...buffer, unit.text].join("\n"));
    if (buffer.length > 0 && projected.length > targetSize) flush();
    bufferType = strongerContentType(bufferType, unit.type);
    buffer.push(unit.text);
  }
  flush();
  return chunks;
}

export function buildDocumentIndex(ast, file, options = {}) {
  const sections = extractSections(ast, file.name);
  if (sections.length === 0) return { sections: [], chunks: [], characterCount: 0, truncated: false };

  const limitedSections = sections.slice(0, DOCUMENT_LIMITS.maxSections);
  let remainingCharacters = DOCUMENT_LIMITS.maxExtractedCharacters;
  const safeSections = [];
  let truncated = sections.length > limitedSections.length;

  for (const section of limitedSections) {
    if (remainingCharacters <= 0) {
      truncated = true;
      break;
    }
    const text = section.text.slice(0, remainingCharacters);
    safeSections.push({ ...section, text });
    remainingCharacters -= text.length;
    if (text.length < section.text.length) truncated = true;
  }

  const chunks = [];
  for (const [sectionIndex, section] of safeSections.entries()) {
    if (chunks.length >= DOCUMENT_LIMITS.maxChunks) {
      truncated = true;
      break;
    }
    chunks.push(...chunkSection(section, DOCUMENT_LIMITS.maxChunks - chunks.length));
    options.onProgress?.({ current: sectionIndex + 1, total: safeSections.length });
  }

  return {
    sections: safeSections,
    chunks,
    characterCount: safeSections.reduce((sum, section) => sum + section.text.length, 0),
    truncated,
  };
}

export function tokenize(value) {
  const text = normalizeWhitespace(value).toLowerCase();
  const tokens = [];
  for (const token of text.match(LATIN_TOKEN) ?? []) {
    if (token.length > 1 && !ENGLISH_STOP_WORDS.has(token)) tokens.push(token);
  }
  for (const sequence of text.replace(CHINESE_STOP_PHRASES, " ").match(HAN_SEQUENCE) ?? []) {
    if (sequence.length === 1) tokens.push(sequence);
    if (sequence.length <= 8 && !CHINESE_STOP_TOKENS.has(sequence)) tokens.push(sequence);
    for (let index = 0; index < sequence.length - 1; index += 1) {
      const bigram = sequence.slice(index, index + 2);
      if (!CHINESE_STOP_TOKENS.has(bigram)) tokens.push(bigram);
    }
  }
  return tokens;
}

function countTerms(tokens) {
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

function scoreLexicalChunks(query, chunks) {
  const queryTokens = [...new Set(tokenize(query))];
  if (queryTokens.length === 0 || chunks.length === 0) return [];
  const tokenizedChunks = chunks.map((chunk) => tokenize(`${chunk.title ?? ""}\n${chunk.text}`));
  const documentFrequency = new Map();
  for (const tokens of tokenizedChunks) {
    for (const token of new Set(tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }
  const averageLength = tokenizedChunks.reduce((sum, tokens) => sum + tokens.length, 0) /
    Math.max(tokenizedChunks.length, 1);
  const normalizedQuery = normalizeWhitespace(query).toLowerCase();

  return chunks.map((chunk, index) => {
    const tokens = tokenizedChunks[index];
    const termCounts = countTerms(tokens);
    let lexicalScore = 0;
    let matchedTokenCount = 0;
    for (const token of queryTokens) {
      const frequency = termCounts.get(token) ?? 0;
      if (!frequency) continue;
      matchedTokenCount += 1;
      const df = documentFrequency.get(token) ?? 0;
      const idf = Math.log(1 + (chunks.length - df + 0.5) / (df + 0.5));
      const denominator = frequency + 1.4 * (0.25 + 0.75 * (tokens.length / Math.max(averageLength, 1)));
      lexicalScore += idf * ((frequency * 2.4) / denominator);
    }
    if (normalizedQuery.length >= 4 && chunk.text.toLowerCase().includes(normalizedQuery)) lexicalScore += 3;
    return {
      ...chunk,
      lexicalScore: Number(lexicalScore.toFixed(6)),
      tokenCoverage: Number((matchedTokenCount / queryTokens.length).toFixed(6)),
    };
  });
}

export function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || left.length === 0) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  return leftNorm && rightNorm ? dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm)) : 0;
}

function pageHint(question) {
  const match = question.match(/(?:第\s*)?(\d{1,3})\s*(?:页|幻灯片|slide)/i);
  return match ? Number(match[1]) : null;
}

function structureBoost(question, chunk) {
  let boost = 0;
  const queryTokens = new Set(tokenize(question));
  const titleTokens = new Set(tokenize(chunk.title ?? ""));
  if ([...queryTokens].some((token) => titleTokens.has(token))) boost += 0.08;
  const expectedType = /表格|table/i.test(question)
    ? "table"
    : /代码|code|函数|程序/i.test(question)
      ? "code"
      : /定义|概念|是指/i.test(question)
        ? "definition"
        : /列表|步骤|要点/i.test(question)
          ? "list"
          : null;
  if (expectedType && chunk.contentType === expectedType) boost += 0.08;
  const hintedPage = pageHint(question);
  if (hintedPage && chunk.number === hintedPage) boost += 0.14;
  return boost;
}

function scoreHybridChunks(question, chunks, queryEmbedding) {
  const lexical = scoreLexicalChunks(question, chunks);
  const maximumLexical = Math.max(...lexical.map((chunk) => chunk.lexicalScore), 0);
  return lexical
    .map((chunk) => {
      const lexicalNormalized = maximumLexical > 0 ? chunk.lexicalScore / maximumLexical : 0;
      const vectorScore = queryEmbedding ? cosineSimilarity(queryEmbedding, chunk.embedding) : 0;
      const boost = structureBoost(question, chunk);
      const hybridScore = queryEmbedding
        ? lexicalNormalized * 0.5 + Math.max(0, vectorScore) * 0.42 + boost
        : lexicalNormalized + boost;
      return {
        ...chunk,
        vectorScore: Number(vectorScore.toFixed(6)),
        hybridScore: Number(hybridScore.toFixed(6)),
        score: Number(hybridScore.toFixed(6)),
      };
    })
    .sort((left, right) => right.hybridScore - left.hybridScore);
}

function selectDiverseChunks(chunks, count) {
  if (chunks.length <= count) return [...chunks];
  const selected = [];
  for (let index = 0; index < count; index += 1) {
    const position = Math.round((index * (chunks.length - 1)) / Math.max(count - 1, 1));
    if (chunks[position] && !selected.some((chunk) => chunk.id === chunks[position].id)) {
      selected.push({ ...chunks[position], score: 0 });
    }
  }
  return selected;
}

export function expandWithAdjacentChunks(primaryChunks, allChunks, count) {
  const selected = [...primaryChunks];
  const selectedIds = new Set(selected.map((chunk) => chunk.id));
  for (const primary of primaryChunks) {
    if (selected.length >= count) break;
    const primaryIndex = allChunks.findIndex((chunk) => chunk.id === primary.id);
    if (primaryIndex < 0) continue;
    for (const offset of [-1, 1]) {
      if (selected.length >= count) break;
      const adjacent = allChunks[primaryIndex + offset];
      if (!adjacent || adjacent.fileName !== primary.fileName || selectedIds.has(adjacent.id)) continue;
      selected.push({ ...adjacent, adjacent: true, score: primary.score * 0.72 });
      selectedIds.add(adjacent.id);
    }
  }
  return selected;
}

export function retrieveChunks({ question, chunks, mode = "qa", topK = 12, queryEmbedding = null }) {
  const ranked = scoreHybridChunks(question, chunks, queryEmbedding);
  if (mode === "qa") {
    const primary = ranked
      .filter((chunk) =>
        (chunk.lexicalScore >= 0.45 && chunk.tokenCoverage >= 0.25) ||
        (queryEmbedding && chunk.vectorScore >= 0.42),
      )
      .slice(0, topK);
    return primary.length === 0 ? [] : expandWithAdjacentChunks(primary, chunks, topK);
  }

  const selected = ranked.filter((chunk) => chunk.hybridScore > 0).slice(0, topK);
  const selectedIds = new Set(selected.map((chunk) => chunk.id));
  for (const chunk of selectDiverseChunks(chunks, topK)) {
    if (selected.length >= topK) break;
    if (!selectedIds.has(chunk.id)) selected.push(chunk);
  }
  return selected;
}

function bestHighlight(text, question) {
  const queryTokens = new Set(tokenize(question));
  const sentences = text.match(/[^。！？.!?\n]+[。！？.!?]?/g) ?? [text];
  const ranked = sentences
    .map((sentence) => ({
      sentence: sentence.trim(),
      score: [...new Set(tokenize(sentence))].filter((token) => queryTokens.has(token)).length,
    }))
    .filter((item) => item.sentence.length >= 8)
    .sort((left, right) => right.score - left.score || right.sentence.length - left.sentence.length);

  if (!ranked[0] || ranked[0].score === 0) {
    return sentences[0]?.trim().slice(0, 260) || text.slice(0, 260);
  }

  return ranked[0].sentence.slice(0, 260);
}

export function createSources(retrievedChunks, question = "") {
  return retrievedChunks.map((chunk, index) => {
    const highlight = bestHighlight(chunk.text, question);
    const highlightIndex = chunk.text.indexOf(highlight);
    const excerptStart = Math.max(0, highlightIndex - 160);
    return {
      id: index + 1,
      chunkId: chunk.id,
      fileName: chunk.fileName,
      label: chunk.label,
      kind: chunk.kind,
      number: chunk.number,
      title: chunk.title,
      contentType: chunk.contentType,
      excerpt: chunk.text.slice(excerptStart, excerptStart + 560),
      highlight,
      score: chunk.rerankScore ?? chunk.hybridScore ?? chunk.score ?? 0,
    };
  });
}

export function buildGroundingContext(retrievedChunks) {
  return retrievedChunks
    .map((chunk, index) =>
      `[来源${index + 1}｜${chunk.fileName}｜${chunk.label}｜标题：${chunk.title ?? "未命名"}｜类型：${chunk.contentType ?? "prose"}]\n${chunk.text}`,
    )
    .join("\n\n---\n\n");
}

export function containsMeaningfulText(value) {
  const text = normalizeWhitespace(value);
  if (text.length < 24) return false;
  return [...text].some((character) => HAN_RANGE.test(character) || /[a-z0-9]/i.test(character));
}
