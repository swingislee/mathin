import { describe, expect, it } from "vitest";
import {
  interpolateVoxelCameraPose,
  snapVoxelCameraPoseToPrincipalAxis,
  voxelCameraTransitionProgress,
  type VoxelCameraPose,
} from "@/features/spatial-math/renderer-r3f/voxel-camera-transition";
import {
  VOXEL_EDGE_COLOR,
  VOXEL_EDGE_LENGTH,
  VOXEL_EDGE_THICKNESS,
  VOXEL_SOLID_SIZE,
  buildVoxelEdgeInstances,
} from "@/features/spatial-math/renderer-r3f/voxel-visual-model";

function distance(pose: VoxelCameraPose): number {
  return Math.hypot(
    pose.position.x - pose.target.x,
    pose.position.y - pose.target.y,
    pose.position.z - pose.target.z,
  );
}

describe("voxel solid visual and camera transition", () => {
  it("uses exact unit solids and dark, visibly thick edge bars", () => {
    expect(VOXEL_SOLID_SIZE).toBe(1);
    expect(VOXEL_EDGE_THICKNESS).toBeGreaterThanOrEqual(0.05);
    expect(VOXEL_EDGE_THICKNESS).toBeLessThan(0.1);
    expect(VOXEL_EDGE_LENGTH).toBeGreaterThan(VOXEL_SOLID_SIZE);
    expect(VOXEL_EDGE_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("builds twelve edges for one cube and de-duplicates shared bars", () => {
    const single = buildVoxelEdgeInstances([{ x: 0, y: 0, z: 0 }]);
    expect(single.x).toHaveLength(4);
    expect(single.y).toHaveLength(4);
    expect(single.z).toHaveLength(4);

    const adjacent = buildVoxelEdgeInstances([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ]);
    expect(adjacent.x).toHaveLength(8);
    expect(adjacent.y).toHaveLength(6);
    expect(adjacent.z).toHaveLength(6);
    expect(new Set([...adjacent.x, ...adjacent.y, ...adjacent.z].map((edge) => edge.key)).size)
      .toBe(20);
  });

  it("eases deterministically and preserves exact endpoints", () => {
    expect(voxelCameraTransitionProgress(0, 720)).toBe(0);
    expect(voxelCameraTransitionProgress(360, 720)).toBe(0.5);
    expect(voxelCameraTransitionProgress(720, 720)).toBe(1);
    expect(voxelCameraTransitionProgress(1_000, 720)).toBe(1);
    expect(() => voxelCameraTransitionProgress(-1, 720)).toThrow();
  });

  it("moves on a spherical orbit between authored views instead of cutting through the solid", () => {
    const front: VoxelCameraPose = {
      position: { x: 0, y: 0, z: 10 },
      target: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
    };
    const right: VoxelCameraPose = {
      position: { x: 10, y: 0, z: 0 },
      target: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
    };
    const midpoint = interpolateVoxelCameraPose(front, right, 0.5);

    expect(interpolateVoxelCameraPose(front, right, 0)).toEqual(front);
    expect(interpolateVoxelCameraPose(front, right, 1)).toEqual(right);
    expect(midpoint.position.x).toBeCloseTo(Math.SQRT1_2 * 10, 8);
    expect(midpoint.position.z).toBeCloseTo(Math.SQRT1_2 * 10, 8);
    expect(distance(midpoint)).toBeCloseTo(10, 8);
    expect(midpoint.position).not.toEqual({ x: 5, y: 0, z: 5 });
  });

  it("snaps a near-front manual orbit to an exact principal axis", () => {
    const fiveDegrees = Math.PI / 36;
    const nearFront: VoxelCameraPose = {
      position: { x: Math.sin(fiveDegrees) * 10, y: 0, z: Math.cos(fiveDegrees) * 10 },
      target: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
    };

    expect(snapVoxelCameraPoseToPrincipalAxis(nearFront)).toEqual({
      position: { x: 0, y: 0, z: 10 },
      target: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
    });
    expect(snapVoxelCameraPoseToPrincipalAxis({
      ...nearFront,
      position: { x: Math.sin(Math.PI / 6) * 10, y: 0, z: Math.cos(Math.PI / 6) * 10 },
    })).toBeNull();
  });
});
