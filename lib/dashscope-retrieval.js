const EMBEDDING_ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings";
const RERANK_ENDPOINT =
  "https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank";

export const EMBEDDING_MODEL = "text-embedding-v4";
export const RERANK_MODEL = "qwen3-rerank";
export const EMBEDDING_DIMENSIONS = 256;
const EMBEDDING_BATCH_SIZE = 10;

function createRequestSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), timeoutMs);
  const abortFromParent = () => controller.abort("parent-aborted");
  parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
  };
}

function roundEmbedding(vector) {
  return vector.map((value) => Math.round(Number(value) * 1_000_000) / 1_000_000);
}

export async function embedTexts(texts, apiKey, options = {}) {
  if (!apiKey || !Array.isArray(texts) || texts.length === 0) return [];
  if (texts.length > EMBEDDING_BATCH_SIZE) {
    throw new Error(`Embedding batch cannot exceed ${EMBEDDING_BATCH_SIZE} items`);
  }

  const request = createRequestSignal(options.signal, options.timeoutMs ?? 20_000);
  try {
    const response = await fetch(EMBEDDING_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: texts,
        dimensions: EMBEDDING_DIMENSIONS,
        encoding_format: "float",
      }),
      signal: request.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.error) {
      throw new Error(data?.error?.message || `Embedding service returned ${response.status}`);
    }

    const embeddings = Array.isArray(data?.data) ? data.data : [];
    if (embeddings.length !== texts.length) throw new Error("Embedding response is incomplete");
    return embeddings
      .sort((left, right) => left.index - right.index)
      .map((item) => roundEmbedding(item.embedding));
  } finally {
    request.cleanup();
  }
}

export async function embedDocumentChunks(chunks, apiKey, options = {}) {
  const embedded = [];
  for (let start = 0; start < chunks.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = chunks.slice(start, start + EMBEDDING_BATCH_SIZE);
    const inputs = batch.map((chunk) =>
      [chunk.title, chunk.label, chunk.contentType, chunk.text].filter(Boolean).join("\n"),
    );
    const vectors = await embedTexts(inputs, apiKey, options);
    batch.forEach((chunk, index) => embedded.push({ ...chunk, embedding: vectors[index] }));
    options.onProgress?.({ completed: embedded.length, total: chunks.length });
  }
  return embedded;
}

export async function rerankChunks(question, chunks, apiKey, options = {}) {
  if (!apiKey || chunks.length === 0) return chunks;
  const request = createRequestSignal(options.signal, options.timeoutMs ?? 20_000);
  try {
    const response = await fetch(RERANK_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: RERANK_MODEL,
        input: {
          query: question,
          documents: chunks.map((chunk) =>
            [chunk.title, chunk.label, chunk.text].filter(Boolean).join("\n"),
          ),
        },
        parameters: {
          return_documents: false,
          top_n: Math.min(options.topK ?? chunks.length, chunks.length),
          instruct: "Given a university course question, retrieve passages that directly support a grounded teaching answer.",
        },
      }),
      signal: request.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.code) {
      throw new Error(data?.message || `Rerank service returned ${response.status}`);
    }

    const results = Array.isArray(data?.output?.results)
      ? data.output.results
      : Array.isArray(data?.results) ? data.results : [];
    return results
      .map((result) => {
        const chunk = chunks[result.index];
        return chunk
          ? { ...chunk, rerankScore: Number(Number(result.relevance_score ?? result.score).toFixed(6)) }
          : null;
      })
      .filter(Boolean);
  } finally {
    request.cleanup();
  }
}
