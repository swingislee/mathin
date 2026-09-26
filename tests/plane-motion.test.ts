import { describe, expect, it } from "vitest";
import { polygonArea } from "../src/features/tools/planar-interaction/geometry";
import { foldCutHoles, footOnAxis, generatedPattern, reflectedPoint, reflectionFrame, reflectionRoute, rollingCircle, rotationFrame, snapPieceToVertices, translationFrame } from "../src/features/tools/plane-motion/model";

const shape = [{ x: 10, y: 10 }, { x: 60, y: 10 }, { x: 60, y: 40 }, { x: 10, y: 40 }];
describe("plane motion mathematical endpoints", () => {
  it("moves all corresponding points by the same vector, including a paused intermediate frame", () => {
    const middle = translationFrame(shape, { x: 100, y: -30 }, 0.4);
    expect(middle[0]).toEqual({ x: 50, y: -2 });
    expect(polygonArea(middle)).toBe(polygonArea(shape));
    expect(translationFrame(shape, { x: 100, y: -30 }, 1)[0]).toEqual({ x: 110, y: -20 });
  });
  it("rotates rigidly around an outside center, with exact 90 degree endpoint", () => {
    const pivot = { x: -20, y: 0 }, halfway = rotationFrame(shape, pivot, 90, 0.5);
    for (let index = 0; index < shape.length; index++) expect(Math.hypot(halfway[index].x - pivot.x, halfway[index].y - pivot.y)).toBeCloseTo(Math.hypot(shape[index].x - pivot.x, shape[index].y - pivot.y));
    expect(polygonArea(halfway)).toBeCloseTo(1500);
    expect(rotationFrame([{ x: 1, y: 0 }], { x: 0, y: 0 }, 90, 1)[0].y).toBeCloseTo(1);
  });
  it("folds through edge-on projection and finishes at true reflection around any axis", () => {
    const axis = { point: { x: 20, y: 25 }, angle: 32 };
    const halfway = reflectionFrame(shape, axis, 0.5), finish = reflectionFrame(shape, axis, 1);
    halfway.forEach((point, index) => { expect(point.x).toBeCloseTo(footOnAxis(shape[index], axis).x); expect(point.y).toBeCloseTo(footOnAxis(shape[index], axis).y); });
    finish.forEach((point, index) => expect(point).toEqual(reflectedPoint(shape[index], axis)));
    expect(polygonArea(finish)).toBeCloseTo(polygonArea(shape));
  });
  it("keeps reflection-route lengths equal without choosing the teacher's touch point", () => {
    const route = reflectionRoute({ x: 0, y: -3 }, { x: 6, y: -4 }, { point: { x: 0, y: 0 }, angle: 0 }, 1);
    expect(route.contact).toEqual({ x: 1, y: 0 });
    expect(route.length).toBeCloseTo(route.reflectedLength);
  });
  it("distinguishes orbit and spin for external and internal rolling", () => {
    const outside = rollingCircle(120, 40, 360, false), inside = rollingCircle(120, 40, 360, true);
    expect(outside.rotation).toBe(1440); expect(inside.rotation).toBe(-720);
    expect(outside.orbitRadius).toBe(160); expect(inside.orbitRadius).toBe(80);
    expect(outside.marker.x).toBeCloseTo(120); expect(inside.marker.x).toBeCloseTo(120);
    expect(() => rollingCircle(40, 40, 1, true)).toThrow();
  });
  it("has zero instantaneous contact velocity for both rolling types", () => {
    for (const inside of [true, false]) {
      const pose = rollingCircle(120, 40, 43, inside), angle = 43 * Math.PI / 180;
      const centerVelocity = { x: -pose.orbitRadius * Math.sin(angle), y: pose.orbitRadius * Math.cos(angle) };
      const radial = { x: pose.contact.x - pose.center.x, y: pose.contact.y - pose.center.y };
      const angularVelocity = (inside ? -1 : 1) * pose.orbitRadius / 40;
      expect(centerVelocity.x - angularVelocity * radial.y).toBeCloseTo(0);
      expect(centerVelocity.y + angularVelocity * radial.x).toBeCloseTo(0);
    }
  });
  it("mirrors cut holes across each actual fold and does not interpolate the final copy shape", () => {
    expect(foldCutHoles({ x: 4, y: 3 }, { point: { x: 0, y: 0 }, angle: 90 }, true)).toHaveLength(4);
    const pattern = generatedPattern(shape, { x: 0, y: 0 }, 6, 1);
    expect(pattern).toHaveLength(6); pattern.forEach((points) => expect(polygonArea(points)).toBeCloseTo(1500));
  });
  it("snaps by an existing material vertex without resizing a piece", () => {
    const moving = { id: "a", points: shape, offset: { x: 2, y: 0 }, angle: 0 }, fixed = { ...moving, id: "b", offset: { x: 0, y: 0 } };
    expect(snapPieceToVertices(moving, [fixed]).offset).toEqual({ x: 0, y: 0 });
  });
});
