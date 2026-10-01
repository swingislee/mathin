import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { spatialBoxEdgePoints, type SpatialOutlineBox } from "@/features/spatial-math/renderer-r3f/spatial-box-outline";

describe("spatial box frame", () => {
  it("outlines all twelve edges at the box dimensions", () => {
    const box: SpatialOutlineBox = { position: [2, 3, 4], size: [1, 2, 10] }, original = structuredClone(box);
    const points = spatialBoxEdgePoints([box]);
    expect(points).toHaveLength(24);
    for (let axis = 0; axis < 3; axis++) {
      expect(Math.min(...points.map((point) => point[axis]))).toBeCloseTo(box.position[axis] - box.size[axis] / 2);
      expect(Math.max(...points.map((point) => point[axis]))).toBeCloseTo(box.position[axis] + box.size[axis] / 2);
    }
    const segments = Array.from({ length: 12 }, (_, index) => [points[2 * index].join(","), points[2 * index + 1].join(",")].sort().join("|"));
    expect(new Set(segments).size).toBe(12);
    expect(box).toEqual(original);
    expect(spatialBoxEdgePoints([])).toEqual([]);
  });

  it("follows the same local rotation as the box", () => {
    const rotation = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 3);
    const box: SpatialOutlineBox = { position: [-2, 8, -10], size: [2, 5, 9], rotation: rotation.toArray() as [number, number, number, number] };
    const points = spatialBoxEdgePoints([box]), local = spatialBoxEdgePoints([{ ...box, position: [0, 0, 0], rotation: undefined }]);
    points.forEach((point, index) => {
      const recovered = new Vector3(...point).sub(new Vector3(...box.position)).applyQuaternion(rotation.clone().invert());
      expect(recovered.distanceTo(new Vector3(...local[index]))).toBeLessThan(1e-9);
    });
  });
});
