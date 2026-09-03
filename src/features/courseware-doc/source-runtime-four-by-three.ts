import type { SourceRuntimePageDoc } from "./source-runtime-schema";
import {
  COURSEWARE_43_STRATEGIES,
  type Courseware43SessionState,
  type Courseware43Strategy,
} from "./courseware-4x3-strategy";

export type SourceRuntimeFourByThreeMode = "source-master" | "source-player-compat";

const MATHIN_COURSEWARE_METADATA_KEY = "mathinCourseware";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function positiveFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Mathin-owned draft metadata lives beside, never inside, the producer layout.
 * The source Viewer ignores this reserved object while the formal editor can
 * restore a track-specific host placement after a reload.
 */
export function sourceRuntimeCourseware43Session(
  doc: SourceRuntimePageDoc,
): Courseware43SessionState | null {
  const metadata = asRecord(doc.payload.data[MATHIN_COURSEWARE_METADATA_KEY]);
  const strategy = metadata?.adapt43Strategy;
  return COURSEWARE_43_STRATEGIES.includes(strategy as Courseware43Strategy)
    ? { strategy: strategy as Courseware43Strategy }
    : null;
}

export function withSourceRuntimeCourseware43Session(
  input: SourceRuntimePageDoc,
  state: Courseware43SessionState,
): SourceRuntimePageDoc {
  const doc = structuredClone(input);
  const current = asRecord(doc.payload.data[MATHIN_COURSEWARE_METADATA_KEY]) ?? {};
  doc.payload.data[MATHIN_COURSEWARE_METADATA_KEY] = {
    ...current,
    adapt43Strategy: state.strategy,
  };
  return doc;
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
