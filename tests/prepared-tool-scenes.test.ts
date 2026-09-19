import { describe, expect, it, vi } from "vitest";
import { freezeToolScene, parseToolScene, toolSceneCatalogId } from "@/features/tools/scenes/contract";
import { TOOL_SCENE_DEFINITIONS } from "@/features/tools/scenes/registry";
import { fractionCoursewareSchema, motionCoursewareSchema, initialFractionScene, initialMotionScene, motionFrame } from "@/features/tools/scenes/numeric-teaching-content";
import { createToolDraftStore, readToolDraft, ToolDraftError } from "@/features/tools/scenes/draft-store";
import { createCubeCoursewareTool } from "@/features/tools/courseware/cube-structures-content";
import { cubeDraftSnapshot } from "@/features/tools/spatial-lab/cube-structures-draft";
import { createCubeSession } from "@/features/tools/spatial-lab/cube-structures-session";
import { createClassroomToolState, coursewareToolOriginHash, hasClassroomToolAdapter, parseClassroomToolState } from "@/features/tools/courseware/tool-classroom";
import { createEmptyCoursewareCompositionPage } from "@/features/courseware-doc/composition-page-schema";
import { formalManualPageSchema } from "@/features/courseware-studio/formal-manual-page-contract";
import { formalCubePageSchema } from "@/features/courseware-studio/formal-cube-page-contract";
import { resolveClassroomRendererInputProfile } from "@/features/classroom/input/capabilities";
import { buildNet, diceTool, netTool } from "./fixtures/spatial-teaching-content";
import { projectionTool } from "./fixtures/projection-tool";

export const fractionTool = () => fractionCoursewareSchema.parse({ toolId: "fraction-line", contentVersion: "fraction-line-lesson-v1", payload: { title: "Fractions", initial: { ...initialFractionScene(), rows: [{ denominator: 3, count: 5, color: "var(--rose)" }] } } });
export const motionTool = () => motionCoursewareSchema.parse({ toolId: "motion-lab", contentVersion: "motion-lab-lesson-v1", payload: { title: "Three tracks", initial: { ...initialMotionScene(), runways: [1, 2, 3].map((id) => ({ ...initialMotionScene().runways[0], id, speed: id, time: 10, distance: id * 10, x: id * 2 })) } } });
const owner = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const id = "20000000-0000-4000-8000-000000000001";
const meta = { id, name: "Three tracks", catalogId: "motion-lab", revision: 1, createdAt: "2026-09-18T01:00:00Z", updatedAt: "2026-09-18T01:00:00Z" };
const envelope = (data: unknown, accountId = owner) => Response.json({ data, accountId });

describe("Tools-wide scene contract", () => {
  it("registers independent tools with one shared courseware and classroom boundary", async () => {
    const cube = createCubeCoursewareTool({ name: "Cube", snapshot: cubeDraftSnapshot(createCubeSession([{ x: 0, y: 0, z: 0 }]), 0) }, "current");
    const scenes = [cube, netTool(await buildNet()), diceTool(), fractionTool(), motionTool(), projectionTool()];
    expect(TOOL_SCENE_DEFINITIONS.map((d) => d.catalogId).sort()).toEqual(["cube-net", "cube-structures", "dice", "fraction-line", "motion-lab", "projection"]);
    for (const scene of scenes) {
      expect(parseToolScene(scene)).toEqual(scene);
      expect(hasClassroomToolAdapter(scene)).toBe(true);
      expect(TOOL_SCENE_DEFINITIONS.find((d) => d.catalogId === toolSceneCatalogId(scene))?.contentVersion).toBe(scene.contentVersion);
      const page = createEmptyCoursewareCompositionPage();
      page.layout.blocks.push({ id: "tool-1", type: "tool", tool: scene, placement: { column: 0, row: 0, columnSpan: 12, rowSpan: 9 } });
      expect(formalManualPageSchema.safeParse(page).success).toBe(true);
      expect(formalCubePageSchema.safeParse(page).success).toBe(true);
      expect(resolveClassroomRendererInputProfile({ id: "page", type: "doc", docId: "doc", title: "Tools" }, null, page)).toMatchObject({ renderer: "document:composition:tools", audited: true });
    }
    expect(cube.toolId).toBe("spatial-lab"); // 已发布 wire ID 保持兼容。
  });
  it("freezes a complete copy without a draft pointer, answer or checkpoint metadata", () => {
    const source = motionTool(), frozen = freezeToolScene(source);
    const hash = coursewareToolOriginHash(frozen.payload);
    source.payload.initial.runways[0].speed = 25;
    expect(frozen.payload).not.toEqual(source.payload);
    expect(coursewareToolOriginHash(frozen.payload)).toBe(hash);
    for (const extra of [{ draftId: id }, { answer: 7 }, { checkpoint: true }]) expect(() => parseToolScene({ ...frozen, ...extra })).toThrow();
    expect(() => parseToolScene({ ...frozen, contentVersion: "future-v1" })).toThrow();
    expect(() => parseToolScene({ ...frozen, toolId: "fraction-line" })).toThrow();
  });
  it("preserves numeric tool parameters and rejects invalid or active preparation scenes", () => {
    const scene = motionTool();
    expect(parseToolScene(JSON.parse(JSON.stringify(scene)))).toEqual(scene);
    for (const change of [
      { length: -1 }, { extra: true }, { playback: { phase: "running", startedAt: 10, elapsedMs: 0 } },
      { runways: [scene.payload.initial.runways[0], scene.payload.initial.runways[0]] },
      { runways: [{ ...scene.payload.initial.runways[0], head: "https://example.org/tracker.png" }] },
      { runways: [{ ...scene.payload.initial.runways[0], speed: Infinity }] },
    ]) expect(() => parseToolScene({ ...scene, payload: { ...scene.payload, initial: { ...scene.payload.initial, ...change } } })).toThrow();
    expect(() => parseToolScene({ ...fractionTool(), payload: { title: "bad", initial: { ...initialFractionScene(), rows: [{ denominator: 0, count: 1, color: "red" }] } } })).toThrow();
  });
  it("replays motion from one time anchor, pauses, finishes, and leaves the stored initial state intact", () => {
    const initial = motionTool().payload.initial;
    const running = { ...initial, playback: { phase: "running" as const, elapsedMs: 0, startedAt: 1000 } };
    expect(motionFrame(running, 3000).runways.map((r) => r.x)).toEqual([4, 8, 12]);
    expect(motionFrame({ ...running, playback: { phase: "paused", elapsedMs: 2000, startedAt: 0 } }, 9000).runways).toEqual(motionFrame(running, 3000).runways);
    expect(motionFrame(running, 99000).phase).toBe("idle");
    expect(motionFrame(initial, 99000).runways.map((r) => r.x)).toEqual([2, 4, 6]);
    expect(running.runways[0].x).toBe(2);
  });
  it("uses shared versioned events for numeric tools, including running motion and reset snapshots", () => {
    for (const scene of [fractionTool(), motionTool()]) {
      const update = { toolId: scene.toolId, contentVersion: scene.contentVersion, state: { id: "state-1", snapshot: scene.payload.initial, motion: null, settles: null } };
      const event = createClassroomToolState("page", "doc", "instance-1", update as Parameters<typeof createClassroomToolState>[3], coursewareToolOriginHash(scene.payload));
      expect(parseClassroomToolState(event)).toEqual(event);
      expect(parseClassroomToolState({ ...event, toolId: "spatial-lab" })).toBeNull();
    }
  });
});

describe("common Tools draft transport", () => {
  it("binds an account, lists metadata and updates with the expected revision", async () => {
    const draft = { ...meta, scene: motionTool() };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(envelope([meta])).mockResolvedValueOnce(envelope(draft)).mockResolvedValueOnce(envelope({ ...draft, revision: 2 }));
    const store = createToolDraftStore({ fetcher });
    expect(await store.list()).toEqual([meta]); expect(await store.read(id)).toEqual(draft);
    expect((await store.save(draft.scene, draft)).revision).toBe(2);
    expect(fetcher.mock.calls[2][0]).toBe("/api/tools/scenes");
    expect(fetcher.mock.calls[2][1]).toMatchObject({ cache: "no-store", credentials: "same-origin", headers: { "x-tool-account": owner } });
    expect(JSON.parse(fetcher.mock.calls[2][1]!.body as string)).toEqual({ id, expectedRevision: 1, scene: draft.scene });
  });
  it("supports LAN UUID generation and keeps save-as independent", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(envelope([])).mockResolvedValueOnce(envelope({ ...meta, scene: motionTool() }));
    const store = createToolDraftStore({ fetcher });
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    try {
      await store.list(); await store.save(motionTool());
      const body = JSON.parse(fetcher.mock.calls[1][1]!.body as string);
      expect(body.id).not.toBe(id); expect(body.expectedRevision).toBe(0); expect(body).not.toHaveProperty("owner_id");
    } finally { vi.unstubAllGlobals(); }
  });
  it("keeps account changes and version conflicts explicit", async () => {
    const fetcher = vi.fn<typeof fetch>(), store = createToolDraftStore({ fetcher });
    await expect(store.save(motionTool())).rejects.toEqual(new ToolDraftError("auth-required"));
    fetcher.mockResolvedValueOnce(envelope([])).mockResolvedValueOnce(envelope([], other)).mockResolvedValueOnce(Response.json({ code: "conflict" }, { status: 409 }));
    await store.list(); await expect(store.list()).rejects.toEqual(new ToolDraftError("account-changed"));
    await expect(store.save(motionTool(), { id, revision: 1 })).rejects.toEqual(new ToolDraftError("conflict"));
    expect(fetcher.mock.calls[2][1]!.headers).toMatchObject({ "x-tool-account": owner });
    expect(() => readToolDraft({ ...meta, catalogId: "dice", scene: motionTool() })).toThrow();
  });
});
