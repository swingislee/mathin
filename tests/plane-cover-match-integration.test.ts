// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanarWorkbench } from "@/features/tools/planar-kit/PlanarWorkbench";
import { planarScene, scenesForPlanarTool } from "@/features/tools/planar-kit/scene-registry";
import { planarSnapshot, planarSnapshotForTool, type PlanarState } from "@/features/tools/planar-kit/contract";
import { planarCommit } from "@/features/tools/planar-kit/presentation";
import { resolvePlanarContextActions } from "@/features/tools/planar-kit/context-actions";
import { parseToolScene, freezeToolScene } from "@/features/tools/scenes/contract";
import { toolCoursewareContractsForSurface } from "@/features/tools/scenes/registry";
import { createClassroomToolState, parseClassroomToolState, type ClassroomToolUpdate } from "@/features/tools/courseware/tool-classroom";
import { toolSceneOriginHash } from "@/features/tools/scenes/classroom-envelope";
import { classroomInteractionAuditIssues } from "@/features/classroom/sync/interaction-audit";
import { createMatchState, matchIds } from "@/features/tools/plane-matchsticks/model";
import { addCoverPiece, coverToStage, COVER_CELL, createCoverState } from "@/features/tools/plane-covering/model";
import { coverMatchCases } from "./fixtures/plane-cover-match-cases";

vi.mock("next-intl", () => ({ useLocale: () => "zh" }));
const upgrades = [["plane-matchsticks", "51", "51-create", "stick.0"], ["plane-covering", "57", "57-create", "piece.0"]] as const;
describe("covering and matchsticks use the existing versioned Tools path", () => {
  for (const [toolId, oldId, newId, target] of upgrades) it(`${toolId}: new default and both editors, legacy copy and classroom replay remain version-bound`, () => {
    const definition = planarScene(newId), initial = toolId === "plane-covering" ? addCoverPiece(definition.create()) : definition.create();
    const old = planarScene(oldId).create(), version = `${toolId}-lesson-v2` as const;
    expect(scenesForPlanarTool(toolId).map((entry) => entry.id)).toEqual([newId]);
    expect(scenesForPlanarTool(toolId, `${toolId}-lesson-v1`).map((entry) => entry.id)).toEqual([oldId]);
    const scene = parseToolScene({ toolId, contentVersion: version, payload: { title: "Prepared materials", initial } }), frozen = freezeToolScene(scene);
    const event = createClassroomToolState("page", "doc", "instance", { toolId, contentVersion: version, state: planarSnapshot(initial) } as ClassroomToolUpdate, toolSceneOriginHash(frozen.payload));
    expect(parseClassroomToolState(JSON.parse(JSON.stringify(event)))).toEqual(event);
    expect(parseClassroomToolState({ ...event, state: planarSnapshot(old) })).toBeNull();
    expect(() => parseToolScene({ toolId, contentVersion: `${toolId}-lesson-v1`, payload: { title: "Historical material", initial: old } })).not.toThrow();
    for (const surface of ["microcourse", "formal-courseware"] as const) {
      const offered = toolCoursewareContractsForSurface(surface).filter((item) => item.catalogId === toolId);
      expect(offered).toHaveLength(1); expect(offered[0].contentVersion).toBe(version);
    }
    const context = resolvePlanarContextActions(definition, initial, target);
    expect(context?.items.length).toBeGreaterThan(0);
    for (const entry of context!.items) if (entry.kind === "action") {
      expect([...(definition.actions ?? []), ...definition.operations!.flatMap((operation) => operation.actions ?? [])]).toContain(entry.item);
      const endpoint = entry.item.run(initial, { selected: target });
      expect(planarSnapshotForTool(toolId, version).safeParse(planarSnapshot(endpoint)).success).toBe(true);
    }
  });
  it("runs the shared state corpus used by PostgreSQL and preserves secure-context independence", () => {
    const cases = coverMatchCases();
    expect(cases.length).toBeGreaterThan(80);
    for (const item of cases) { let accepted = true; try { parseToolScene(item.scene); } catch { accepted = false; } expect(accepted, item.label).toBe(item.accepted); }
    const cryptoSource = crypto; vi.stubGlobal("crypto", { getRandomValues: cryptoSource.getRandomValues.bind(cryptoSource) });
    try { const initial = createMatchState(); expect(planarCommit(planarSnapshot(initial), initial, initial, { id: "match-turn", duration: 900, now: 1 }).motion?.id).toMatch(/^[a-f0-9-]{36}$/); }
    finally { vi.unstubAllGlobals(); }
    expect(classroomInteractionAuditIssues()).toEqual([]);
    const sql = readFileSync("supabase/migrations/20261002130000_tool_plane_cover_match.sql", "utf8");
    expect(sql).toContain("PLANE_COVER_MATCH_DISPATCH_PRECONDITION"); expect(sql).toContain("PLANE_COVER_MATCH_CATALOG_PRECONDITION");
    expect(sql).toContain("revoke all on function public.tool_plane_cover_match_scene_is_valid(jsonb) from public,anon,authenticated,service_role");
    const defaults = JSON.parse(readFileSync("supabase/tests/tool_plane_cover_match.sql", "utf8").split("$fixtures$")[1]);
    expect(defaults).toHaveLength(2);
    for (const fixture of defaults) { expect(fixture.payload.initial).toEqual(planarScene(fixture.payload.initial.sceneId).create()); expect(parseToolScene(fixture)).toEqual(fixture); }
  });
});

let container: HTMLDivElement, root: Root, time: number, nextFrame: number, frames: Map<number, FrameRequestCallback>;
const capture = vi.fn<(state: PlanarState | null) => void>();
const current = () => capture.mock.calls.at(-1)?.[0];
const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const stage = () => container.querySelector<SVGSVGElement>("svg[viewBox='0 0 960 720']")!;
const material = (label: string) => container.querySelector<SVGGElement>(`g[aria-label="${label}"]`)!;
async function pointer(target: Element, type: string, x: number, y: number) { await act(async () => target.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), { clientX: x, clientY: y, pointerId: 1, isPrimary: true, button: 0 }))); }
async function tick(ms: number) { time += ms; const callbacks = [...frames.values()]; frames.clear(); await act(async () => callbacks.forEach((frame) => frame(time))); }
const render = async (props: Partial<ComponentProps<typeof PlanarWorkbench>> = {}) => { await act(async () => root.render(createElement(PlanarWorkbench, { toolId: "plane-matchsticks", locale: "zh", onSnapshot: capture, ...props }))); };
describe("material operations in the real shared planar host", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); time = 1000; nextFrame = 0; frames = new Map(); capture.mockClear();
    vi.spyOn(Date, "now").mockImplementation(() => time);
    vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => { frames.set(++nextFrame, frame); return nextFrame; }); vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    Object.defineProperties(SVGSVGElement.prototype, {
      getScreenCTM: { configurable: true, value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) },
      setPointerCapture: { configurable: true, value: vi.fn() }, hasPointerCapture: { configurable: true, value: () => true }, releasePointerCapture: { configurable: true, value: vi.fn() },
    });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it("selects, copies, removes, undoes and restores a stick, with operation-only rotation handles", async () => {
    await render(); const initial = current()!, at = initial.points["stick.0"];
    await pointer(material("火柴棒 1"), "pointerdown", at.x, at.y); await pointer(stage(), "pointerup", at.x, at.y);
    expect(container.querySelector("[data-match-turn-handle]")).toBeNull();
    await act(async () => button("转动火柴棒").click()); expect(container.querySelector("[data-match-turn-handle]")).not.toBeNull();
    await act(async () => button("转动火柴棒").click()); expect(container.querySelector("[data-match-turn-handle]")).toBeNull();
    await act(async () => button("复制所选火柴棒").click()); expect(matchIds(current()!)).toEqual([0, 1]);
    await act(async () => button("移除所选火柴棒").click()); expect(matchIds(current()!)).toEqual([0]);
    await act(async () => button("撤销").click()); expect(matchIds(current()!)).toEqual([0, 1]);
    await act(async () => button("恢复备好的起点").click()); expect(current()).toEqual(initial);
  });
  it("does not persist a cancelled stick drag and hides controls on read-only classroom displays", async () => {
    await render(); const initial = current()!, at = initial.points["stick.0"];
    await pointer(material("火柴棒 1"), "pointerdown", at.x, at.y); await pointer(stage(), "pointermove", at.x + 50, at.y + 40);
    expect(current()).toBeNull(); await pointer(stage(), "pointercancel", at.x + 50, at.y + 40); expect(current()).toEqual(initial);
    await render({ readOnly: true });
    expect(button("复制所选火柴棒").disabled).toBe(true); expect(container.querySelector("[data-match-turn-handle]")).toBeNull();
    await pointer(material("火柴棒 1"), "pointerdown", at.x, at.y); await pointer(stage(), "pointerup", at.x + 70, at.y);
    expect(current()).toEqual(initial);
  });
  it("snaps a domino once, rejects an occupied landing, and clears local selection without changing the board", async () => {
    const initial = addCoverPiece(addCoverPiece(createCoverState())), start = coverToStage(initial, initial.points["piece.1"]);
    await render({ toolId: "plane-covering", initial });
    await pointer(material("骨牌 2"), "pointerdown", start.x, start.y); await pointer(stage(), "pointermove", start.x + 8, start.y + COVER_CELL + 6); await pointer(stage(), "pointerup", start.x + 8, start.y + COVER_CELL + 6);
    await tick(181); expect(current()?.points["piece.1"]).toEqual({ x: 2, y: 1 });
    const settled = current()!, nextStart = coverToStage(settled, settled.points["piece.1"]);
    await pointer(material("骨牌 2"), "pointerdown", nextStart.x, nextStart.y); await pointer(stage(), "pointermove", nextStart.x - 2 * COVER_CELL, nextStart.y - COVER_CELL); await pointer(stage(), "pointerup", nextStart.x - 2 * COVER_CELL, nextStart.y - COVER_CELL);
    await tick(181); expect(current()?.points["piece.1"]).toEqual({ x: 2, y: 1 });
    await act(async () => stage().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(current()).toEqual(settled); expect(button("移除所选骨牌").disabled).toBe(true);
    expect(container.textContent).not.toContain("当前几何无法保存");
  });
});
