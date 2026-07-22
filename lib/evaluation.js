function unique(values) {
  return [...new Set(values)];
}

export function recallAtK(retrieved, relevant, k = 10) {
  const expected = new Set(relevant);
  if (expected.size === 0) return 1;
  const hits = unique(retrieved.slice(0, k)).filter((value) => expected.has(value)).length;
  return hits / expected.size;
}

export function reciprocalRank(retrieved, relevant) {
  const expected = new Set(relevant);
  const index = retrieved.findIndex((value) => expected.has(value));
  return index < 0 ? 0 : 1 / (index + 1);
}

export function ndcgAtK(retrieved, relevant, k = 10) {
  const expected = new Set(relevant);
  if (expected.size === 0) return 1;
  const dcg = retrieved.slice(0, k).reduce(
    (sum, value, index) => sum + (expected.has(value) ? 1 / Math.log2(index + 2) : 0),
    0,
  );
  const idealCount = Math.min(expected.size, k);
  const ideal = Array.from({ length: idealCount }).reduce(
    (sum, _, index) => sum + 1 / Math.log2(index + 2),
    0,
  );
  return ideal ? dcg / ideal : 0;
}

function normalizeForOcr(value) {
  return String(value ?? "").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function editDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

export function ocrCharacterAccuracy(actual, expected) {
  const left = normalizeForOcr(actual).slice(0, 10_000);
  const right = normalizeForOcr(expected).slice(0, 10_000);
  if (!right) return left ? 0 : 1;
  return Math.max(0, 1 - editDistance(left, right) / Math.max(left.length, right.length, 1));
}

export function citationPrecision(claims, sources) {
  let citedClaims = 0;
  let validClaims = 0;
  for (const claim of claims) {
    if (!claim?.citations?.length) continue;
    citedClaims += 1;
    if (claim.citations.every((id) => sources.some((source) => source.id === id))) validClaims += 1;
  }
  return citedClaims ? validClaims / citedClaims : 1;
}

export function refusalAccuracy(results) {
  if (!results.length) return 1;
  const correct = results.filter((item) => Boolean(item.refused) === Boolean(item.shouldRefuse)).length;
  return correct / results.length;
}

export function weightedScenarioScore(categoryScores, priorities) {
  let weighted = 0;
  let totalWeight = 0;
  for (const [category, weight] of Object.entries(priorities)) {
    if (!Number.isFinite(categoryScores[category])) continue;
    weighted += categoryScores[category] * weight;
    totalWeight += weight;
  }
  return totalWeight ? weighted / totalWeight : 0;
}

export function summarizeRetrievalCases(results, priorities) {
  const byCategory = {};
  for (const result of results) {
    if (!byCategory[result.category]) byCategory[result.category] = [];
    byCategory[result.category].push(result);
  }
  const categoryScores = Object.fromEntries(Object.entries(byCategory).map(([category, items]) => [
    category,
    items.reduce((sum, item) => sum + item.recallAt10 * 0.5 + item.mrr * 0.25 + item.ndcgAt10 * 0.25, 0) / items.length,
  ]));
  return {
    categoryScores,
    weightedScore: weightedScenarioScore(categoryScores, priorities),
    recallAt10: results.reduce((sum, item) => sum + item.recallAt10, 0) / Math.max(results.length, 1),
    mrr: results.reduce((sum, item) => sum + item.mrr, 0) / Math.max(results.length, 1),
    ndcgAt10: results.reduce((sum, item) => sum + item.ndcgAt10, 0) / Math.max(results.length, 1),
  };
}
