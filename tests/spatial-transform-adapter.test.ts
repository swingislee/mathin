import { describe, expect, it, vi } from "vitest";
import { Quaternion, Raycaster, Vector3 } from "three";
import { spatialGizmoInteraction, spatialGizmoPoint, snapSpatialTranslation } from "@/features/tools/spatial-interaction/gizmo-adapter";
import { rotateSpatialPose } from "@/features/tools/spatial-interaction/transform-handles";
import { cubePlaneOperations } from "@/features/tools/spatial-lab/cube-structures-drag";
import { createCubeSession, cubeSessionScene, operateCubeSessionBatch, startCubeRecording } from "@/features/tools/spatial-lab/cube-structures-session";
import { CUBE_STRUCTURES_LIMITS, replayCubeHistory } from "@/features/tools/spatial-lab/cube-structures-contract";

describe("shared transform adapter and domain endpoints", () => {
  it("preserves the untouched axis and uses each tool's existing grid origin", () => {
    expect(snapSpatialTranslation({ x: 0.6, y: 0, z: -0.6 }, 1, { x: 0.2, y: 0.75, z: 0.2 })).toEqual({ x: 0.8, y: 0, z: -0.2 });
    expect(snapSpatialTranslation({ x: -0.5, y: 1.1, z: 0 }, 1, { x: 0, y: 0.5, z: 0 }, { y: 0.5 })).toEqual({ x: -1, y: 1, z: 0 });
    expect(snapSpatialTranslation({ x: 0.21, y: 0, z: -0.19 }, 0)).toEqual({ x: 0.21, y: 0, z: -0.19 });
  });
  it("adapts quarter-turn endpoints without applying while previewing or writing a no-op", () => {
    const apply = vi.fn(() => true), center = { x: 2, y: 3, z: 4 };
    const g = spatialGizmoInteraction({ key: {}, selectedId: "object", mode: "rotate", enabled: true,
      objectFor: (id) => ({ id, center, radius: 2, translate: (delta) => ({ delta: snapSpatialTranslation(delta, 1), valid: true, apply }), rotate: () => ({ valid: true, apply }) }),
      pick: () => null, onSelect: vi.fn(), onPreview: vi.fn(), onDragging: vi.fn(), onUnavailable: vi.fn() });
    const target = g.selected!, pose = rotateSpatialPose(target.pose, center, "y", 1.1);
    const landing = g.resolve(target, pose, "rotate", { kind: "axis-rotation", axis: "y" });
    expect(apply).not.toHaveBeenCalled(); expect(landing.pose.position).toEqual(center);
    expect(new Quaternion(...landing.pose.quaternion).angleTo(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2))).toBeLessThan(1e-7);
    landing.apply(); expect(apply).toHaveBeenCalledTimes(1);
    g.resolve(target, target.pose, "translate", { kind: "plane", plane: "table" }).apply();
    g.resolve(target, target.pose, "rotate", { kind: "axis-rotation", axis: "y" }).apply();
    expect(apply).toHaveBeenCalledTimes(1);
    const transformed = spatialGizmoPoint({ target, pose, landing: landing.pose, valid: true, phase: "drag" }, { x: 3, y: 3, z: 4 });
    expect(transformed.x).toBeCloseTo(2 + Math.cos(1.1)); expect(transformed.z).toBeCloseTo(4 - Math.sin(1.1));
  });
  it("resolves the body actually picked, including an unselected object with hidden handles", () => {
    const apply = vi.fn(() => true), chosen = vi.fn(), center = { x: 4, y: 0.5, z: -2 }, point = { x: 4.2, y: 1, z: -1.8 };
    const translate = vi.fn((delta) => ({ delta, valid: true, apply }));
    const g = spatialGizmoInteraction({ key: {}, selectedId: "first", mode: "rotate", enabled: true, showHandles: false,
      objectFor: (id) => id === "second" ? { id, center, radius: 1, translate } : { id, center: { x: 0, y: 0.5, z: 0 }, radius: 1, translate: () => { throw Error("wrong object"); } },
      pick: () => ({ id: "second", point }), onSelect: chosen, onPreview: vi.fn(), onDragging: vi.fn(), onUnavailable: vi.fn() });
    expect(g.handles).toBeUndefined(); expect(g.plane).toBe("table"); expect(g.freeRotation).toBe(false);
    const target = g.pick(new Raycaster())!;
    expect(target.pose.id).toBe("second"); expect(target.grabPoint).toEqual(point);
    const moved = { ...target.pose, position: { x: 4.31, y: 0.5, z: -1.73 } };
    const landing = g.resolve(target, moved, "translate");
    expect(translate.mock.calls[0][0].x).toBeCloseTo(0.31); expect(translate.mock.calls[0][0].z).toBeCloseTo(0.27);
    expect(landing.pose).toEqual(moved); expect(apply).not.toHaveBeenCalled();
    landing.apply(); expect(apply).toHaveBeenCalledTimes(1);
    expect(g.resolve(target, moved, "rotate").valid).toBe(false);
  });
  it("applies both plane axes atomically using replayable existing operations", () => {
    const session = startCubeRecording(createCubeSession([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]));
    const operations = cubePlaneOperations(cubeSessionScene(session), ["cube-1"], "move", { x: 1, y: 1, z: 0 })!;
    expect(operations.map((op) => op.axis)).toEqual(["y", "x"]);
    const next = operateCubeSessionBatch(session, operations);
    expect(cubeSessionScene(next).cubes[0].position).toEqual({ x: 1, y: 1, z: 0 });
    expect(replayCubeHistory(next.lesson!)).toEqual(cubeSessionScene(next));
    expect(cubeSessionScene(session).cubes[0].position).toEqual({ x: 0, y: 0, z: 0 });
    expect(operateCubeSessionBatch(session, [{ kind: "move", ids: ["cube-1"], axis: "y", distance: 1 }, { kind: "move", ids: ["cube-1"], axis: "y", distance: -1 }, { kind: "move", ids: ["cube-1"], axis: "x", distance: 1 }])).toBe(session);
    const full = { ...session, lesson: { ...session.lesson!, cursor: CUBE_STRUCTURES_LIMITS.steps - 1 } };
    expect(operateCubeSessionBatch(full, operations)).toBe(full);
  });
});
