import type { DocNode } from "./schema";

export type CoursewareInsertedNodeKind = "text" | "formula" | "shape";

export interface CoursewareInsertCanvas {
  width: number;
  height: number;
}

function nodeId(kind: string, id?: string): string {
  if (id) return id;
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `mathin-${kind}-${suffix}`;
}

function centeredTransform(
  canvas: CoursewareInsertCanvas,
  width: number,
  height: number,
): DocNode["transform"] {
  return {
    x: Math.max(0, (canvas.width - width) / 2),
    y: Math.max(0, (canvas.height - height) / 2),
    width,
    height,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    anchorX: 0,
    anchorY: 0,
    opacity: 1,
    flipX: false,
    flipY: false,
    clip: true,
  };
}

function baseNode(
  kind: string,
  index: number,
  canvas: CoursewareInsertCanvas,
  width: number,
  height: number,
  id?: string,
): Pick<DocNode,
  "id" | "nodePath" | "sourceType" | "sourceResourceId" | "name" | "supported"
  | "visible" | "interactive" | "zIndex" | "order" | "crop" | "transform" | "children"
> {
  const value = nodeId(kind, id);
  return {
    id: value,
    nodePath: `$.mathin.inserted.${value}`,
    sourceType: `mathin:${kind}`,
    sourceResourceId: null,
    name: kind,
    supported: true,
    visible: true,
    interactive: false,
    zIndex: 1_000 + index,
    order: 1_000 + index,
    crop: null,
    transform: centeredTransform(canvas, width, height),
    children: [],
  };
}

const TEXT_STYLE: DocNode["style"] = {
  objectFit: "contain",
  backgroundColor: null,
  color: "#2d2a26",
  borderColor: null,
  borderWidth: 0,
  borderRadius: 0,
  fontFamily: null,
  fontSize: 32,
  fontWeight: 500,
  lineHeight: 1.4,
  letterSpacing: null,
  whiteSpace: "pre-wrap",
  textAlign: "left",
  overflow: "hidden",
};

/** One node factory is shared by PageDoc, source-runtime and microcourse adapters. */
export function createCoursewareInsertedNode(
  kind: CoursewareInsertedNodeKind,
  index: number,
  canvas: CoursewareInsertCanvas,
  id?: string,
): DocNode {
  const formula = kind === "formula";
  const shape = kind === "shape";
  return {
    ...baseNode(kind, index, canvas, 320, shape ? 240 : 160, id),
    adapter: shape ? "shape" : formula ? "rich_text" : "text",
    style: shape
      ? {
        ...TEXT_STYLE,
        backgroundColor: "#fff4dc",
        borderColor: "#dd765c",
        borderWidth: 2,
        borderRadius: 18,
      }
      : { ...TEXT_STYLE, fontSize: formula ? 34 : 32, fontWeight: formula ? 600 : 500 },
    content: shape
      ? { kind: "shape", shapeType: "rectangle", svg: "" }
      : formula
        ? { kind: "rich_text", html: '<p><span class="math-tex">\\(x^2+y^2=z^2\\)</span></p>', sanitized: true }
        : { kind: "text", text: "新文本" },
    resources: [],
  };
}

export function createCoursewareInsertedImageNode(
  bindingKey: string,
  index: number,
  canvas: CoursewareInsertCanvas,
  id?: string,
): DocNode {
  return {
    ...baseNode("image", index, canvas, 320, 320, id),
    adapter: "image",
    style: { ...TEXT_STYLE, color: null, fontSize: null, fontWeight: null, lineHeight: null, whiteSpace: null },
    content: null,
    resources: [{ bindingKey, bindingPath: "$.src", role: "image", kind: "image" }],
  };
}

export function createCoursewareInsertedH5Node(
  bindingKey: string,
  index: number,
  canvas: CoursewareInsertCanvas,
  id?: string,
): DocNode {
  return {
    ...baseNode("h5", index, canvas, 480, 360, id),
    adapter: "h5",
    interactive: true,
    style: { ...TEXT_STYLE, color: null, fontSize: null, fontWeight: null, lineHeight: null, whiteSpace: null },
    content: { kind: "h5", status: "offline" },
    resources: [{ bindingKey, bindingPath: "$.entry", role: "entry", kind: "h5" }],
  };
}
