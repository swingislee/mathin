import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PLANAR_TOOLS, planarSnapshot, planarStateSchema, planarSnapshotForTool } from "@/features/tools/planar-kit/contract";
import { planarScenes, planarScene } from "@/features/tools/planar-kit/scene-registry";
import { planarCommit, planarFrame, planarPause, planarHistory } from "@/features/tools/planar-kit/presentation";
import { perpendicularFoot, rightAnglePoints, HeightMark } from "@/features/tools/planar-kit/geometry";
import { parseToolScene, freezeToolScene } from "@/features/tools/scenes/contract";
import { getTool } from "@/features/tools/registry";
import { getToolSceneDefinition, toolCoursewareContractsForSurface } from "@/features/tools/scenes/registry";
import { createClassroomToolState, parseClassroomToolState, hasClassroomToolAdapter, type ClassroomToolUpdate } from "@/features/tools/courseware/tool-classroom";
import { createEmptyCoursewareCompositionPage } from "@/features/courseware-doc/composition-page-schema";
import { formalManualPageSchema } from "@/features/courseware-studio/formal-manual-page-contract";
import { formalCubePageSchema } from "@/features/courseware-studio/formal-cube-page-contract";
import { toolSceneOriginHash } from "@/features/tools/scenes/classroom-envelope";
import { resolveClassroomRendererInputProfile } from "@/features/classroom/input/capabilities";

describe("approved planar scenes use one Tools registration path", () => {
  it("keeps the SQL save fixtures identical to all current scene factories", () => {
    const sql = readFileSync("supabase/tests/planar_tool_scene_assertions.sql", "utf8");
    const fixtures = JSON.parse(sql.split("$fixtures$")[1]) as { toolId: string; payload: { initial: ReturnType<typeof planarScene>["create"] extends () => infer S ? S : never } }[];
    expect(fixtures).toHaveLength(planarScenes.length);
    for (const fixture of fixtures) {
      const scene = planarScene(fixture.payload.initial.sceneId);
      expect(fixture.toolId).toBe(scene.toolId);
      expect(fixture.payload.initial).toEqual(scene.create());
    }
  });
  it("covers 49 approved or adjusted scenes once, under 21 teacher-facing tools", () => {
    expect(PLANAR_TOOLS).toHaveLength(21); expect(planarScenes).toHaveLength(49);
    const ids = PLANAR_TOOLS.flatMap((tool) => [...tool.scenes]);
    expect(new Set(ids).size).toBe(49);
    expect(planarScenes.map((scene) => scene.id).sort()).toEqual([...ids].sort());
    for (const id of ["09", "19", "23", "25", "26", "28", "29", "30", "31", "35", "50"]) expect(ids).not.toContain(id);
  });
  for (const tool of PLANAR_TOOLS) it(`${tool.id}: strict scene, both editors, frozen copy and classroom`, () => {
    expect(getTool(tool.id)).toBeDefined(); expect(getToolSceneDefinition(tool.id)?.contentVersion).toBe(tool.version);
    for (const surface of ["microcourse", "formal-courseware"] as const) expect(toolCoursewareContractsForSurface(surface).some((entry) => entry.catalogId === tool.id)).toBe(true);
    for (const id of tool.scenes) {
      const initial = planarScene(id).create();
      const scene = parseToolScene({ toolId: tool.id, contentVersion: tool.version, payload: { title: tool.zh, initial } });
      expect(hasClassroomToolAdapter(scene)).toBe(true);
      const page = createEmptyCoursewareCompositionPage();
      page.layout.blocks.push({ id: "planar-1", type: "tool", tool: scene, placement: { column: 0, row: 0, columnSpan: 12, rowSpan: 9 } });
      expect(formalManualPageSchema.safeParse(page).success).toBe(true); expect(formalCubePageSchema.safeParse(page).success).toBe(true);
      expect(resolveClassroomRendererInputProfile({ id: "page", type: "doc", docId: "doc", title: "Plane" }, null, page)).toMatchObject({ renderer: "document:composition:tools", audited: true });
      const frozen = freezeToolScene(scene), hash = toolSceneOriginHash(frozen.payload);
      initial.phase = 0.8;
      expect(toolSceneOriginHash(frozen.payload)).toBe(hash);
      const state = planarSnapshot(planarScene(id).create());
      const event = createClassroomToolState("page", "doc", "instance", { toolId: tool.id, contentVersion: tool.version, state } as ClassroomToolUpdate, hash);
      expect(parseClassroomToolState(event)).toEqual(event);
      expect(parseClassroomToolState({ ...event, toolId: "not-a-tool" })).toBeNull();
      expect(() => parseToolScene({ ...scene, payload: { ...scene.payload, initial: { ...state.current, phase: 2 } } })).toThrow();
      expect(() => parseToolScene({ ...scene, payload: { ...scene.payload, draftId: "live-draft" } })).toThrow();
    }
  });
  it("rejects another tool's scene, invalid geometry and ambiguous classroom endpoints", () => {
    const start = planarScene("14").create();
    expect(planarSnapshotForTool("plane-motion").safeParse(planarSnapshot(start)).success).toBe(false);
    expect(planarStateSchema.safeParse({ ...start, params: { ...start.params, base: 0 } }).success).toBe(false);
    const next = { ...start, phase: 1 };
    const snapshot = planarCommit(planarSnapshot(start), start, next, { id: "linear", duration: 1000, now: 1000 });
    expect(planarSnapshotForTool("plane-area").safeParse({ ...snapshot, motion: { ...snapshot.motion, to: start } }).success).toBe(false);
  });
  it("keeps domain actions, field limits and pausable animation frames persistable", () => {
    for (const scene of planarScenes) {
      const start = scene.create();
      const check = (state: typeof start, label: string) => expect(planarStateSchema.safeParse(state).success, `${scene.id}: ${label}`).toBe(true);
      for (const field of scene.fields ?? []) for (const value of field.options?.map((option) => option.value) ?? [field.min, field.max]) {
        check(scene.setField?.(start, field.key, value) ?? { ...start, params: { ...start.params, [field.key]: value } }, `field ${field.key}=${value}`);
      }
      for (const flag of scene.toggles ?? []) {
        check(scene.setFlag?.(start, flag.key, !start.flags[flag.key]) ?? { ...start, flags: { ...start.flags, [flag.key]: !start.flags[flag.key] } }, `flag ${flag.key}`);
      }
      for (const action of scene.actions ?? []) {
        if (action.disabled?.(start, { selected: null })) continue;
        const end = action.run(start, { selected: null }); check(end, `action ${action.id}`);
        if (action.duration) {
          const snapshot = planarCommit(planarSnapshot(start), start, end, { id: action.id, duration: action.duration, now: 1000 });
          for (const t of [0.25, 0.5, 0.75, 1]) {
            const frame = planarFrame(snapshot, scene, 1000 + t * action.duration);
            if (scene.id === "14" && action.id === "cut" && t < 1) {
              expect(planarStateSchema.safeParse(frame).success).toBe(false);
              expect(planarSnapshotForTool(scene.toolId).safeParse(planarPause(snapshot, 1000 + t * action.duration, true)).success).toBe(true);
            } else check(frame, `${action.id} at ${t}`);
          }
        }
      }
    }
  });
});

describe("one planar presentation timeline", () => {
  it("animates, pauses, resumes, joins late, undoes and restores without per-frame writes", () => {
    const scene = planarScene("20"), start = scene.create(), end = { ...start, phase: 1 }, initial = planarSnapshot(start);
    const moving = planarCommit(initial, start, end, { id: "linear", duration: 1000, now: 1000 });
    expect(planarFrame(moving, scene, 1500).phase).toBeCloseTo((start.phase + 1) / 2);
    const paused = planarPause(moving, 1500, true);
    expect(planarFrame(paused, scene, 9000)).toEqual(planarFrame(moving, scene, 1500));
    const resumed = planarPause(paused, 9000, false);
    expect(planarFrame(resumed, scene, 9500)).toEqual(end);
    expect(planarFrame(JSON.parse(JSON.stringify(moving)), scene, 5000)).toEqual(end);
    expect(planarHistory(moving, "undo").current).toEqual(start);
    expect(planarHistory(planarHistory(moving, "undo"), "redo").current).toEqual(end);
    expect(initial.current).toEqual(start);
  });
  it("replays an equal endpoint without adding empty history and generates UUIDs on LAN HTTP", () => {
    const start = planarScene("52").create();
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    try {
      const next = planarCommit(planarSnapshot(start), start, start, { id: "replay", duration: 1000, now: 1000 });
      expect(next.past).toHaveLength(0); expect(next.motion?.id).toMatch(/^[a-f0-9-]{36}$/);
    } finally { vi.unstubAllGlobals(); }
  });
});
describe("standard altitude marks", () => {
  it("shows a true right angle for horizontal, inclined and extended bases", () => {
    for (const [a, b, vertex] of [
      [{ x: 10, y: 100 }, { x: 300, y: 100 }, { x: 140, y: 10 }],
      [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 200 }],
      [{ x: 10, y: 100 }, { x: 150, y: 100 }, { x: 300, y: 30 }],
    ]) {
      const foot = perpendicularFoot(vertex, a, b)!;
      const points = rightAnglePoints(foot, Math.hypot(b.x - foot.x, b.y - foot.y) > 0 ? b : a, vertex)!;
      expect(points).toHaveLength(3);
      const html = renderToStaticMarkup(createElement(HeightMark, { vertex, baseA: a, baseB: b, label: "h" }));
      expect(html).toContain('data-right-angle="true"'); expect(html).toContain('stroke-width="2"');
    }
    expect(perpendicularFoot({ x: 1, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBeNull();
    expect(rightAnglePoints({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 })).toBeNull();
  });
});
