import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { injectSourceRuntimeEditorBridge } from "@/features/courseware-doc/source-runtime-editor-bridge";
import {
  appendSourceRuntimeEditorNode,
  nextSourceRuntimeResourceId,
  patchSourceRuntimeEditorNode,
  sourceRuntimeEditorBridgeNodes,
  sourceRuntimeEditorCanvas,
  sourceRuntimeEditorNodes,
  sourceRuntimeEditorSupported,
} from "@/features/courseware-doc/source-runtime-editor";
import {
  createCoursewareInsertedImageNode,
  createCoursewareInsertedNode,
} from "@/features/courseware-doc/courseware-inserted-node";
import {
  sourceRuntimePageDocSchema,
  type SourceRuntimePageDoc,
} from "@/features/courseware-doc/source-runtime-schema";

const hash = (value: string) => value.repeat(64);

function fixture(): SourceRuntimePageDoc {
  return sourceRuntimePageDocSchema.parse({
    docVersion: "source-runtime-page-v1",
    source: {
      sourceSystem: "aixuexi_bsk",
      packageKey: "grade-1",
      coursewareId: "courseware-1",
      pageDatabaseId: 3,
      sourceSnapshotId: 7,
      sourceContentHash: hash("a"),
      pageName: "10的认识",
      groupName: "知识点1",
    },
    viewport: { width: 1200, height: 675 },
    runtime: {
      protocol: "mathin-source-runtime-v1",
      bindingKey: hash("b"),
      packageHash: hash("c"),
      entryPath: "index.html",
      sourceFingerprint: hash("d"),
    },
    payload: {
      format: "aixuexi-viewer-page-v1",
      data: {
        layout: {
          canvas: { width: 1200, height: 900 },
          nodes: [{
            id: "title",
            sourcePath: "$.layout.nodes[0]",
            sourceType: "text-widget",
            kind: "widget_html",
            title: "标题",
            x: 100,
            y: 80,
            width: 400,
            height: 120,
            zIndex: 8,
            rotation: 0,
            html: "<div style=\"font-size: 36px\">原文字</div>",
            producerOnly: { keep: true },
          }],
        },
      },
    },
    bindings: { resources: {}, routes: [] },
    behavior: { advanceOnCanvasClick: false },
  });
}

describe("source runtime shared element adapter", () => {
  it("adapts stable source paths to the common inspector model", () => {
    const doc = fixture();
    const nodes = sourceRuntimeEditorNodes(doc);
    expect(sourceRuntimeEditorSupported(doc)).toBe(true);
    expect(sourceRuntimeEditorCanvas(doc)).toEqual({ width: 1200, height: 900 });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      nodePath: "$.layout.nodes[0]",
      adapter: "rich_text",
      zIndex: 8,
      transform: { x: 100, y: 80, width: 400, height: 120 },
      content: { kind: "rich_text", html: "<div style=\"font-size: 36px\">原文字</div>" },
    });
  });

  it("patches a cloned payload and preserves producer-owned fields", () => {
    const original = fixture();
    const patched = patchSourceRuntimeEditorNode(original, "$.layout.nodes[0]", (node) => {
      node.transform.x = 240;
      node.transform.width = 520;
      node.transform.opacity = 0.6;
      node.zIndex = 21;
      node.visible = false;
      node.style.fontSize = 48;
      node.style.color = "#123456";
      node.style.textAlign = "center";
      if (node.content?.kind === "rich_text") node.content.html = "<div>新文字</div>";
    });
    expect(patched).not.toBeNull();
    expect(patched).not.toBe(original);
    expect(sourceRuntimeEditorNodes(original)[0]).toMatchObject({
      zIndex: 8,
      visible: true,
      transform: { x: 100, width: 400, opacity: 1 },
    });
    expect(sourceRuntimeEditorNodes(patched!)[0]).toMatchObject({
      zIndex: 21,
      visible: false,
      transform: { x: 240, width: 520, opacity: 0.6 },
      style: { fontSize: 48, color: "#123456", textAlign: "center" },
      content: { html: "<div>新文字</div>" },
    });
    const raw = ((patched!.payload.data.layout as { nodes: Array<Record<string, unknown>> }).nodes[0]);
    expect(raw.producerOnly).toEqual({ keep: true });
  });

  it("exposes only serializable editor metadata to the iframe bridge", () => {
    const doc = fixture();
    expect(sourceRuntimeEditorBridgeNodes(doc)).toEqual([expect.objectContaining({
      path: "$.layout.nodes[0]",
      editableText: true,
      x: 100,
      y: 80,
      width: 400,
      height: 120,
      layer: 8,
      insertedKind: null,
      resourceBindingKey: null,
    })]);
  });

  it("appends Mathin-owned nodes without rewriting producer-owned source nodes", () => {
    const original = fixture();
    const producerNode = structuredClone(
      (original.payload.data.layout as { nodes: Array<Record<string, unknown>> }).nodes[0],
    );
    const node = createCoursewareInsertedNode("text", 2, sourceRuntimeEditorCanvas(original));
    const appended = appendSourceRuntimeEditorNode(original, node);

    expect(appended).not.toBeNull();
    const rawNodes = (appended!.payload.data.layout as { nodes: Array<Record<string, unknown>> }).nodes;
    expect(rawNodes[0]).toEqual(producerNode);
    expect(rawNodes[1]).toMatchObject({
      id: node.id,
      sourcePath: node.nodePath,
      mathinInserted: true,
      mathinNodeKind: "text",
      html: "<div>新文本</div>",
    });
    expect(sourceRuntimeEditorBridgeNodes(appended!)[1]).toMatchObject({
      path: node.nodePath,
      editableText: true,
      insertedKind: "text",
      html: "<div>新文本</div>",
    });
  });

  it("registers inserted asset bindings in the source resource map", () => {
    const original = fixture();
    const resourceId = nextSourceRuntimeResourceId(original);
    const bindingKey = hash("e");
    const node = createCoursewareInsertedImageNode(
      bindingKey,
      2,
      sourceRuntimeEditorCanvas(original),
    );
    const appended = appendSourceRuntimeEditorNode(original, node, resourceId);

    expect(resourceId).toBe("1");
    expect(appended?.bindings.resources).toEqual({ "1": bindingKey });
    expect(sourceRuntimeEditorBridgeNodes(appended!)[1]).toMatchObject({
      insertedKind: "image",
      resourceBindingKey: bindingKey,
    });
  });

  it("injects syntactically valid browser code into the source runtime", () => {
    const html = injectSourceRuntimeEditorBridge("<!doctype html><html><head></head><body></body></html>");
    const script = html.match(/<script data-mathin-source-runtime-editor="[^"]+">([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    if (!script) throw new Error("SOURCE_RUNTIME_EDITOR_SCRIPT_MISSING");
    expect(script).toContain("normalizeInlineText(event.target.innerText)");
    expect(script).toContain("editor-geometry");
    expect(script).toContain("editor-preview-transform");
    expect(script).toContain("contenteditable");
    expect(script).toContain("data-mathin-source-editor-overrides");
    expect(script).toContain("setOverride(node,'z-index'");
    expect(script).toContain("data-mathin-source-inline-root");
    expect(script).toContain("if(event.target.closest('[data-mathin-source-inline-editor]'))return");
    expect(script).toContain("data-mathin-inserted-node");
    expect(script).not.toContain("mathin-source-node-handle");
    expect(script).not.toContain("handle.textContent");
    expect(script).not.toContain("Math.round(value/step)");
    expect(script).not.toContain("node-transform-change");
    expect(() => new Script(script)).not.toThrow();
  });
});
