import { describe, expect, it, vi } from "vitest";
import { Quaternion, Vector3 } from "three";
import { createDefaultSolidRevolutionInitial, solidRevolutionInitial, solidRevolutionInitialSchema, solidRevolutionSnapshot, solidRevolutionSnapshotSchema, solidRevolutionToolSchema } from "@/features/tools/solid-revolution/contract";
import { normalizeRevolutionAngle, pauseRevolution, planRevolution, resumeRevolution, revolutionAngleAt, revolutionDimensions, revolutionPlaying, revolutionPoint, revolutionProfile, revolutionSweepPositions, revolutionVolume } from "@/features/tools/solid-revolution/model";
import { revolutionGestureAngle } from "@/features/tools/solid-revolution/RevolutionInteraction";

const initial = createDefaultSolidRevolutionInitial();
function meshVolume(positions: number[]) {
  let total = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const a = new Vector3(...positions.slice(i, i + 3) as [number, number, number]);
    const b = new Vector3(...positions.slice(i + 3, i + 6) as [number, number, number]);
    const c = new Vector3(...positions.slice(i + 6, i + 9) as [number, number, number]);
    total += a.dot(b.cross(c)) / 6;
  }
  return total;
}
describe("revolution analytic geometry", () => {
  it("exchanges axis length and radius without changing either original paper edge", () => {
    expect(revolutionDimensions(initial)).toEqual({ radius: 2, height: 3 });
    expect(revolutionDimensions({ ...initial, axis: "width" })).toEqual({ radius: 3, height: 2 });
    expect(revolutionVolume(initial)).toBeCloseTo(12 * Math.PI);
    expect(revolutionVolume({ ...initial, axis: "width" })).toBeCloseTo(18 * Math.PI);
    expect(revolutionVolume({ ...initial, shape: "right-triangle" })).toBeCloseTo(4 * Math.PI);
  });
  it.each(["rectangle", "right-triangle"] as const)("%s renders a closed bounded swept solid at 90, 180 and 360 degrees", (shape) => {
    for (const axis of ["height", "width"] as const) for (const angle of [1, 45, 90, 180, 270, 360]) {
      const source = { ...initial, shape, axis }, points = revolutionSweepPositions(source, angle, 720), d = revolutionDimensions(source);
      expect(points.every(Number.isFinite)).toBe(true);
      const volume = meshVolume(points);
      expect(volume).toBeGreaterThan(0); expect(volume / revolutionVolume(source, angle)).toBeCloseTo(1, 4);
      for (let i = 0; i < points.length; i += 3) {
        expect(Math.hypot(points[i], points[i + 2])).toBeLessThanOrEqual(d.radius + 1e-10);
        expect(points[i + 1]).toBeGreaterThanOrEqual(0); expect(points[i + 1]).toBeLessThanOrEqual(d.height);
      }
    }
  });
  it("keeps the moving profile on the same rotation locus as the sweep boundary", () => {
    expect(revolutionSweepPositions(initial, 0)).toEqual([]);
    for (const angle of [0, 90, 180, 360]) {
      const profile = revolutionProfile(initial, angle), p = revolutionPoint(initial.width, 0, angle);
      expect(profile[1]).toEqual(p); expect(profile[0].x).toBeCloseTo(0); expect(profile[0].y).toBe(0); expect(profile[0].z).toBeCloseTo(0);
      expect(profile[3].y).toBe(initial.height);
    }
    expect(revolutionPoint(2, 0, 90).z).toBeCloseTo(-2);
    expect(revolutionPoint(2, 0, 180).x).toBeCloseTo(-2);
    expect(revolutionPoint(2, 0, 360).x).toBeCloseTo(2);
  });
  it("preserves one complete turn instead of shortening 360 degrees to zero", () => {
    const target = { id: "paper", position: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as [number, number, number, number] };
    for (const angle of [90, 180, 270, 359, 360]) {
      const pose = { ...target, quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle * Math.PI / 180).toArray() };
      expect(revolutionGestureAngle(0, target, pose)).toBeCloseTo(angle);
    }
    expect(normalizeRevolutionAngle(-30)).toBe(0); expect(normalizeRevolutionAngle(380)).toBe(360);
  });
});
describe("revolution prepared and authoritative classroom states", () => {
  it("stores a strict paused teaching start and rejects malformed runtime motion", () => {
    const state = solidRevolutionSnapshot(initial);
    expect(solidRevolutionInitial(state)).toEqual(initial);
    expect(solidRevolutionToolSchema.safeParse({ toolId: "solid-revolution", contentVersion: "solid-revolution-lesson-v1", payload: { title: "Turn", initial } }).success).toBe(true);
    for (const patch of [{ width: 0 }, { shape: "polygon" }, { axis: "slanted" }, { angle: 361 }, { speed: 10 }, { score: 3 }, { width: Infinity }]) expect(solidRevolutionInitialSchema.safeParse({ ...initial, ...patch }).success).toBe(false);
    const playing = resumeRevolution(state, 1000);
    expect(solidRevolutionSnapshotSchema.safeParse(playing).success).toBe(true);
    expect(solidRevolutionSnapshotSchema.safeParse({ ...playing, angle: 180 }).success).toBe(false);
    expect(solidRevolutionSnapshotSchema.safeParse({ ...playing, motion: { ...playing.motion, durationMs: 0 } }).success).toBe(false);
    expect(solidRevolutionInitialSchema.safeParse({ ...initial, motion: playing.motion }).success).toBe(false);
  });
  it("replays semantic time for late joins, pauses exactly and resumes without replaying the past", () => {
    const state = solidRevolutionSnapshot(initial), playing = resumeRevolution(state, 1000);
    expect(playing.motion?.durationMs).toBe(12000);
    expect(revolutionAngleAt(playing, 1000)).toBe(0);
    expect(revolutionAngleAt(playing, 4000)).toBe(90);
    expect(revolutionAngleAt(structuredClone(playing), 7000)).toBe(180);
    const paused = pauseRevolution(playing, 4750); expect(paused.angle).toBe(112.5); expect(paused.motion).toBeNull();
    expect(revolutionAngleAt(paused, 99999)).toBe(112.5);
    const resumed = resumeRevolution(paused, 9000); expect(resumed.motion?.fromAngle).toBe(112.5);
    expect(revolutionAngleAt(resumed, 12000)).toBe(202.5);
    expect(revolutionAngleAt(resumed, 30000)).toBe(360); expect(revolutionPlaying(resumed, 30000)).toBe(false);
    expect(solidRevolutionInitial(paused).angle).toBe(112.5);
  });
  it("supports bounded reverse animation and creates commands without secure-context randomUUID", () => {
    vi.stubGlobal("crypto", { getRandomValues: (values: Uint8Array) => { values.fill(1); return values; } });
    try {
      const full = { ...solidRevolutionSnapshot(initial), angle: 360 }, reverse = planRevolution(full, 0, 1000, 650);
      expect(solidRevolutionSnapshotSchema.safeParse(reverse).success).toBe(true);
      expect(revolutionAngleAt(reverse, 1325)).toBe(180); expect(revolutionAngleAt(reverse, 1650)).toBe(0);
      expect(revolutionPlaying(reverse, 1650)).toBe(false);
      expect(planRevolution(full, 360).motion).toBeNull();
    } finally { vi.unstubAllGlobals(); }
  });
});
