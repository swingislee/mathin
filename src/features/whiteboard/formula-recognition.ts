import { boundsForItems } from "./geometry";
import { drawItem } from "./strokes";
import type { StrokeItem } from "./types";

const OCR_MAX_WIDTH = 768;
const OCR_MAX_HEIGHT = 384;
const OCR_MIN_SIDE = 96;
const OCR_PADDING = 0.025;

export async function createFormulaRecognitionImage(strokes: StrokeItem[], heightOverWidth = 9 / 16): Promise<{
  blob: Blob;
  bounds: { x: number; y: number; width: number; height: number };
}> {
  const rawBounds = boundsForItems(strokes);
  if (!rawBounds) throw new Error("EMPTY_SELECTION");
  const x = rawBounds.x - OCR_PADDING;
  const y = rawBounds.y - OCR_PADDING;
  const width = Math.max(rawBounds.width + OCR_PADDING * 2, 0.04);
  const height = Math.max(rawBounds.height + OCR_PADDING * 2, 0.04);
  const contentAspect = Math.max(height * heightOverWidth / width, 0.001);
  const contentWidth = Math.max(1, Math.round(Math.min(OCR_MAX_WIDTH, OCR_MAX_HEIGHT / contentAspect)));
  const contentHeight = Math.max(1, Math.round(contentWidth * contentAspect));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(OCR_MIN_SIDE, contentWidth);
  canvas.height = Math.max(OCR_MIN_SIDE, contentHeight);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("CANVAS_UNAVAILABLE");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate((canvas.width - contentWidth) / 2, (canvas.height - contentHeight) / 2);
  for (const stroke of strokes) {
    const normalized: StrokeItem = {
      ...stroke,
      color: "ink",
      mode: "ink",
      wNorm: Math.max(stroke.wNorm / width, 0.0015),
      points: stroke.points.map(([px, py]) => [(px - x) / width, (py - y) / height]),
    };
    drawItem(ctx, normalized, contentWidth, contentHeight, "#111", contentWidth);
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("IMAGE_ENCODING_FAILED");
  return { blob, bounds: { x, y, width, height } };
}

export async function recognizeFormula(blob: Blob): Promise<string> {
  const form = new FormData();
  form.set("image", new File([blob], "formula.png", { type: "image/png" }));
  const response = await fetch("/api/whiteboard/formula", { method: "POST", body: form });
  const payload = await response.json().catch(() => null) as { latex?: unknown; code?: unknown } | null;
  if (!response.ok || typeof payload?.latex !== "string") {
    throw new Error(typeof payload?.code === "string" ? payload.code : "RECOGNITION_FAILED");
  }
  return payload.latex;
}
