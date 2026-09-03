import type { DocNode } from "./schema";
import type { SourceRuntimePageDoc } from "./source-runtime-schema";

const AIXUEXI_VIEWER_FORMAT = "aixuexi-viewer-page-v1";

type UnknownRecord = Record<string, unknown>;

interface SourceNodeEditorState {
  visible: boolean;
  opacity: number;
  fontSize: number | null;
  color: string | null;
  textAlign: "left" | "center" | "right" | "justify" | null;
}

export interface SourceRuntimeEditorBridgeNode extends SourceNodeEditorState {
  path: string;
  editableText: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  layer: number;
  insertedKind: "text" | "formula" | "shape" | "image" | "h5" | null;
  html: string | null;
  resourceBindingKey: string | null;
}

export interface SourceRuntimeEditorCanvas {
  width: number;
  height: number;
}

export interface SourceRuntimeEditorGeometryRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SourceRuntimeEditorGeometry {
  viewport: { width: number; height: number };
  stage: SourceRuntimeEditorGeometryRect;
  nodes: Array<SourceRuntimeEditorGeometryRect & { path: string }>;
}

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positive(value: unknown, fallback: number): number {
  const number = finite(value, fallback);
  return number > 0 ? number : fallback;
}

function textAlign(value: unknown): SourceNodeEditorState["textAlign"] {
  return value === "left" || value === "center" || value === "right" || value === "justify"
    ? value
    : null;
}

function editorState(source: UnknownRecord): SourceNodeEditorState {
  const state = record(source.mathinEditor);
  return {
    visible: state?.visible !== false,
    opacity: Math.min(1, Math.max(0, finite(state?.opacity, 1))),
    fontSize: typeof state?.fontSize === "number" && Number.isFinite(state.fontSize)
      ? state.fontSize
      : null,
    color: typeof state?.color === "string" ? state.color : null,
    textAlign: textAlign(state?.textAlign),
  };
}

function layout(doc: SourceRuntimePageDoc): UnknownRecord | null {
  if (doc.payload.format !== AIXUEXI_VIEWER_FORMAT) return null;
  return record(doc.payload.data.layout);
}

function rawNodes(doc: SourceRuntimePageDoc): UnknownRecord[] {
  const nodes = layout(doc)?.nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes.flatMap((node) => {
    const value = record(node);
    return value && typeof value.sourcePath === "string" && value.sourcePath.length > 0
      ? [value]
      : [];
  });
}

function sourceNodeToDocNode(source: UnknownRecord, order: number): DocNode {
  const path = String(source.sourcePath);
  const state = editorState(source);
  const html = typeof source.html === "string" ? source.html : null;
  const title = typeof source.title === "string" && source.title.trim()
    ? source.title.trim()
    : path;
  const sourceType = typeof source.sourceType === "string" ? source.sourceType : "unknown";
  const kind = typeof source.kind === "string" ? source.kind : "unknown";
  const insertedKind = source.mathinInserted === true && ["text", "formula", "shape", "image", "h5"].includes(String(source.mathinNodeKind))
    ? String(source.mathinNodeKind) as SourceRuntimeEditorBridgeNode["insertedKind"]
    : null;
  const bindingKey = typeof source.mathinBindingKey === "string" ? source.mathinBindingKey : null;
  const adapter = insertedKind === "image" ? "image"
    : insertedKind === "h5" ? "h5"
      : insertedKind === "shape" ? "shape"
        : html === null ? "unsupported" : "rich_text";
  const content: DocNode["content"] = insertedKind === "image" ? null
    : insertedKind === "h5" ? { kind: "h5", status: "offline" }
      : insertedKind === "shape" ? { kind: "shape", shapeType: "rectangle", svg: "", html: html ?? "" }
        : html === null ? { kind: "unsupported", sourceType, summary: title }
          : { kind: "rich_text", html, sanitized: true, sourceType };
  return {
    id: typeof source.id === "string" ? source.id : path,
    nodePath: path,
    sourceType,
    sourceResourceId: null,
    adapter,
    name: title,
    supported: insertedKind !== null || html !== null,
    visible: state.visible,
    interactive: insertedKind === "h5" || ["embedded_h5", "itv_video", "true_or_false_game", "topic_classification_game"].includes(kind),
    zIndex: finite(source.zIndex, order),
    order,
    crop: null,
    transform: {
      x: finite(source.x, 0),
      y: finite(source.y, 0),
      width: positive(source.width, 1),
      height: positive(source.height, 1),
      rotation: finite(source.rotation, 0),
      scaleX: 1,
      scaleY: 1,
      anchorX: 0,
      anchorY: 0,
      opacity: state.opacity,
      flipX: false,
      flipY: false,
      clip: false,
    },
    style: {
      objectFit: "contain",
      backgroundColor: null,
      color: state.color,
      borderColor: null,
      borderWidth: 0,
      borderRadius: 0,
      fontFamily: null,
      fontSize: state.fontSize,
      fontWeight: null,
      lineHeight: null,
      letterSpacing: null,
      whiteSpace: "normal",
      textAlign: state.textAlign,
      overflow: "visible",
    },
    content,
    resources: bindingKey && insertedKind === "image"
      ? [{ bindingKey, bindingPath: "$.src", role: "image", kind: "image" }]
      : bindingKey && insertedKind === "h5"
        ? [{ bindingKey, bindingPath: "$.entry", role: "entry", kind: "h5" }]
        : [],
    children: [],
  };
}

/**
 * Adapt producer nodes into the exact element model consumed by the shared
 * inspector and layer panel. The source Viewer remains the render authority.
 */
export function sourceRuntimeEditorNodes(doc: SourceRuntimePageDoc): DocNode[] {
  return rawNodes(doc)
    .filter((node) => node.kind !== "background")
    .map(sourceNodeToDocNode);
}

export function sourceRuntimeEditorCanvas(doc: SourceRuntimePageDoc): SourceRuntimeEditorCanvas {
  const canvas = record(layout(doc)?.canvas);
  return {
    width: positive(canvas?.width, doc.viewport.width),
    height: positive(canvas?.height, doc.viewport.height),
  };
}

export function sourceRuntimeEditorBridgeNodes(doc: SourceRuntimePageDoc): SourceRuntimeEditorBridgeNode[] {
  const sources = new Map(rawNodes(doc).map((source) => [String(source.sourcePath), source]));
  return sourceRuntimeEditorNodes(doc).map((node) => {
    const source = sources.get(node.nodePath);
    const insertedKind = source?.mathinInserted === true && ["text", "formula", "shape", "image", "h5"].includes(String(source.mathinNodeKind))
      ? String(source.mathinNodeKind) as SourceRuntimeEditorBridgeNode["insertedKind"]
      : null;
    return {
      path: node.nodePath,
      editableText: node.content?.kind === "text" || node.content?.kind === "rich_text",
      visible: node.visible,
      opacity: node.transform.opacity,
      fontSize: node.style.fontSize,
      color: node.style.color,
      textAlign: node.style.textAlign,
      x: node.transform.x,
      y: node.transform.y,
      width: node.transform.width,
      height: node.transform.height,
      layer: node.zIndex,
      insertedKind,
      html: typeof source?.html === "string" ? source.html : null,
      resourceBindingKey: typeof source?.mathinBindingKey === "string" ? source.mathinBindingKey : null,
    };
  });
}

function rawInsertedKind(node: DocNode): SourceRuntimeEditorBridgeNode["insertedKind"] {
  if (node.adapter === "image") return "image";
  if (node.adapter === "h5") return "h5";
  if (node.adapter === "shape") return "shape";
  if (node.sourceType.endsWith(":formula")) return "formula";
  return "text";
}

/** Append one Mathin-owned node while retaining the producer payload verbatim. */
export function appendSourceRuntimeEditorNode(
  input: SourceRuntimePageDoc,
  node: DocNode,
  resourceId?: string,
): SourceRuntimePageDoc | null {
  if (input.payload.format !== AIXUEXI_VIEWER_FORMAT) return null;
  const doc = structuredClone(input);
  const targetLayout = layout(doc);
  if (!targetLayout || !Array.isArray(targetLayout.nodes)) return null;
  const insertedKind = rawInsertedKind(node);
  const bindingKey = node.resources[0]?.bindingKey ?? null;
  const html = node.content?.kind === "text"
    ? `<div>${node.content.text ?? ""}</div>`
    : node.content?.kind === "rich_text"
      ? node.content.html ?? ""
      : insertedKind === "shape"
        ? '<div style="width:100%;height:100%;border:2px solid #dd765c;border-radius:18px;background:#fff4dc"></div>'
        : insertedKind === "image" && resourceId
          ? `<img alt="" src="asset://resource/${resourceId}" style="width:100%;height:100%;object-fit:contain">`
          : "";
  targetLayout.nodes.push({
    id: node.id,
    sourcePath: node.nodePath,
    sourceType: node.sourceType,
    kind: "widget_html",
    title: node.name ?? insertedKind,
    x: node.transform.x,
    y: node.transform.y,
    width: node.transform.width,
    height: node.transform.height,
    zIndex: node.zIndex,
    rotation: node.transform.rotation,
    html,
    mathinInserted: true,
    mathinNodeKind: insertedKind,
    ...(bindingKey ? { mathinBindingKey: bindingKey } : {}),
    ...(resourceId ? { mathinResourceId: resourceId } : {}),
    mathinEditor: {
      visible: node.visible,
      opacity: node.transform.opacity,
      fontSize: node.style.fontSize,
      color: node.style.color,
      textAlign: node.style.textAlign,
    },
  });
  if (bindingKey && resourceId) doc.bindings.resources[resourceId] = bindingKey;
  return doc;
}

export function nextSourceRuntimeResourceId(doc: SourceRuntimePageDoc): string {
  return String(Math.max(0, ...Object.keys(doc.bindings.resources).map((value) => Number(value) || 0)) + 1);
}

/** Clone and patch exactly one stable producer node. Unknown source fields stay intact. */
export function patchSourceRuntimeEditorNode(
  input: SourceRuntimePageDoc,
  nodePath: string,
  mutate: (node: DocNode) => void,
): SourceRuntimePageDoc | null {
  if (input.payload.format !== AIXUEXI_VIEWER_FORMAT) return null;
  const doc = structuredClone(input);
  const nodes = rawNodes(doc);
  const index = nodes.findIndex((node) => node.sourcePath === nodePath);
  const source = nodes[index];
  if (!source) return null;

  const node = sourceNodeToDocNode(source, index);
  mutate(node);
  source.x = node.transform.x;
  source.y = node.transform.y;
  source.width = Math.max(1, node.transform.width);
  source.height = Math.max(1, node.transform.height);
  source.zIndex = node.zIndex;
  if (node.content?.kind === "rich_text" && typeof node.content.html === "string") {
    source.html = node.content.html;
  }
  source.mathinEditor = {
    visible: node.visible,
    opacity: Math.min(1, Math.max(0, node.transform.opacity)),
    fontSize: node.style.fontSize,
    color: node.style.color,
    textAlign: node.style.textAlign,
  } satisfies SourceNodeEditorState;
  return doc;
}

export function sourceRuntimeEditorSupported(doc: SourceRuntimePageDoc): boolean {
  return doc.payload.format === AIXUEXI_VIEWER_FORMAT && rawNodes(doc).length > 0;
}
