import type { DocNode, PageDoc } from "@/features/courseware-doc/schema";
import type { CoursewarePage } from "../types";

export const M3_TOOL_OVERLAY_FIXTURE_PAGE: CoursewarePage = {
  id: "m3-tool-overlay-fixture-v1",
  type: "board",
  title: "M3 Tool Overlay Input",
};

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
