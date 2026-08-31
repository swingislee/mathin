import type { SourceRuntimePageDoc } from "./source-runtime-schema";

export type SourceRuntimeFourByThreeMode = "source-master" | "source-player-compat";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function positiveFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function nodeRequiresPlayerCompatibility(value: unknown): boolean {
  const node = asRecord(value);
  if (!node) return true;
  const animations = node.animations;
  if (animations !== undefined && animations !== null) {
    if (!Array.isArray(animations) || animations.length > 0) return true;
  }
  return node.embeddedH5 !== undefined && node.embeddedH5 !== null
    || node.trueOrFalse !== undefined && node.trueOrFalse !== null
    || node.topicClassification !== undefined && node.topicClassification !== null;
}

/**
 * Reconstructs the producer's historical per-page 4:3 projection from the
 * immutable source layout. Unknown payloads stay on the compatibility path.
 */
export function sourceRuntimeFourByThreeMode(
  doc: SourceRuntimePageDoc,
): SourceRuntimeFourByThreeMode {
  if (doc.payload.format !== "aixuexi-viewer-page-v1") return "source-player-compat";
  const layout = asRecord(doc.payload.data.layout);
  const canvas = asRecord(layout?.canvas);
  const width = positiveFiniteNumber(canvas?.width);
  const height = positiveFiniteNumber(canvas?.height);
  const nodes = layout?.nodes;
  if (!width || !height || !Array.isArray(nodes)) return "source-player-compat";

  const hasWideCanvas = width / height > 4 / 3 + 0.001;
  return hasWideCanvas || nodes.some(nodeRequiresPlayerCompatibility)
    ? "source-player-compat"
    : "source-master";
}
