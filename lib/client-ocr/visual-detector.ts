import type { VisualCandidate } from "./types";

const MAX_PREVIEW_EDGE = 960;
const MAX_DATA_URL_LENGTH = 420_000;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function createCompressedPreview(
  canvas: HTMLCanvasElement,
  crop: VisualCandidate["crop"],
) {
  const scale = Math.min(1, MAX_PREVIEW_EDGE / Math.max(crop.width, crop.height));
  const preview = document.createElement("canvas");
  preview.width = Math.max(1, Math.round(crop.width * scale));
  preview.height = Math.max(1, Math.round(crop.height * scale));
  const context = preview.getContext("2d", { alpha: false });
  if (!context) return "";
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, preview.width, preview.height);
  context.drawImage(
    canvas,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    preview.width,
    preview.height,
  );
  let quality = 0.82;
  let dataUrl = preview.toDataURL("image/jpeg", quality);
  while (dataUrl.length > MAX_DATA_URL_LENGTH && quality > 0.45) {
    quality -= 0.1;
    dataUrl = preview.toDataURL("image/jpeg", quality);
  }
  preview.width = 1;
  preview.height = 1;
  return dataUrl.length <= MAX_DATA_URL_LENGTH ? dataUrl : "";
}

/**
 * Finds a large non-text visual region with a deliberately conservative pixel heuristic.
 * The vision model makes the final chart/table/diagram classification; this stage only
 * decides which page regions are worth sending.
 */
export function detectVisualCandidate(
  canvas: HTMLCanvasElement,
  locator: { number: number; kind: "page" | "slide" },
  nativeTextLength: number,
): VisualCandidate | null {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context || canvas.width < 160 || canvas.height < 120) return null;

  const xStart = Math.floor(canvas.width * 0.04);
  const xEnd = Math.ceil(canvas.width * 0.96);
  const yStart = Math.floor(canvas.height * 0.08);
  const yEnd = Math.ceil(canvas.height * 0.92);
  const stepX = Math.max(2, Math.floor((xEnd - xStart) / 96));
  const stepY = Math.max(2, Math.floor((yEnd - yStart) / 72));
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let samples = 0;
  let foreground = 0;
  let colored = 0;
  let transitions = 0;
  let previousForeground = false;
  let minX = xEnd;
  let minY = yEnd;
  let maxX = xStart;
  let maxY = yStart;

  for (let y = yStart; y < yEnd; y += stepY) {
    previousForeground = false;
    for (let x = xStart; x < xEnd; x += stepX) {
      const offset = (y * canvas.width + x) * 4;
      const red = pixels[offset];
      const green = pixels[offset + 1];
      const blue = pixels[offset + 2];
      const luminance = (red + green + blue) / 3;
      const saturation = Math.max(red, green, blue) - Math.min(red, green, blue);
      const isForeground = luminance < 238;
      const isColored = saturation > 30 && luminance < 245;
      samples += 1;
      if (isForeground) foreground += 1;
      if (isColored) colored += 1;
      if (isForeground !== previousForeground) transitions += 1;
      previousForeground = isForeground;
      if (isColored || (isForeground && nativeTextLength < 160)) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  const foregroundRatio = foreground / Math.max(samples, 1);
  const coloredRatio = colored / Math.max(samples, 1);
  const transitionRatio = transitions / Math.max(samples, 1);
  const imageHeavy = nativeTextLength < 120 && foregroundRatio > 0.035;
  const chartLike = coloredRatio > 0.012 && (foregroundRatio > 0.025 || transitionRatio > 0.08);
  const monochromeDiagram = nativeTextLength < 700 && foregroundRatio > 0.07 && transitionRatio > 0.11;
  if (!imageHeavy && !chartLike && !monochromeDiagram) return null;

  let x = minX < maxX ? minX : xStart;
  let y = minY < maxY ? minY : yStart;
  let width = minX < maxX ? maxX - minX + stepX : xEnd - xStart;
  let height = minY < maxY ? maxY - minY + stepY : yEnd - yStart;
  if (width < canvas.width * 0.28 || height < canvas.height * 0.22) {
    x = Math.floor(canvas.width * 0.08);
    y = Math.floor(canvas.height * 0.14);
    width = Math.floor(canvas.width * 0.84);
    height = Math.floor(canvas.height * 0.72);
  } else {
    const paddingX = Math.floor(canvas.width * 0.025);
    const paddingY = Math.floor(canvas.height * 0.025);
    x = clamp(x - paddingX, 0, canvas.width - 1);
    y = clamp(y - paddingY, 0, canvas.height - 1);
    width = clamp(width + paddingX * 2, 1, canvas.width - x);
    height = clamp(height + paddingY * 2, 1, canvas.height - y);
  }

  const crop = { x, y, width, height };
  const imageDataUrl = createCompressedPreview(canvas, crop);
  if (!imageDataUrl) return null;
  const score = clamp(
    coloredRatio * 5 + foregroundRatio * 1.6 + transitionRatio * 1.2 + (imageHeavy ? 0.18 : 0),
    0,
    1,
  );
  return {
    id: `${locator.kind}-${locator.number}-visual`,
    number: locator.number,
    kind: locator.kind,
    imageDataUrl,
    crop,
    score: Number(score.toFixed(4)),
    nativeTextLength,
  };
}
