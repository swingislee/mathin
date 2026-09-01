import { derive43PageDoc } from "./adapt-4x3";
import type { PageDoc } from "./schema";

export const COURSEWARE_43_STRATEGIES = [
  "fit-width-top",
  "fit-width-center",
  "fit-height-left",
  "fit-height-center",
  "background-height-content-width",
] as const;

export type Courseware43Strategy = (typeof COURSEWARE_43_STRATEGIES)[number];
export type Courseware43SourceKind = "page-doc" | "source-runtime";

export interface Courseware43SessionState {
  strategy: Courseware43Strategy;
}

export interface Courseware43ViewportPlacement {
  widthPercent: number;
  heightPercent: number;
  leftPercent: number;
  topPercent: number;
}

export function defaultCourseware43Session(
  sourceKind: Courseware43SourceKind,
): Courseware43SessionState {
  return {
    // E 系列沿用等宽顶对齐；爱学习来源页按源站常见窗口默认等高居中。
    strategy: sourceKind === "source-runtime" ? "fit-height-center" : "fit-width-top",
  };
}

export function supportsCourseware43Strategy(
  sourceKind: Courseware43SourceKind,
  strategy: Courseware43Strategy,
) {
  // 来源 runtime 是不可拆分的 iframe，只能整体应用四种视口变换。
  return strategy !== "background-height-content-width" || sourceKind === "page-doc";
}

export function isWholeStageCourseware43Strategy(
  strategy: Courseware43Strategy,
): strategy is Exclude<Courseware43Strategy, "background-height-content-width"> {
  return strategy !== "background-height-content-width";
}

/**
 * 把完整 16:9 渲染器放入 4:3 裁切窗口。背景、内容和互动层使用同一几何，
 * 因此不会再出现背景保持不动、仅节点被缩放的分裂表现。
 */
export function courseware43ViewportPlacement(
  strategy: Exclude<Courseware43Strategy, "background-height-content-width">,
  sourceAspect: number,
): Courseware43ViewportPlacement {
  if (!Number.isFinite(sourceAspect) || sourceAspect <= 0) {
    throw new Error("INVALID_4X3_SOURCE_ASPECT");
  }
  const targetAspect = 4 / 3;
  if (strategy === "fit-width-top" || strategy === "fit-width-center") {
    const heightPercent = (targetAspect / sourceAspect) * 100;
    return {
      widthPercent: 100,
      heightPercent,
      leftPercent: 0,
      topPercent: strategy === "fit-width-center" ? (100 - heightPercent) / 2 : 0,
    };
  }
  const widthPercent = (sourceAspect / targetAspect) * 100;
  return {
    widthPercent,
    heightPercent: 100,
    leftPercent: strategy === "fit-height-center" ? (100 - widthPercent) / 2 : 0,
    topPercent: 0,
  };
}

/** 背景等高居中裁切，内容等宽垂直居中的 PageDoc 分层特例。 */
export function deriveCourseware43PageDoc(
  doc: PageDoc,
  state: Courseware43SessionState,
): PageDoc {
  if (state.strategy !== "background-height-content-width") {
    throw new Error("LAYERED_4X3_STRATEGY_REQUIRED");
  }
  const targetWidth = 960;
  const targetHeight = 720;
  const scale = targetWidth / doc.canvas.width;
  return derive43PageDoc(doc, {
    scale,
    translateX: 0,
    translateY: (targetHeight - doc.canvas.height * scale) / 2,
  }, "frame");
}
