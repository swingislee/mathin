import type { AixuexiPageDoc } from "@/features/courseware-doc/aixuexi-schema";
import type { DocNode, PageDoc } from "@/features/courseware-doc/schema";
import type { CoursewarePage } from "../types";

export const M3_H5_FIXTURE_PAGE: CoursewarePage = {
  id: "m3-h5-pointer-fixture-v1",
  type: "doc",
  docId: "m3-h5-pointer-doc-v1",
  title: "M3b H5 Pointer Bridge",
};

export const M3_H5_FIXTURE_BINDING_KEY = "3".repeat(64);
export const M3_AIXUEXI_RUNTIME_BINDING_KEY = "5".repeat(64);

export const M3_AIXUEXI_H5_FIXTURE_PAGE: CoursewarePage = {
  id: "m3-aixuexi-h5-pointer-fixture-v1",
  type: "doc",
  docId: "m3-aixuexi-h5-pointer-doc-v1",
  title: "Aixuexi H5 Pointer Bridge",
};

export const M3_H5_FIXTURE_DOC: PageDoc = {
  docVersion: "page-doc-v1",
  sourceCoursewareId: "m3-h5-pointer-fixture",
  sourcePageId: "m3-h5-pointer-page",
  sourcePageDatabaseId: 3,
  sourceSnapshotId: 1,
  sourceContentHash: "4".repeat(64),
  canvas: {
    width: 960,
    height: 540,
    backgroundColor: "#fffdf8",
    backgroundBindingKey: null,
  },
  nodes: [
    {
      id: "m3-h5-frame",
      nodePath: "root/m3-h5-frame",
      sourceType: "h5",
      sourceResourceId: "m3-h5-frame",
      adapter: "h5",
      name: "M3b H5 Pointer Bridge",
      supported: true,
      visible: true,
      interactive: true,
      zIndex: 1,
      order: 0,
      crop: null,
      transform: {
        x: 64,
        y: 128,
        width: 832,
        height: 360,
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
      style: {
        objectFit: "contain",
        backgroundColor: "#fffdf8",
        color: "#29251f",
        borderColor: null,
        borderWidth: 0,
        borderRadius: 0,
        fontFamily: "system-ui, sans-serif",
        fontSize: 16,
        fontWeight: 400,
        lineHeight: 1.4,
        letterSpacing: null,
        whiteSpace: "normal",
        textAlign: "left",
        overflow: "hidden",
      },
      content: {
        kind: "h5",
        status: "development_fixture",
      },
      resources: [
        {
          bindingKey: M3_H5_FIXTURE_BINDING_KEY,
          bindingPath: "fixture/index.html",
          role: "entry",
          kind: "h5",
        },
      ],
      children: [],
    },
    textNode({ id: "m3-mixed-title", text: "魔法校混合页：页面点击 + H5", y: 32, height: 54, fontSize: 28, fontWeight: 700 }),
    textNode({
      id: "m3-mixed-result",
      text: "页面内点击已触发",
      y: 88,
      height: 34,
      fontSize: 18,
      fontWeight: 600,
      visible: false,
      backgroundColor: "#feedb9",
    }),
  ],
  interactions: [{
    trigger: "click",
    triggerScope: "page",
    triggerResourceId: null,
    targetResourceId: "m3-mixed-result",
    action: "enter",
    animation: "fadeIn",
    delay: 0,
    duration: 0.15,
    loop: 1,
    path: null,
    audioBindingKey: null,
    audioName: null,
    step: 0,
  }],
};

export const M3_AIXUEXI_H5_FIXTURE_DOC: AixuexiPageDoc = {
  docVersion: "aixuexi-page-doc-v1",
  adapter: "aixuexi-page-v1",
  projectionVersion: 31,
  source: {
    sourceSystem: "aixuexi_bsk",
    packageKey: "development-aixuexi-h5-fixture",
    coursewareId: "development-aixuexi-h5-fixture",
    pageDatabaseId: 1,
    sourceSnapshotId: 1,
    sourceContentHash: "6".repeat(64),
    pageName: "爱学习嵌入 H5",
    groupName: "B3 开发验收",
  },
  canvas: {
    width: 1200,
    height: 900,
    widgetOffsetX: 0,
    slideClass: "light-slide slide",
    backgroundBindingKey: null,
  },
  playerStage: {
    width: 1920,
    height: 1080,
    presentationScale: 0.625,
    offsetX: 0,
    offsetY: 0,
    backgroundSize: "auto 1080px",
    backgroundPosition: "center center",
    backgroundRepeat: "no-repeat",
    backgroundColor: "#fffdf8",
    contentPadding: { top: 0, right: 0, bottom: 0, left: 0 },
  },
  presentation: {
    width: 1200,
    height: 675,
    contentScale: 0.75,
    offsetX: 150,
    offsetY: 0,
  },
  sourceRuntime: {
    runtimeBindingKey: M3_AIXUEXI_RUNTIME_BINDING_KEY,
    slideStylesheetPath: "slide-runtime.css",
    itvStylesheetPath: "itv-runtime.css",
    lottieRuntimePath: null,
    lottieRuntimeSha256: null,
    questionImageSizing: null,
    questionImageSizingInput: { imgs: {} },
  },
  behaviors: {
    splitQuestionScroll: null,
    singleQuestionScroll: null,
    stagedReveal: { underlineCount: 0, summaryWidgetCount: 0 },
    widgetReveal: { steps: 0 },
    shapeTextFit: null,
  },
  sourceKind: "slide_widgets",
  nodes: [{
    id: "aixuexi-h5-fixture",
    sourcePath: "$.widgets[0]",
    sourceType: "embedded-h5",
    kind: "embedded_h5",
    title: "爱学习嵌入互动",
    x: 100,
    y: 90,
    width: 1000,
    height: 720,
    zIndex: 1,
    rotation: 0,
    transform: "",
    transformOrigin: "",
    known: true,
    html: null,
    resourceBindingKey: M3_H5_FIXTURE_BINDING_KEY,
    resourceBindingKeys: [M3_H5_FIXTURE_BINDING_KEY],
    revealStep: 0,
    animations: [],
    questionTkRuntime: null,
    embeddedH5: {
      packageHash: "7".repeat(64),
      entryPackagePath: "index.html",
      intrinsicViewport: { width: 960, height: 540 },
      presentationMode: "letterbox_4_3",
      bindingKey: M3_H5_FIXTURE_BINDING_KEY,
    },
    trueOrFalse: null,
    topicClassification: null,
    warnings: [],
  }],
  topicInteraction: null,
  itvInteraction: null,
  behavior: { advanceOnCanvasClick: false },
  fourByThree: { mode: "source-player-compat", reasons: ["embedded_h5"] },
  warnings: [],
};

export function m3H5FixtureBindingUrls(compatible: boolean): Readonly<Record<string, string>> {
  return {
    [M3_H5_FIXTURE_BINDING_KEY]: `/api/cw-h5/fixture?compatible=${compatible ? "1" : "0"}`,
  };
}

export function m3AixuexiH5FixtureBindingUrls(compatible: boolean): Readonly<Record<string, string>> {
  return {
    [M3_H5_FIXTURE_BINDING_KEY]: `/api/cw-h5/fixture?compatible=${compatible ? "1" : "0"}`,
    [M3_AIXUEXI_RUNTIME_BINDING_KEY]: "/api/cw-h5/fixture/runtime/index.html",
  };
}

const ZERO_SHA256 = "0".repeat(64);

function textNode({
  id,
  text,
  y,
  height,
  fontSize,
  fontWeight = 400,
  visible = true,
  backgroundColor = null,
}: {
  id: string;
  text: string;
  y: number;
  height: number;
  fontSize: number;
  fontWeight?: number;
  visible?: boolean;
  backgroundColor?: string | null;
}): DocNode {
  return {
    id,
    nodePath: `root/${id}`,
    sourceType: "text",
    sourceResourceId: id,
    adapter: "text",
    name: id,
    supported: true,
    visible,
    interactive: false,
    zIndex: 1,
    order: 0,
    crop: null,
    transform: {
      x: 96,
      y,
      width: 768,
      height,
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
    style: {
      objectFit: "contain",
      backgroundColor,
      color: "#29251f",
      borderColor: backgroundColor ? "#cbab8f" : null,
      borderWidth: backgroundColor ? 2 : 0,
      borderRadius: backgroundColor ? 24 : 0,
      fontFamily: "Microsoft YaHei, sans-serif",
      fontSize,
      fontWeight,
      lineHeight: 1.5,
      letterSpacing: null,
      whiteSpace: "normal",
      textAlign: "center",
      overflow: "hidden",
    },
    content: { kind: "text", text },
    resources: [],
    children: [],
  };
}

export function createM3DocumentInputFixture(copy: {
  title: string;
  instruction: string;
  result: string;
}): PageDoc {
  return {
    docVersion: "page-doc-v1",
    sourceCoursewareId: "m3-native-document-fixture",
    sourcePageId: "m3-native-document-page",
    sourcePageDatabaseId: 1,
    sourceSnapshotId: 1,
    sourceContentHash: ZERO_SHA256,
    canvas: {
      width: 960,
      height: 540,
      backgroundColor: "#fffdf8",
      backgroundBindingKey: null,
    },
    nodes: [
      textNode({ id: "m3-doc-title", text: copy.title, y: 70, height: 72, fontSize: 38, fontWeight: 700 }),
      textNode({ id: "m3-doc-instruction", text: copy.instruction, y: 185, height: 62, fontSize: 24 }),
      textNode({
        id: "m3-doc-result",
        text: copy.result,
        y: 300,
        height: 96,
        fontSize: 28,
        fontWeight: 600,
        visible: false,
        backgroundColor: "#feedb9",
      }),
    ],
    interactions: [
      {
        trigger: "click",
        triggerScope: "page",
        triggerResourceId: null,
        targetResourceId: "m3-doc-result",
        action: "enter",
        animation: "fadeIn",
        delay: 0,
        duration: 0.15,
        loop: 1,
        path: null,
        audioBindingKey: null,
        audioName: null,
        step: 0,
      },
    ],
  };
}
