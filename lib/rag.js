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

function normalizeWhitespace(value) {
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
        text,
      });
    }
  }

  return sections;
}

function findNaturalBreak(text, idealEnd, start) {
  if (idealEnd >= text.length) return text.length;
  const lowerBound = Math.max(start + 500, idealEnd - 220);
  for (let index = idealEnd; index >= lowerBound; index -= 1) {
    if (/[。！？.!?；;\n]/.test(text[index])) return index + 1;
  }
  return idealEnd;
}

function chunkSection(section, options) {
  const text = normalizeWhitespace(section.text);
  if (!text) return [];
  const chunks = [];
  let start = 0;

  while (start < text.length && chunks.length < options.maxChunks) {
    const idealEnd = Math.min(text.length, start + options.chunkSize);
    const end = findNaturalBreak(text, idealEnd, start);
    const content = normalizeWhitespace(text.slice(start, end));
    if (content) {
      chunks.push({
        id: `${section.id}-chunk-${chunks.length + 1}`,
        fileName: section.fileName,
        kind: section.kind,
        number: section.number,
        label: section.label,
        text: content,
      });
    }
    if (end >= text.length) break;
    start = Math.max(start + 1, end - options.chunkOverlap);
  }

  return chunks;
}

export function buildDocumentIndex(ast, file) {
  const sections = extractSections(ast, file.name);
  if (sections.length === 0) {
    return { sections: [], chunks: [], characterCount: 0, truncated: false };
  }

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
  for (const section of safeSections) {
    if (chunks.length >= DOCUMENT_LIMITS.maxChunks) {
      truncated = true;
      break;
    }
    const available = DOCUMENT_LIMITS.maxChunks - chunks.length;
    chunks.push(...chunkSection(section, { ...DOCUMENT_LIMITS, maxChunks: available }));
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
  const latinTokens = text.match(LATIN_TOKEN) ?? [];
  for (const token of latinTokens) {
    if (token.length > 1 && !ENGLISH_STOP_WORDS.has(token)) tokens.push(token);
  }

  const hanSequences = text.replace(CHINESE_STOP_PHRASES, " ").match(HAN_SEQUENCE) ?? [];
  for (const sequence of hanSequences) {
    if (sequence.length === 1) {
      tokens.push(sequence);
      continue;
    }
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

function scoreChunks(query, chunks) {
  const queryTokens = [...new Set(tokenize(query))];
  if (queryTokens.length === 0 || chunks.length === 0) return [];

  const tokenizedChunks = chunks.map((chunk) => tokenize(chunk.text));
  const documentFrequency = new Map();
  for (const tokens of tokenizedChunks) {
    const uniqueTokens = new Set(tokens);
    for (const token of uniqueTokens) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  const averageLength =
    tokenizedChunks.reduce((sum, tokens) => sum + tokens.length, 0) /
    Math.max(tokenizedChunks.length, 1);
  const normalizedQuery = normalizeWhitespace(query).toLowerCase();
  const k1 = 1.4;
  const b = 0.75;

  return chunks
    .map((chunk, index) => {
      const tokens = tokenizedChunks[index];
      const termCounts = countTerms(tokens);
      let score = 0;
      let matchedTokenCount = 0;
      for (const token of queryTokens) {
        const frequency = termCounts.get(token) ?? 0;
        if (!frequency) continue;
        matchedTokenCount += 1;
        const df = documentFrequency.get(token) ?? 0;
        const idf = Math.log(1 + (chunks.length - df + 0.5) / (df + 0.5));
        const denominator =
          frequency + k1 * (1 - b + b * (tokens.length / Math.max(averageLength, 1)));
        score += idf * ((frequency * (k1 + 1)) / denominator);
      }

      const normalizedChunk = chunk.text.toLowerCase();
      if (normalizedQuery.length >= 4 && normalizedChunk.includes(normalizedQuery)) score += 3;
      return {
        ...chunk,
        score: Number(score.toFixed(4)),
        tokenCoverage: Number((matchedTokenCount / queryTokens.length).toFixed(4)),
      };
    })
    .filter((chunk) => chunk.score > 0)
    .sort((a, bScore) => bScore.score - a.score);
}

function selectDiverseChunks(chunks, count) {
  if (chunks.length <= count) return [...chunks];
  const selected = [];
  const usedIds = new Set();
  for (let index = 0; index < count; index += 1) {
    const position = Math.round((index * (chunks.length - 1)) / Math.max(count - 1, 1));
    const chunk = chunks[position];
    if (chunk && !usedIds.has(chunk.id)) {
      selected.push({ ...chunk, score: 0 });
      usedIds.add(chunk.id);
    }
  }
  return selected;
}

function expandWithAdjacentChunks(primaryChunks, allChunks, count) {
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
      selected.push({ ...adjacent, score: 0, tokenCoverage: 0, adjacent: true });
      selectedIds.add(adjacent.id);
    }
  }

  return selected;
}

export function retrieveChunks({ question, chunks, mode = "qa", topK = 6 }) {
  const ranked = scoreChunks(question, chunks);
  if (mode === "qa") {
    const primaryChunks = ranked
      .filter((chunk) => chunk.score >= 0.45 && chunk.tokenCoverage >= 0.25)
      .slice(0, topK);
    if (primaryChunks.length === 0) return [];
    return expandWithAdjacentChunks(primaryChunks, chunks, topK);
  }

  const selected = ranked.slice(0, topK);
  const selectedIds = new Set(selected.map((chunk) => chunk.id));
  for (const chunk of selectDiverseChunks(chunks, topK)) {
    if (selected.length >= topK) break;
    if (!selectedIds.has(chunk.id)) {
      selected.push(chunk);
      selectedIds.add(chunk.id);
    }
  }
  return selected;
}

export function createSources(retrievedChunks) {
  return retrievedChunks.map((chunk, index) => ({
    id: index + 1,
    chunkId: chunk.id,
    fileName: chunk.fileName,
    label: chunk.label,
    kind: chunk.kind,
    number: chunk.number,
    excerpt: chunk.text.slice(0, 420),
    score: chunk.score,
  }));
}

export function buildGroundingContext(retrievedChunks) {
  return retrievedChunks
    .map((chunk, index) => `[来源${index + 1}｜${chunk.fileName}｜${chunk.label}]\n${chunk.text}`)
    .join("\n\n---\n\n");
}

export function containsMeaningfulText(value) {
  const text = normalizeWhitespace(value);
  if (text.length < 24) return false;
  return [...text].some((character) => HAN_RANGE.test(character) || /[a-z0-9]/i.test(character));
}

export { normalizeWhitespace };
