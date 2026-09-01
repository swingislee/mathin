import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  courseware43SessionFromLegacyAdaptClass,
  courseware43SessionFromPageDoc,
  courseware43ViewportPlacement,
  defaultCourseware43Session,
  deriveCourseware43PageDoc,
  materializeCourseware43PageDoc,
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
  it("uses the same four whole-stage modes with source-specific defaults", () => {
    expect(defaultCourseware43Session("page-doc").strategy).toBe("fit-width-top");
    expect(defaultCourseware43Session("source-runtime").strategy).toBe("fit-height-center");

    for (const strategy of ["fit-width-top", "fit-width-center", "fit-height-left", "fit-height-center"] as const) {
      expect(supportsCourseware43Strategy("page-doc", strategy)).toBe(true);
      expect(supportsCourseware43Strategy("source-runtime", strategy)).toBe(true);
    }
    expect(supportsCourseware43Strategy("page-doc", "background-height-content-width")).toBe(true);
    expect(supportsCourseware43Strategy("source-runtime", "background-height-content-width")).toBe(false);
  });

  it("maps the audited A-F inventory into the new model", () => {
    expect(courseware43SessionFromLegacyAdaptClass("A")).toEqual({ strategy: "fit-height-left" });
    expect(courseware43SessionFromLegacyAdaptClass("B")).toEqual({ strategy: "fit-height-left" });
    expect(courseware43SessionFromLegacyAdaptClass("C")).toEqual({ strategy: "fit-width-center" });
    expect(courseware43SessionFromLegacyAdaptClass("D")).toEqual({ strategy: "fit-width-top" });
    expect(courseware43SessionFromLegacyAdaptClass("E")).toEqual({ strategy: "fit-width-center" });
    expect(courseware43SessionFromLegacyAdaptClass("F")).toEqual({ strategy: "background-height-content-width" });
    expect(courseware43SessionFromLegacyAdaptClass(null)).toBeNull();
  });

  it("maps a 16:9 stage to the four audited 4:3 placements", () => {
    expect(courseware43ViewportPlacement("fit-width-top", 16 / 9)).toEqual({
      widthPercent: 100,
      heightPercent: 75,
      leftPercent: 0,
      topPercent: 0,
    });
    expect(courseware43ViewportPlacement("fit-width-center", 16 / 9)).toEqual({
      widthPercent: 100,
      heightPercent: 75,
      leftPercent: 0,
      topPercent: 12.5,
    });
    const left = courseware43ViewportPlacement("fit-height-left", 16 / 9);
    expect(left.widthPercent).toBeCloseTo(133.333, 3);
    expect(left).toMatchObject({ heightPercent: 100, leftPercent: 0, topPercent: 0 });
    const centered = courseware43ViewportPlacement("fit-height-center", 16 / 9);
    expect(centered.widthPercent).toBeCloseTo(133.333, 3);
    expect(centered.leftPercent).toBeCloseTo(-16.667, 3);
    expect(centered).toMatchObject({ heightPercent: 100, topPercent: 0 });
  });

  it("keeps the layered PageDoc exception immutable and separates its background from content geometry", () => {
    const layered = deriveCourseware43PageDoc(pageDoc, { strategy: "background-height-content-width" });
    expect(layered).not.toBe(pageDoc);
    expect(pageDoc.canvas).toEqual({ width: 1280, height: 720, backgroundColor: null, backgroundBindingKey: null });
    expect(layered.canvas).toMatchObject({ width: 960, height: 720 });
    expect(layered.nodes[0]?.transform).toMatchObject({
      x: 0,
      y: 90,
      width: 1280,
      height: 720,
      scaleX: 0.75,
      scaleY: 0.75,
    });
  });

  it("materializes every audited PageDoc strategy as a strict 4:3 draft and restores its marker", () => {
    for (const strategy of [
      "fit-width-top",
      "fit-width-center",
      "fit-height-left",
      "fit-height-center",
      "background-height-content-width",
    ] as const) {
      const adapted = materializeCourseware43PageDoc(pageDoc, { strategy });
      expect(pageDocSchema.parse(adapted)).toEqual(adapted);
      expect(adapted.canvas).toMatchObject({ width: 960, height: 720 });
      expect(courseware43SessionFromPageDoc(adapted)).toEqual({ strategy });
    }
    expect(pageDoc.canvas).toEqual({ width: 1280, height: 720, backgroundColor: null, backgroundBindingKey: null });
    expect(courseware43SessionFromPageDoc(pageDoc)).toBeNull();
  });

  it("materializes all five strategies for a background-only PageDoc", () => {
    const backgroundOnly = pageDocSchema.parse({
      ...pageDoc,
      canvas: { ...pageDoc.canvas, backgroundBindingKey: "b".repeat(64) },
      nodes: [],
    });

    for (const strategy of [
      "fit-width-top",
      "fit-width-center",
      "fit-height-left",
      "fit-height-center",
      "background-height-content-width",
    ] as const) {
      const adapted = materializeCourseware43PageDoc(backgroundOnly, { strategy });
      expect(pageDocSchema.parse(adapted)).toEqual(adapted);
      expect(adapted.nodes[0]?.sourceType).toBe(`mathin:courseware-4x3:${strategy}`);
    }
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
    expect(shared).toContain('persistence?: "session-only" | "draft"');
    expect(shared).toContain("markSaved");
    expect(shared).toContain("courseware43ViewportPlacement(strategy, sourceAspect(source))");
    expect(shared).toContain("Courseware43StrategyIcon");
    expect(shared).toContain("CoursewareCompactChoiceGroup");
    expect(shared).toContain('data-courseware-4x3-whole-stage={strategy}');
    expect(shared).toContain("Single-track editors already live in CoursewareEditorAdapterSurface's");
    expect(shared).not.toContain('strategy: "custom"');
    expect(pageDocEditor).toContain('const coarseLayout = view === "compare"');
    expect(pageDocEditor).toContain('const sessionAdapted = view === "adapted-4x3" && track !== "adapted-4x3"');
    expect(pageDocEditor).toContain("materializeCourseware43PageDoc");
    expect(pageDocEditor).toContain('savingFourByThree ? "adapted-4x3" : track');
    expect(sourceEditor).toContain('const coarseLayout = view === "compare"');
    expect(shared).not.toContain("fetch(");
    expect(shared).not.toContain("Action(");
    expect(workspace).toContain("<SourceRuntimeFourByThreeEditor");
    expect(workspace).toContain("const sessionAdaptationAvailable = Boolean(pageEditor || sourceRuntimeEditor)");
    expect(workspace).toContain("!sessionAdaptationAvailable");
    expect(workbench).toContain('<Fragment key="inspector-panel">');
    expect(workbench).toContain('<Fragment key="inspector-heading">{inspector.header}</Fragment>');
  });
});
