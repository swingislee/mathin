import { describe, expect, it } from "vitest";
import { OrthographicCamera, Vector3 } from "three";
import { createSpatialMovePlaneResolver, resolveSpatialMovePlane, spatialMoveBasis, spatialMoveDelta, spatialMoveProjection, spatialViewElevation } from "@/features/tools/spatial-interaction/object-gesture-math";

function cameraAt(elevation: number, azimuth = 0) {
  const camera = new OrthographicCamera(-5, 5, 3.75, -3.75, 0.1, 100), e = elevation * Math.PI / 180, a = azimuth * Math.PI / 180;
  camera.position.set(10 * Math.cos(e) * Math.sin(a), 10 * Math.sin(e), 10 * Math.cos(e) * Math.cos(a));
  camera.lookAt(0, 0, 0); camera.updateMatrixWorld(); return camera;
}
describe("table-biased automatic standard-plane selection", () => {
  it("prefers XZ in ordinary views, even when a vertical plane is geometrically nearer", () => {
    for (const pitch of [25, 35, 60, 90, -30, -90]) for (const yaw of [0, 40, 90, 160, 260]) {
      expect(resolveSpatialMovePlane("auto", cameraAt(pitch, yaw))).toBe("table");
      expect(spatialViewElevation(cameraAt(pitch, yaw))).toBeCloseTo(Math.abs(pitch));
    }
    expect(resolveSpatialMovePlane("auto", cameraAt(12, 15))).toBe("xy");
    expect(resolveSpatialMovePlane("auto", cameraAt(12, 75))).toBe("yz");
    expect(resolveSpatialMovePlane("auto", cameraAt(-12, 195))).toBe("xy");
  });
  it("supports a smaller low-view region and preserves explicit plane choices", () => {
    const camera = cameraAt(17, 0);
    expect(resolveSpatialMovePlane("auto", camera, 10)).toBe("table");
    expect(resolveSpatialMovePlane("auto", camera, 20)).toBe("xy");
    for (const plane of ["table", "xy", "yz"] as const) expect(resolveSpatialMovePlane(plane, camera, 30)).toBe(plane);
  });
  it("uses hysteresis at both pitch and azimuth boundaries without leaking between workbenches", () => {
    const resolve = createSpatialMovePlaneResolver(), other = createSpatialMovePlaneResolver();
    expect(resolve("auto", cameraAt(30))).toBe("table");
    expect(resolve("auto", cameraAt(19))).toBe("xy");
    expect(resolve("auto", cameraAt(22))).toBe("xy");
    expect(other("auto", cameraAt(22))).toBe("table");
    expect(resolve("auto", cameraAt(25))).toBe("table");
    expect(resolve("auto", cameraAt(10, 44))).toBe("xy");
    expect(resolve("auto", cameraAt(10, 46))).toBe("xy");
    expect(resolve("auto", cameraAt(10, 56))).toBe("yz");
    expect(resolve("auto", cameraAt(10, 44))).toBe("yz");
    expect(resolve("auto", cameraAt(10, 34))).toBe("xy");
    expect(resolve("auto", cameraAt(22), 30)).toBe("xy");
    expect(resolve("auto", cameraAt(22), 15)).toBe("table");
  });
  it("never moves along an oblique plane and keeps the displayed normal identical to the drag constraint", () => {
    const size = { left: 0, top: 0, width: 800, height: 600 }, point = { x: 400, y: 300 };
    for (const pitch of [0, 12, 25, 65]) for (const yaw of [0, 35, 55, 90, 160, 260]) {
      const camera = cameraAt(pitch, yaw), plane = resolveSpatialMovePlane("auto", camera), basis = spatialMoveBasis(plane);
      expect(Object.values(basis.normal).filter((component) => component !== 0)).toHaveLength(1);
      const projection = spatialMoveProjection(point, { x: 1, y: 2, z: 3 }, plane, camera, size)!;
      expect(projection.basis).toEqual(basis);
      const delta = spatialMoveDelta(projection, { x: 470, y: 265 }, camera, size)!;
      expect(new Vector3(delta.x, delta.y, delta.z).dot(projection.plane.normal)).toBeCloseTo(0);
      expect(delta[plane === "table" ? "y" : plane === "xy" ? "z" : "x"]).toBeCloseTo(0);
    }
  });
});
