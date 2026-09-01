import { derive43PageDoc } from "./adapt-4x3";
import type { DocNode, PageDoc } from "./schema";

export const COURSEWARE_43_STRATEGIES = [
  "fit-width-top",
  "fit-width-center",
  "fit-height-left",
  "fit-height-center",
  "background-height-content-width",
] as const;

export type Courseware43Strategy = (typeof COURSEWARE_43_STRATEGIES)[number];
export type Courseware43SourceKind = "page-doc" | "source-runtime";
export type LegacyCourseware43AdaptClass = "A" | "B" | "C" | "D" | "E" | "F";

export interface Courseware43SessionState {
  strategy: Courseware43Strategy;
}

export interface Courseware43ViewportPlacement {
  widthPercent: number;
  heightPercent: number;
  leftPercent: number;
  topPercent: number;
}

const COURSEWARE_43_FRAME_SOURCE_PREFIX = "mathin:courseware-4x3:";
const TARGET_43_WIDTH = 960;
const TARGET_43_HEIGHT = 720;

function neutralNodeStyle(): DocNode["style"] {
  return {
    objectFit: "contain",
    backgroundColor: null,
    color: null,
    borderColor: null,
    borderWidth: 0,
    borderRadius: 0,
    fontFamily: null,
    fontSize: null,
    fontWeight: null,
    lineHeight: null,
    letterSpacing: null,
    whiteSpace: null,
    textAlign: null,
    overflow: "hidden",
  };
}

function persistedFrameSourceType(strategy: Courseware43Strategy) {
  return `${COURSEWARE_43_FRAME_SOURCE_PREFIX}${strategy}`;
}

function persistedBackgroundNode(doc: PageDoc): DocNode | null {
  const bindingKey = doc.canvas.backgroundBindingKey;
  if (!bindingKey) return null;
  return {
    id: "mathin-adapt-4x3-background",
    nodePath: "$.mathinAdapt43Background",
    sourceType: "mathin:adapt-4x3-background",
    sourceResourceId: null,
    adapter: "image",
    name: null,
    supported: true,
    visible: true,
    interactive: false,
    zIndex: -1_000_000,
    order: -1,
    crop: null,
    transform: {
      x: 0,
      y: 0,
      width: doc.canvas.width,
      height: doc.canvas.height,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      anchorX: 0,
      anchorY: 0,
      opacity: 1,
      flipX: false,
      flipY: false,
      clip: false,
    },
    style: { ...neutralNodeStyle(), objectFit: "cover" },
    content: null,
    resources: [{ bindingKey, bindingPath: "$.canvas.backgroundBindingKey", role: "background", kind: "image" }],
    children: [],
  };
}

export function defaultCourseware43Session(
  sourceKind: Courseware43SourceKind,
): Courseware43SessionState {
  return {
    // E 系列沿用等宽顶对齐；爱学习来源页按源站常见窗口默认等高居中。
    strategy: sourceKind === "source-runtime" ? "fit-height-center" : "fit-width-top",
  };
}

/**
 * 旧分类只决定尚无新草稿标记页面的起始策略，不再承担编辑器 UI 或审核状态。
 * B 的轻越界沿用左侧主体；D 回到永久合法的等宽顶部兼容起点。
 */
export function courseware43SessionFromLegacyAdaptClass(
  adaptClass: LegacyCourseware43AdaptClass | null,
): Courseware43SessionState | null {
  if (adaptClass === "A" || adaptClass === "B") return { strategy: "fit-height-left" };
  if (adaptClass === "C" || adaptClass === "E") return { strategy: "fit-width-center" };
  if (adaptClass === "D") return { strategy: "fit-width-top" };
  if (adaptClass === "F") return { strategy: "background-height-content-width" };
  return null;
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

/**
 * 把 Step 4A 的视口选择物化为严格的 page-doc-v1 4:3 草稿。
 * 适配框自身携带策略标记；刷新后可以从草稿文档恢复选择，不借用旧 A～F
 * 分类，也不需要给冻结 schema 或数据库增加字段。
 */
export function materializeCourseware43PageDoc(
  doc: PageDoc,
  state: Courseware43SessionState,
): PageDoc {
  if (state.strategy === "background-height-content-width") {
    const layered = deriveCourseware43PageDoc(doc, state);
    const frame = layered.nodes[0];
    if (!frame) throw new Error("COURSEWARE_4X3_FRAME_MISSING");
    frame.sourceType = persistedFrameSourceType(state.strategy);
    return layered;
  }

  const scale = state.strategy === "fit-width-top" || state.strategy === "fit-width-center"
    ? TARGET_43_WIDTH / doc.canvas.width
    : TARGET_43_HEIGHT / doc.canvas.height;
  const translateX = state.strategy === "fit-height-center"
    ? (TARGET_43_WIDTH - doc.canvas.width * scale) / 2
    : 0;
  const translateY = state.strategy === "fit-width-center"
    ? (TARGET_43_HEIGHT - doc.canvas.height * scale) / 2
    : 0;
  const adapted = derive43PageDoc(doc, { scale, translateX, translateY }, "frame");
  const frame = adapted.nodes[0];
  if (!frame) throw new Error("COURSEWARE_4X3_FRAME_MISSING");
  frame.sourceType = persistedFrameSourceType(state.strategy);
  frame.style = { ...neutralNodeStyle(), backgroundColor: doc.canvas.backgroundColor };
  const background = persistedBackgroundNode(doc);
  if (background) frame.children = [background, ...frame.children];
  adapted.canvas.backgroundColor = null;
  adapted.canvas.backgroundBindingKey = null;
  return adapted;
}

/** 只读取由本适配器保存的标记；历史手工 4:3 文档继续按默认策略打开。 */
export function courseware43SessionFromPageDoc(doc: PageDoc): Courseware43SessionState | null {
  if (doc.canvas.width * 3 !== doc.canvas.height * 4) return null;
  const sourceType = doc.nodes[0]?.sourceType;
  if (!sourceType?.startsWith(COURSEWARE_43_FRAME_SOURCE_PREFIX)) return null;
  const strategy = sourceType.slice(COURSEWARE_43_FRAME_SOURCE_PREFIX.length);
  return COURSEWARE_43_STRATEGIES.includes(strategy as Courseware43Strategy)
    ? { strategy: strategy as Courseware43Strategy }
    : null;
}
