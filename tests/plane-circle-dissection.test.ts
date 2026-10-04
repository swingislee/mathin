import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { arrangeCircleSectors, canonicalSectorPose, changeCircleCount, circleLayout, createCircleDissectionState, dragCircleSector, interpolateCircleSectors, sectorPoint, sectorPose, sectorToStage, selectSector, setCircleSectorField, snapCircleSector } from "@/features/tools/plane-circle-dissection/model";
import { planeCircleDissectionScene as scene, circleSectorPath } from "@/features/tools/plane-circle-dissection/scenes";
import { isValidCircleDissectionState } from "@/features/tools/plane-circle-dissection/validation";
import { planarSnapshot, planarSnapshotForTool } from "@/features/tools/planar-kit/contract";
import { planarCommit, planarFrame, planarHistory, planarPause } from "@/features/tools/planar-kit/presentation";
import { toolSceneSchema } from "@/features/tools/scenes/contract";
import type { PlanarDrawingApi } from "@/features/tools/planar-kit/types";
import { planeCircleDissectionCases } from "./fixtures/plane-circle-dissection-cases";
const initial = () => createCircleDissectionState();

describe("true sector dissection", () => {
  it("round-trips every accepted endpoint and rejects unknown or incompatible state", () => {
    for (const entry of planeCircleDissectionCases()) expect(toolSceneSchema.safeParse(entry.scene).success, entry.label).toBe(entry.accepted);
  });
  it("keeps canonical circle and rows when refining and coarsening", () => {
    for (const layout of ["circle", "rows"] as const) for (const count of [8, 16, 32, 64, 32, 16, 8]) {
      const next = changeCircleCount(arrangeCircleSectors(initial(), layout), count);
      expect(circleLayout(next)).toBe(layout); expect(next.params.count).toBe(count);
      for (let id = 0; id < count; id++) expect(sectorPose(next, id)).toEqual(canonicalSectorPose(count, 2.3, id, layout));
    }
  });
  it("splits each freely arranged region in place and permits only geometrically joinable pairs", () => {
    const custom = setCircleSectorField(setCircleSectorField(selectSector(initial(), "sector.2"), "x", -3.375), "angle", 35.125);
    const refined = changeCircleCount(custom, 64); expect(refined.params.active).toBe(8);
    for (let id = 0; id < 16; id++) for (let child = 0; child < 4; child++) {
      const a = sectorPose(custom, id)!, b = sectorPose(refined, id * 4 + child)!;
      expect({ x: b.x, y: b.y }).toEqual({ x: a.x, y: a.y });
      expect(sectorPoint(b, 2.3, 0).x).toBeCloseTo(sectorPoint(a, 2.3, child * 360 / 64).x, 10);
      expect(sectorPoint(b, 2.3, 360 / 64).y).toBeCloseTo(sectorPoint(a, 2.3, (child + 1) * 360 / 64).y, 10);
    }
    expect(changeCircleCount(refined, 16)).toEqual(custom);
    const separated = setCircleSectorField(selectSector(refined, "sector.9"), "y", 8);
    expect(changeCircleCount(separated, 32)).toBe(separated);
  });
  it("retains real geometry at full-turn limits and all interpolation frames", () => {
    for (const angle of [-36000, 36000]) {
      const source = setCircleSectorField(setCircleSectorField(selectSector(initial(), "sector.0"), "x", 8), "angle", angle);
      const target = changeCircleCount(source, 64); expect(target.params.count).toBe(64);
      for (const progress of [.0001, .2, .5, .9, .9999]) expect(isValidCircleDissectionState(interpolateCircleSectors(source, target, progress))).toBe(true);
      const rows = arrangeCircleSectors(source, "rows");
      for (const progress of [.1, .6, .99]) expect(isValidCircleDissectionState(interpolateCircleSectors(source, rows, progress))).toBe(true);
    }
  });
  it("edits one actual pose and changes radius without resetting a custom arrangement", () => {
    const start = selectSector(initial(), "sector.5"), next = setCircleSectorField(setCircleSectorField(start, "x", 1.237), "angle", -721.375);
    expect(sectorPose(next, 5)).toEqual({ x: 1.237, y: 2.5, angle: -721.375 });
    expect(sectorPose(next, 4)).toEqual(sectorPose(start, 4));
    expect(setCircleSectorField(next, "radius", 2.875).points).toEqual(next.points);
    expect(setCircleSectorField(next, "radius", .25)).toBe(next);
    expect(setCircleSectorField(next, "active", 65)).toBe(next);
  });
  it("uses frozen drag deltas and unwraps a turn continuously across the angular branch", () => {
    const start = initial(), moved = dragCircleSector(start, "sector.2", { x: 0, y: 0 }, { x: 12.5, y: -25 });
    expect(sectorPose(moved, 2)).toEqual({ x: 3.75, y: 3, angle: 45 });
    expect(sectorPose(moved, 3)).toEqual(sectorPose(start, 3));
    const pose = sectorPose(start, 0)!, at = (degrees: number) => sectorToStage(sectorPoint(pose, 2, degrees)), grip = at(170), point = at(190);
    const turned = dragCircleSector(start, "sector-turn.0", point, { x: point.x - grip.x, y: point.y - grip.y });
    expect(sectorPose(turned, 0)?.angle).toBeCloseTo(20, 9);
    const point2 = at(550), previous = setCircleSectorField(selectSector(start, "sector.0"), "angle", 370);
    const turned2 = dragCircleSector(start, "sector-turn.0", point2, { x: point2.x - grip.x, y: point2.y - grip.y }, { previous });
    expect(sectorPose(turned2, 0)?.angle).toBeCloseTo(380, 9);
  });
  it("snaps near a true target only, retaining unrelated sectors and orientation", () => {
    const start = selectSector(initial(), "sector.4"), near = setCircleSectorField(setCircleSectorField(start, "x", 3.6), "angle", 449);
    const snapped = snapCircleSector(near, "sector.4")!;
    expect(sectorPose(snapped, 4)).toEqual({ x: 3.5, y: 2.5, angle: 450 });
    expect(sectorPose(snapped, 5)).toEqual(sectorPose(start, 5));
    expect(snapCircleSector(setCircleSectorField(near, "x", 5), "sector.4")).toBeNull();
    expect(snapCircleSector({ ...near, flags: { ...near.flags, snap: false } }, "sector.4")).toBeNull();
  });
  it("draws real SVG arcs, opt-in observations and operation-scoped editable rotation handles", () => {
    const state = selectSector(initial(), "sector.2");
    const api = (editable: boolean, operation: string | null): PlanarDrawingApi => ({ editable, operation, locale: "en", selected: "sector.2", bind: (target, label) => ({ role: "button", tabIndex: editable ? 0 : -1, "aria-label": label ?? target, "aria-pressed": false, "aria-disabled": !editable }) });
    const plain = renderToStaticMarkup(scene.draw(state, api(true, null)));
    expect(plain.match(/data-circle-sector=/g)).toHaveLength(16); expect(plain).not.toContain("data-circle-measurements"); expect(plain).not.toContain("data-circle-turn-handle");
    expect(circleSectorPath(sectorPose(state, 2)!, 2.3, 16)).toMatch(/ A[0-9.e-]+,[0-9.e-]+ 0 0 0 /);
    expect(renderToStaticMarkup(scene.draw(state, api(true, "circle-sector-pose")))).toContain("data-circle-turn-handle");
    expect(renderToStaticMarkup(scene.draw(state, api(false, "circle-sector-pose")))).not.toContain("data-circle-turn-handle");
    expect(scene.operations![0].fields!.find(field => field.key === "angle")!.step).toBeUndefined();
  });
  it("pauses and resumes rigid sectors and keeps exact snapshots without native randomUUID", () => {
    vi.stubGlobal("crypto", { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    try {
      const from = arrangeCircleSectors(initial(), "rows"), action = scene.actions!.find(item => item.id === "circle-refine")!, to = action.run(from, { selected: null });
      const motion = planarCommit(planarSnapshot(from), from, to, { id: action.id, duration: action.duration!, now: 1000 });
      const middle = planarFrame(motion, scene, 1500), paused = planarPause(motion, 1500, true);
      expect(planarSnapshotForTool("plane-circle-area").safeParse(motion).success).toBe(true);
      expect(isValidCircleDissectionState(middle)).toBe(true); expect(planarFrame(paused, scene, 100000)).toEqual(middle);
      expect(planarFrame(planarPause(paused, 100000, false), scene, 105000)).toEqual(to);
      expect(planarHistory(motion, "undo").current).toEqual(from);
    } finally { vi.unstubAllGlobals(); }
  });
});
