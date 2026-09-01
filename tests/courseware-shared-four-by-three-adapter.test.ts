import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultCourseware43Session,
  deriveCourseware43PageDoc,
  supportsCourseware43Strategy,
} from "@/features/courseware-doc/courseware-4x3-strategy";
import { pageDocSchema } from "@/features/courseware-doc/schema";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const hash = "a".repeat(64);
const pageDoc = pageDocSchema.parse({
  docVersion: "page-doc-v1",
  sourceCoursewareId: "cw",
  sourcePageId: "page",
  sourcePageDatabaseId: 1,
  sourceSnapshotId: 1,
  sourceContentHash: hash,
  canvas: { width: 1280, height: 720, backgroundColor: null, backgroundBindingKey: null },
  nodes: [{
    id: "node",
    nodePath: "$.children[0]",
    sourceType: "text",
    sourceResourceId: null,
    adapter: "text",
    name: "Title",
    supported: true,
    visible: true,
    interactive: false,
    zIndex: 1,
    order: 0,
    crop: null,
    transform: { x: 100, y: 20, width: 400, height: 200, rotation: 0, scaleX: 1, scaleY: 1, anchorX: 0, anchorY: 0, opacity: 1, flipX: false, flipY: false, clip: false },
    style: { objectFit: "contain", backgroundColor: null, color: "#111", borderColor: null, borderWidth: 0, borderRadius: 0, fontFamily: null, fontSize: 32, fontWeight: null, lineHeight: null, letterSpacing: null, whiteSpace: "normal", textAlign: "center", overflow: "visible" },
    content: { kind: "text", text: "Title" },
    resources: [],
    children: [],
  }],
  interactions: [],
});

describe("shared formal-course 4:3 adapter", () => {
  it("uses adapter-specific defaults without forking the strategy model", () => {
    expect(defaultCourseware43Session("page-doc").strategy).toBe("C");
    expect(defaultCourseware43Session("source-runtime", "source-master").strategy).toBe("source-native");
    expect(defaultCourseware43Session("source-runtime", "source-player-compat").strategy).toBe("E");

    expect(supportsCourseware43Strategy("page-doc", "A")).toBe(true);
    expect(supportsCourseware43Strategy("page-doc", "source-native")).toBe(false);
    expect(supportsCourseware43Strategy("source-runtime", "source-native", "source-master")).toBe(true);
    expect(supportsCourseware43Strategy("source-runtime", "source-native", "source-player-compat")).toBe(false);
    expect(supportsCourseware43Strategy("source-runtime", "E", "source-player-compat")).toBe(true);
    expect(supportsCourseware43Strategy("source-runtime", "A", "source-master")).toBe(false);
  });

  it("derives PageDoc strategies as immutable 4:3 session previews", () => {
    const fitted = deriveCourseware43PageDoc(pageDoc, defaultCourseware43Session("page-doc"));
    expect(fitted).not.toBe(pageDoc);
    expect(pageDoc.canvas).toEqual({ width: 1280, height: 720, backgroundColor: null, backgroundBindingKey: null });
    expect(fitted.canvas).toMatchObject({ width: 960, height: 720 });
    expect(fitted.nodes[0]?.transform).toMatchObject({ x: 75, y: 105, width: 300, height: 150 });

    const topAligned = deriveCourseware43PageDoc(pageDoc, {
      strategy: "E",
      custom: { scale: 75, translateX: 0, translateY: 90 },
    });
    expect(topAligned.nodes[0]?.transform).toMatchObject({ x: 75, y: 15 });
  });

  it("mounts PageDoc and Aixuexi through the same state, panel, comparison and tab components", () => {
    const shared = read("src/features/courseware-studio/CoursewareFourByThreeAdapter.tsx");
    const pageDocEditor = read("src/features/courseware-studio/PageDocVerticalSliceEditor.tsx");
    const sourceEditor = read("src/features/courseware-studio/SourceRuntimeFourByThreeEditor.tsx");
    const workspace = read("src/features/courseware-studio/UnifiedCoursewareWorkspace.tsx");
    const workbench = read("src/features/courseware-doc/CoursewareEditorWorkbench.tsx");

    for (const adapter of [pageDocEditor, sourceEditor]) {
      expect(adapter).toContain("useCoursewareFourByThreeAdapter");
      expect(adapter).toContain("<CoursewareFourByThreePanel");
      expect(adapter).toContain("<CoursewareFourByThreeComparison");
      expect(adapter).toContain("<CoursewareFormalInspectorTabs");
    }
    expect(shared).not.toContain("createContext");
    expect(shared).not.toContain("COURSEWARE_43_ADAPTER_REQUIRED");
    expect(shared).toContain('data-persistence="session-only"');
    expect(shared).toContain("sourceRuntimeFourByThreeMode(source.doc)");
    expect(shared).toContain("deriveCourseware43PageDoc(source.doc, state)");
    expect(shared).not.toContain("fetch(");
    expect(shared).not.toContain("Action(");
    expect(workspace).toContain("<SourceRuntimeFourByThreeEditor");
    expect(workbench).toContain('<Fragment key="inspector-panel">');
  });
});
