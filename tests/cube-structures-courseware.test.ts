import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { CUBE_COLORS, replayCubeHistory } from "@/features/tools/spatial-lab/cube-structures-contract";
import { cubeDraftSnapshot } from "@/features/tools/spatial-lab/cube-structures-draft";
import { createCubeSession, cubeSessionScene, operateCubeSession, pauseCubeRecording, startCubeRecording, undoCubeSession } from "@/features/tools/spatial-lab/cube-structures-session";
import { CUBE_COURSEWARE_LEGACY_VERSION, configureCubeCoursewareToolbar, createCubeCoursewareTool, cubeCoursewareToolSchema, cubeCoursewareV1ToolSchema } from "@/features/tools/courseware/cube-structures-content";
import { CUBE_TOOLBAR_IDS, CUBE_TOOLBAR_LABELS } from "@/features/tools/spatial-lab/cube-structures-toolbar";
import { cubeStructuresMessages } from "@/features/tools/spatial-lab/cube-structures-messages";
import { getToolCoursewareContract } from "@/features/tools/courseware/registry";
import { coursewareCompositionPageSchema, coursewareCompositionToolSchema, createEmptyCoursewareCompositionPage } from "@/features/courseware-doc/composition-page-schema";
import { addCoursewareCompositionTool } from "@/features/courseware-doc/composition-page-layout";
import { resolveClassroomInteractionAudit } from "@/features/classroom/sync/interaction-audit";

const initial = () => createCubeSession([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]);
const draft = (session = initial()) => ({ name: "分层与表面", snapshot: cubeDraftSnapshot(session, 0) });

describe("frozen cube courseware content", () => {
  it("copies the current scene without private undo history, pointers or account references", () => {
    let session = operateCubeSession(initial(), { kind: "color", ids: ["cube-1"], color: CUBE_COLORS[2] });
    session = operateCubeSession(session, { kind: "axes", visible: false });
    session = undoCubeSession(session, -1);
    const source = draft(session);
    const before = JSON.stringify(source);
    const tool = createCubeCoursewareTool(source, "current");
    expect(tool.payload.history.initial).toEqual(cubeSessionScene(session));
    expect(tool.payload.history.operations).toEqual([]);
    expect(tool.payload.history.cursor).toBe(0);
    expect(Object.keys(tool.payload).sort()).toEqual(["history", "title", "toolbar"]);
    expect(tool.payload.toolbar).toEqual(CUBE_TOOLBAR_IDS);
    expect(JSON.stringify(source)).toBe(before);
    source.snapshot.session.work.initial.cubes[0].faces["y+"] = CUBE_COLORS[3];
    expect(tool.payload.history.initial.cubes[0].faces["y+"]).toBeUndefined();
  });

  it("freezes only active recorded steps, excluding paused experiments and undone futures", () => {
    let session = startCubeRecording(initial());
    session = operateCubeSession(session, { kind: "axes", visible: false });
    session = operateCubeSession(session, { kind: "hidden-edges", visible: false });
    session = undoCubeSession(session, -1);
    session = operateCubeSession(pauseCubeRecording(session), { kind: "color", ids: ["cube-2"], color: CUBE_COLORS[2] });
    const tool = createCubeCoursewareTool(draft(session), "recording");
    expect(tool.payload.history.operations).toEqual([{ kind: "axes", visible: false }]);
    expect(replayCubeHistory(tool.payload.history, 1)).toEqual(replayCubeHistory(session.lesson!));
    expect(replayCubeHistory(tool.payload.history, 1)).not.toEqual(cubeSessionScene(session));
    expect(() => createCubeCoursewareTool(draft(), "recording")).toThrow("CUBE_COURSEWARE_RECORDING_MISSING");
  });

  it("round-trips through a combination page with the distinct version and replayable v2 provider", () => {
    const tool = createCubeCoursewareTool(draft(), "current");
    const page = addCoursewareCompositionTool(createEmptyCoursewareCompositionPage(), tool);
    expect(coursewareCompositionPageSchema.parse(JSON.parse(JSON.stringify(page)))).toEqual(page);
    expect(getToolCoursewareContract(tool.toolId, tool.contentVersion)?.classroomSync).toMatchObject({ mode: "snapshot", protocol: "tool-state-v1", eventType: "tool_state" });
    expect(resolveClassroomInteractionAudit(page).provider).toMatchObject({ mode: "snapshot", protocol: "tool-state-v1", eventType: "tool_state" });
    expect(coursewareCompositionToolSchema.safeParse({ toolId: "spatial-lab", contentVersion: "tool-embed-v1" }).success).toBe(true);
    expect(coursewareCompositionToolSchema.safeParse({ ...tool, contentVersion: "tool-embed-v1" }).success).toBe(false);
    expect(coursewareCompositionToolSchema.safeParse({ ...tool, contentVersion: "cube-structures-lesson-v3" }).success).toBe(false);
    expect(coursewareCompositionToolSchema.safeParse({ ...tool, toolId: "motion-lab" }).success).toBe(false);
  });

  it("rejects malformed geometry, missing dependencies, playback state and private fields", () => {
    const tool = createCubeCoursewareTool(draft(), "current");
    const changeHistory = (change: object) => ({ ...tool, payload: { ...tool.payload, history: { ...tool.payload.history, ...change } } });
    expect(cubeCoursewareToolSchema.safeParse(changeHistory({ cursor: 1 })).success).toBe(false);
    expect(cubeCoursewareToolSchema.safeParse(changeHistory({ operations: [{ kind: "remove", ids: ["missing"] }] })).success).toBe(false);
    expect(cubeCoursewareToolSchema.safeParse(changeHistory({ initial: { ...tool.payload.history.initial, hiddenCubeIds: ["missing"] } })).success).toBe(false);
    expect(cubeCoursewareToolSchema.safeParse({ ...tool, payload: { ...tool.payload, ownerId: "private" } }).success).toBe(false);
  });

  it("persists exactly the chosen subset, including none, and rejects unsupported, repeated or missing tools", () => {
    for (const toolbar of [[], ["cut", "orbit", "undo"]] as const) {
      const tool = createCubeCoursewareTool(draft(), "current", toolbar);
      const page = addCoursewareCompositionTool(createEmptyCoursewareCompositionPage(), tool);
      const restored = coursewareCompositionPageSchema.parse(JSON.parse(JSON.stringify(page))).layout.blocks[0];
      expect(restored.type === "tool" && "payload" in restored.tool && "toolbar" in restored.tool.payload && restored.tool.payload.toolbar).toEqual(toolbar);
    }
    const tool = createCubeCoursewareTool(draft(), "current");
    for (const toolbar of [["account-drafts"], ["cut", "cut"], [null], "orbit", undefined]) {
      expect(cubeCoursewareToolSchema.safeParse({ ...tool, payload: { ...tool.payload, toolbar } }).success).toBe(false);
    }
    for (const locale of ["zh", "en"] as const) for (const id of CUBE_TOOLBAR_IDS) expect(cubeStructuresMessages(locale)[CUBE_TOOLBAR_LABELS[id]]).toBeTruthy();
  });

  it("upgrades an old component only on explicit toolbar configuration and preserves the frozen origin and steps", () => {
    const created = createCubeCoursewareTool(draft(), "current");
    const legacy = cubeCoursewareV1ToolSchema.parse({ ...created, contentVersion: CUBE_COURSEWARE_LEGACY_VERSION, payload: { title: created.payload.title, history: created.payload.history } });
    const before = JSON.stringify(legacy);
    expect(coursewareCompositionToolSchema.parse(legacy)).toEqual(legacy);
    expect(getToolCoursewareContract(legacy.toolId, legacy.contentVersion)?.classroomSync.mode).toBe("read-only");
    const configured = configureCubeCoursewareToolbar(legacy, ["orbit", "layer"]);
    expect(configured.payload.history).toEqual(legacy.payload.history);
    expect(configured.payload.toolbar).toEqual(["orbit", "layer"]);
    expect(JSON.stringify(legacy)).toBe(before);
    expect(cubeCoursewareToolSchema.safeParse({ ...configured, contentVersion: CUBE_COURSEWARE_LEGACY_VERSION }).success).toBe(false);
  });

  it("enforces content and combined-page budgets without lowering the old page budget", () => {
    const tool = createCubeCoursewareTool(draft(), "current");
    const groups = Array.from({ length: 2200 }, (_, index) => ({ id: `g-${index}-${"x".repeat(115)}`, name: "a".repeat(40), color: CUBE_COLORS[0], cubeIds: ["cube-1"] }));
    const heavy = { ...tool, payload: { ...tool.payload, history: { ...tool.payload.history, initial: { ...tool.payload.history.initial, groups } } } };
    expect(cubeCoursewareToolSchema.safeParse(heavy).success).toBe(true);
    const page = createEmptyCoursewareCompositionPage();
    page.layout.blocks = [0, 1].map((index) => ({ id: `tool-${index}`, type: "tool", tool: heavy, placement: { column: index * 6, row: 0, columnSpan: 6, rowSpan: 9 } }));
    expect(coursewareCompositionPageSchema.safeParse(page).success).toBe(false);
    const oversized = structuredClone(heavy);
    oversized.payload.history.initial.groups = [...groups, ...groups.map((group) => ({ ...group, id: `other-${group.id}`.slice(0, 128) }))].slice(0, 4096);
    expect(cubeCoursewareToolSchema.safeParse(oversized).success).toBe(false);
  });

  it("dispatches saved payloads through the shared renderer without live account access", () => {
    const renderer = fs.readFileSync("src/features/tools/courseware/CubeStructuresCourseware.tsx", "utf8");
    const dispatch = fs.readFileSync("src/features/tools/components.tsx", "utf8");
    const stage = fs.readFileSync("src/features/courseware-doc/CoursewareCompositionStage.tsx", "utf8");
    expect(dispatch).toContain("<CubeCoursewarePreview payload={tool.payload} classroom={classroom ? {");
    expect(dispatch).toContain("state: classroom.state?.contentVersion === CUBE_COURSEWARE_CONTENT_VERSION ? classroom.state.state : undefined");
    expect(stage).toContain("tool={block.tool} classroom={toolSynced");
    expect(stage).toContain('data-classroom-tool={toolSynced ? "synchronized" : "read-only"}');
    expect(renderer).toContain("preview = false");
    expect(renderer).toContain("cameraInteractive={preview}");
    expect(renderer).toContain("<CubeStructuresViewport");
    expect(renderer).toContain("<CubeStructuresWorkbench");
    expect(renderer).toContain("readOnly: classroom ? !classroom.onChange || publishing : !preview");
    const workbench = fs.readFileSync("src/features/tools/spatial-lab/CubeStructuresWorkbench.tsx", "utf8");
    expect(workbench).toContain("enabled: !courseware");
    expect(workbench).toContain('TOOL_BUTTONS.filter(({ id }) => hasTool(id))');
    expect(workbench).toContain("inert={readOnly}");
    expect(renderer).not.toMatch(/createCubeDraftStore|useCubeDrafts|window.location/);
  });

  it("keeps the draft name as accessible metadata without a title row or nested canvas border", () => {
    const renderer = fs.readFileSync("src/features/tools/courseware/CubeStructuresCourseware.tsx", "utf8");
    const styles = fs.readFileSync("src/features/tools/spatial-lab/CubeStructuresWorkbench.module.css", "utf8");
    expect(renderer.match(/aria-label=\{payload.title\}/g)).toHaveLength(2);
    expect(renderer).not.toContain(">{payload.title}</div>");
    expect(styles).toContain('.workspace[data-workbench-mode="courseware"] { padding: 0; }');
    expect(styles).toContain('.workspace[data-workbench-mode="courseware"] .canvas { border: 0; }');
  });

  it("restores saved courseware after the source draft is no longer available", () => {
    const session = operateCubeSession(startCubeRecording(initial()), { kind: "axes", visible: false });
    const drafts = new Map([["source-draft", draft(session)]]);
    const tool = createCubeCoursewareTool(drafts.get("source-draft")!, "recording");
    const saved = JSON.stringify(addCoursewareCompositionTool(createEmptyCoursewareCompositionPage(), tool));
    drafts.delete("source-draft");
    const restored = coursewareCompositionPageSchema.parse(JSON.parse(saved)).layout.blocks[0];
    expect(drafts.size).toBe(0);
    expect(saved).not.toContain("source-draft");
    expect(restored.type).toBe("tool");
    if (restored.type !== "tool") throw new Error("Expected saved tool");
    const restoredTool = cubeCoursewareToolSchema.parse(restored.tool);
    expect(replayCubeHistory(restoredTool.payload.history)).toEqual(tool.payload.history.initial);
    expect(replayCubeHistory(restoredTool.payload.history, 1)).toEqual(replayCubeHistory(session.lesson!, 1));
  });
});
