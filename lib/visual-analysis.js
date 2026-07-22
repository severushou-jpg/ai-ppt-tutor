const DEFAULT_ENDPOINT =
  "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
export const DEFAULT_VISION_MODEL = "qwen3-vl-plus";
export const VISUAL_ANALYSIS_CONCURRENCY = 2;

function requestSignal(parentSignal, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), timeoutMs);
  const abort = () => controller.abort("parent-aborted");
  parentSignal?.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abort);
    },
  };
}

function parseJsonObject(value) {
  const normalized = String(value ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(normalized);
  } catch {
    const start = normalized.indexOf("{");
    const end = normalized.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(normalized.slice(start, end + 1));
    throw new Error("Vision model returned invalid JSON");
  }
}

function responseText(data) {
  const content = data?.output?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part?.text ?? "").join("\n");
  return "";
}

async function analyzeCandidate(candidate, apiKey, options) {
  const request = requestSignal(options.signal);
  const model = process.env.DASHSCOPE_VISION_MODEL || DEFAULT_VISION_MODEL;
  const endpoint = process.env.DASHSCOPE_MULTIMODAL_ENDPOINT || DEFAULT_ENDPOINT;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: {
          messages: [{
            role: "user",
            content: [
              { image: candidate.imageDataUrl },
              { text: `你正在分析大学课件第 ${candidate.number} ${candidate.kind === "slide" ? "张幻灯片" : "页"}中裁剪出的视觉区域。只描述图片中可以直接观察到的内容，不使用课外知识，不猜测缺失标签。判断它是图表、表格、流程图、代码截图、普通图片还是无教学价值装饰。严格返回 JSON：{"hasEducationalValue":true,"kind":"chart|table|diagram|code|image|unknown","title":"可见标题或简短名称","summary":"客观摘要","observations":["可见元素"],"relationships":["明确可见的趋势、比较或连接关系"],"confidence":0.0}` },
            ],
          }],
        },
        parameters: { temperature: 0.05 },
      }),
      signal: request.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.code) {
      throw new Error(data?.message || `Vision service returned ${response.status}`);
    }
    const parsed = parseJsonObject(responseText(data));
    if (parsed?.hasEducationalValue === false) return null;
    const kind = ["chart", "table", "diagram", "code", "image", "unknown"].includes(parsed?.kind)
      ? parsed.kind
      : "unknown";
    const observations = Array.isArray(parsed?.observations)
      ? parsed.observations.map(String).filter(Boolean).slice(0, 12)
      : [];
    const relationships = Array.isArray(parsed?.relationships)
      ? parsed.relationships.map(String).filter(Boolean).slice(0, 10)
      : [];
    const confidence = Math.max(0, Math.min(1, Number(parsed?.confidence) || candidate.score || 0.5));
    const title = String(parsed?.title || `第 ${candidate.number} 页视觉内容`).slice(0, 140);
    const summary = String(parsed?.summary || "检测到可用于学习的视觉内容。").slice(0, 1_000);
    const text = [
      `视觉证据类型：${kind}`,
      `标题：${title}`,
      `摘要：${summary}`,
      observations.length ? `可见元素：\n- ${observations.join("\n- ")}` : "",
      relationships.length ? `可见关系：\n- ${relationships.join("\n- ")}` : "",
    ].filter(Boolean).join("\n");
    return { kind, title, summary, confidence, text, model };
  } finally {
    request.cleanup();
  }
}

export async function analyzeVisualCandidates(manifest, apiKey, options = {}) {
  const candidates = manifest?.visuals ?? [];
  if (!apiKey || candidates.length === 0) {
    return {
      chunks: [],
      summary: { candidateCount: candidates.length, analyzedCount: 0, failedCount: 0 },
    };
  }

  const chunks = [];
  let failedCount = 0;
  const failedLocations = [];
  const queue = [...candidates];
  const workers = Array.from({ length: Math.min(VISUAL_ANALYSIS_CONCURRENCY, queue.length) }, async () => {
    while (queue.length > 0) {
      const candidate = queue.shift();
      if (!candidate) return;
      options.onProgress?.({
        current: chunks.length + failedCount,
        total: candidates.length,
        message: `正在分析第 ${candidate.number} ${candidate.kind === "slide" ? "张幻灯片" : "页"}的图表`,
      });
      try {
        const analysis = await analyzeCandidate(candidate, apiKey, options);
        if (!analysis) continue;
        const label = candidate.kind === "slide" ? `幻灯片 ${candidate.number}` : `第 ${candidate.number} 页`;
        chunks.push({
          id: `${candidate.kind}-${candidate.number}-visual-${candidate.id}`,
          fileName: options.fileName ?? "课件",
          kind: candidate.kind,
          number: candidate.number,
          label,
          title: analysis.title,
          contentType: "visual",
          structureTypes: ["visual"],
          text: analysis.text,
          textOrigin: "vision",
          evidenceWeight: Number((0.7 + analysis.confidence * 0.3).toFixed(4)),
          visual: {
            id: candidate.id,
            kind: analysis.kind,
            imageDataUrl: candidate.imageDataUrl,
            crop: candidate.crop,
            confidence: analysis.confidence,
            model: analysis.model,
            altText: analysis.summary,
          },
        });
      } catch (error) {
        if (options.signal?.aborted || error?.name === "AbortError") throw error;
        failedCount += 1;
        failedLocations.push({ kind: candidate.kind, number: candidate.number });
        console.error("Visual analysis failed", {
          page: candidate.number,
          message: error?.message,
        });
      }
    }
  });
  await Promise.all(workers);
  const model = chunks[0]?.visual?.model;
  return {
    chunks: chunks.sort((left, right) => left.number - right.number),
    summary: {
      candidateCount: candidates.length,
      analyzedCount: chunks.length,
      failedCount,
      failedLocations,
      model,
    },
  };
}
