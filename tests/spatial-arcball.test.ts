import { describe, expect, it } from "vitest";
import { OrthographicCamera, PerspectiveCamera, Quaternion, Ray, Vector3 } from "three";
import { spatialArcball, spatialArcballRotation } from "@/features/tools/spatial-interaction/arcball";
import { spatialPickRigidCells, spatialRigidPoint } from "@/features/tools/spatial-interaction/rigid-geometry";
import type { SpatialRigidPose } from "@/features/tools/spatial-interaction/rigid-motion";

const viewport = { left: 30, top: 20, width: 800, height: 600 };
const pivot = { x: 1, y: 2, z: -1 };
function camera(perspective = false) {
  const c = perspective ? new PerspectiveCamera(40, 4 / 3, 0.1, 100) : new OrthographicCamera(-4, 4, 3, -3, 0.1, 100);
  c.position.set(6, 8, 10); c.lookAt(pivot.x, pivot.y, pivot.z); c.updateMatrixWorld(); return c;
}
const source: SpatialRigidPose = { id: "arbitrary", position: { x: 0.3, y: 1.5, z: -0.7 }, quaternion: new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), 0.57).toArray() };
const close = (a: SpatialRigidPose, b: SpatialRigidPose) => {
  expect(new Quaternion(...a.quaternion).angleTo(new Quaternion(...b.quaternion))).toBeLessThan(1e-7);
  expect(Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y, a.position.z - b.position.z)).toBeLessThan(1e-8);
};
describe("shared free Arcball", () => {
  it.each([false, true])("scales by projected object size, including camera zoom; perspective=%s", (perspective) => {
    const c = camera(perspective), first = spatialArcball(pivot, 1, c, viewport);
    const drag = (ball: typeof first) => spatialArcballRotation(source, pivot, ball.center, { x: ball.center.x + ball.radius * 0.6, y: ball.center.y + ball.radius * 0.2 }, ball);
    const expected = drag(first);
    c.zoom = 2; c.updateProjectionMatrix(); const zoomed = spatialArcball(pivot, 1, c, viewport);
    expect(zoomed.radius).toBeCloseTo(first.radius * 2); close(drag(zoomed), expected);
    close(drag(spatialArcball(pivot, 2, c, viewport)), expected);
  });
  it("uses the starting grab point, preserving a stable pivot and arbitrary initial pose", () => {
    const c = camera(), ball = spatialArcball(pivot, 1.5, c, viewport), start = ball.center;
    const end = { x: start.x + 70, y: start.y + 25 };
    const rotated = spatialArcballRotation(source, pivot, start, end, ball);
    const edgeStart = { x: start.x, y: start.y - ball.radius * 0.8 };
    const edge = spatialArcballRotation(source, pivot, edgeStart, { x: edgeStart.x + 70, y: edgeStart.y + 25 }, ball);
    expect(new Quaternion(...rotated.quaternion).angleTo(new Quaternion(...edge.quaternion))).toBeGreaterThan(0.1);
    const localPivot = new Vector3(pivot.x - source.position.x, pivot.y - source.position.y, pivot.z - source.position.z).applyQuaternion(new Quaternion(...source.quaternion).invert());
    const p = spatialRigidPoint(localPivot, rotated);
    expect(Math.hypot(p.x - pivot.x, p.y - pivot.y, p.z - pivot.z)).toBeLessThan(1e-8);
    close(spatialArcballRotation(source, pivot, start, start, ball), source);
    close(spatialArcballRotation(rotated, pivot, end, start, ball), source);
  });
  it("supports screen-normal twist at the rim without coupling to world Y", () => {
    const c = camera(), ball = spatialArcball(pivot, 1.5, c, viewport), a = ball.center;
    const end = { x: a.x + ball.radius * Math.SQRT1_2, y: a.y - ball.radius * Math.SQRT1_2 };
    const rotated = spatialArcballRotation(source, pivot, { x: a.x + ball.radius, y: a.y }, end, ball);
    const delta = new Quaternion(...rotated.quaternion).multiply(new Quaternion(...source.quaternion).invert());
    const normal = new Vector3(0, 0, 1).applyQuaternion(c.quaternion);
    expect(delta.angleTo(new Quaternion().setFromAxisAngle(normal, Math.PI / 2))).toBeLessThan(1e-7);
  });
  it("does not accumulate event-rate drift or modify its inputs", () => {
    const ball = spatialArcball(pivot, 1, camera(), viewport), before = structuredClone(source), start = ball.center;
    const end = { x: start.x + ball.radius * 0.5, y: start.y + ball.radius * 0.4 };
    for (let i = 0; i < 120; i++) spatialArcballRotation(source, pivot, start, { x: start.x + i, y: start.y - i }, ball);
    close(spatialArcballRotation(source, pivot, start, end, ball), spatialArcballRotation(before, pivot, start, end, ball));
    expect(source).toEqual(before);
  });
  it("picks a rotated solid in local geometry and passes its empty AABB corner through", () => {
    const pose: SpatialRigidPose = { id: "box", position: { x: 0, y: 0, z: 0 }, quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 4).toArray() };
    const cells = [{ x: 0, y: 0, z: 0 }];
    expect(spatialPickRigidCells(new Ray(new Vector3(0.65, 0, 4), new Vector3(0, 0, -1)), pose, cells)?.point.x).toBeCloseTo(0.65);
    expect(spatialPickRigidCells(new Ray(new Vector3(0.6, 0.6, 4), new Vector3(0, 0, -1)), pose, cells)).toBeNull();
  });
});
