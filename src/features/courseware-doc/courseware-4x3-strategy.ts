import { derive43PageDoc, type Adapt43NodeTransformScope } from "./adapt-4x3";
import type { PageDoc } from "./schema";
import type { SourceRuntimeFourByThreeMode } from "./source-runtime-four-by-three";

export const COURSEWARE_43_STRATEGIES = ["source-native", "A", "B", "C", "D", "E", "F", "custom"] as const;

export type Courseware43Strategy = (typeof COURSEWARE_43_STRATEGIES)[number];
export type Courseware43SourceKind = "page-doc" | "source-runtime";

export interface Courseware43CustomTransform {
  scale: number;
  translateX: number;
  translateY: number;
}

export interface Courseware43SessionState {
  strategy: Courseware43Strategy;
  custom: Courseware43CustomTransform;
}

export function defaultCourseware43Session(
  sourceKind: Courseware43SourceKind,
  sourceMode?: SourceRuntimeFourByThreeMode,
): Courseware43SessionState {
  if (sourceKind === "source-runtime") {
    return {
      strategy: sourceMode === "source-master" ? "source-native" : "E",
      custom: { scale: 100, translateX: 0, translateY: 0 },
    };
  }
  return {
    strategy: "C",
    custom: { scale: 75, translateX: 0, translateY: 90 },
  };
}

export function supportsCourseware43Strategy(
  sourceKind: Courseware43SourceKind,
  strategy: Courseware43Strategy,
  sourceMode?: SourceRuntimeFourByThreeMode,
) {
  if (sourceKind === "page-doc") return strategy !== "source-native";
  if (strategy === "source-native") return sourceMode === "source-master";
  return strategy === "E" || strategy === "custom";
}

interface PageDocPreset {
  scale: number;
  translateX: number;
  translateY: number;
  scope?: Adapt43NodeTransformScope;
}

const PAGE_DOC_PRESETS: Record<Exclude<Courseware43Strategy, "source-native" | "custom">, PageDocPreset> = {
  A: { scale: 1, translateX: 0, translateY: 0, scope: "root" },
  B: { scale: 0.875, translateX: -80, translateY: 45, scope: "root" },
  C: { scale: 0.75, translateX: 0, translateY: 90, scope: "root" },
  // Step 4A only establishes the manual-reflow starting point. Per-element
  // adapted-track edits remain session-only until the persistence contract is
  // separately audited.
  D: { scale: 0.75, translateX: 0, translateY: 90, scope: "root" },
  E: { scale: 0.75, translateX: 0, translateY: 0, scope: "root" },
  F: { scale: 1, translateX: 0, translateY: 0, scope: "frame" },
};

export function deriveCourseware43PageDoc(
  doc: PageDoc,
  state: Courseware43SessionState,
): PageDoc {
  if (state.strategy === "source-native") {
    throw new Error("SOURCE_NATIVE_REQUIRES_SOURCE_RUNTIME");
  }
  const preset = state.strategy === "custom"
    ? { ...state.custom, scope: "root" as const }
    : PAGE_DOC_PRESETS[state.strategy];
  return derive43PageDoc(doc, {
    scale: preset.scale,
    translateX: preset.translateX,
    translateY: preset.translateY,
  }, preset.scope);
}
