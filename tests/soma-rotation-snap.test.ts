import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { spatialRotationSnap, SPATIAL_ROTATION_SNAP_ANGLE } from "@/features/tools/spatial-interaction/rotation-snap";
import { spatialBasisQuaternion, type SpatialRigidPose } from "@/features/tools/spatial-interaction/rigid-motion";
import { createSomaInitial, somaLocalCenter, somaRotate, somaRotationPivot, somaRoll } from "@/features/tools/soma-cube/model";
import { somaGestureLanding } from "@/features/tools/soma-cube/manipulation";
import { SOMA_IDS, SOMA_ROTATIONS, somaPose, somaPlacementValid, type SomaGridPiece } from "@/features/tools/soma-cube/pieces";
import type { SomaSnapshot } from "@/features/tools/soma-cube/contract";

const candidates = SOMA_ROTATIONS.map(spatialBasisQuaternion);
const initial = (): SomaSnapshot => ({ ...createSomaInitial(), pieces: [{ id: "bao-1", orientation: 0, position: { x: 0, y: 3, z: 0 } }] });
function tilted(piece: SomaGridPiece, angle: number): SpatialRigidPose {
  const pose = somaPose(piece), center = somaRotationPivot(piece, true), local = somaLocalCenter(piece.id);
  const q = new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), angle).multiply(new Quaternion(...pose.quaternion));
  const offset = new Vector3(local.x, local.y, local.z).applyQuaternion(q);
  return { id: piece.id, quaternion: q.toArray(), position: { x: center.x - offset.x, y: center.y - offset.y, z: center.z - offset.z } };
}

describe("automatic rotation snapping", () => {
  it("shares angular proximity without treating every free angle as a snap target", () => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), SPATIAL_ROTATION_SNAP_ANGLE).toArray();
    expect(spatialRotationSnap(q, candidates)?.index).toBe(0);
    expect(spatialRotationSnap(q.map((value) => -value) as SpatialRigidPose["quaternion"], candidates)?.index).toBe(0);
    expect(spatialRotationSnap(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), SPATIAL_ROTATION_SNAP_ANGLE + 0.001).toArray(), candidates)).toBeNull();
    expect(spatialRotationSnap(q, [])).toBeNull();
  });
  it("lands near every one of the 24 orientations for each Bao, with no change to the source", () => {
    for (const id of SOMA_IDS) for (let orientation = 0; orientation < SOMA_ROTATIONS.length; orientation++) {
      const piece = { id, orientation, position: { x: 0, y: 3, z: 0 } }, snapshot = { ...initial(), selectedId: id, pieces: [piece] };
      const before = structuredClone(snapshot), landing = somaGestureLanding(snapshot, id, tilted(piece, 0.12), "rotate", true);
      expect(landing.snapped).toBe(true); expect(landing.valid).toBe(true);
      expect(landing.snapshot.pieces[0]).toEqual(piece); expect(snapshot).toEqual(before);
    }
  });
  it("retains far angles or explicitly disabled snapping, and does not alter approved translation", () => {
    const snapshot = initial(), piece = snapshot.pieces[0] as SomaGridPiece;
    for (const [angle, enabled] of [[0.62, true], [0.1, false]] as const) {
      const pose = tilted(piece, angle), landing = somaGestureLanding(snapshot, piece.id, pose, "rotate", true, enabled);
      expect(landing.snapped).toBe(false); expect(landing.valid).toBe(true);
      expect(new Quaternion(...landing.pose.quaternion).angleTo(new Quaternion(...pose.quaternion))).toBeLessThan(1e-7);
      expect(landing.pose.position).toEqual(pose.position);
    }
    const free = somaGestureLanding(snapshot, piece.id, tilted(piece, 0.1), "rotate", true, false);
    const moved = somaGestureLanding(free.snapshot, piece.id, { ...free.pose, position: { ...free.pose.position, x: free.pose.position.x + 1.2 } }, "translate", true);
    expect(moved.snapped).toBe(false); expect(moved.pose.quaternion).toEqual(free.pose.quaternion);
    expect(moved.pose.position.x).toBeCloseTo(free.pose.position.x + 1);
  });
  it("preserves a legal free endpoint when the nearest grid would collide, without moving another Bao", () => {
    const snapshot = initial(), pose = { id: "bao-1" as const, position: { x: 0.49, y: 3, z: 0 }, quaternion: [0, 0, 0, 1] as [number, number, number, number] };
    snapshot.pieces.push({ id: "bao-2", position: { x: -0.6, y: 3, z: 0 }, quaternion: [0, 0, 0, 1] });
    snapshot.pieces[0] = pose;
    expect(somaPlacementValid(snapshot.pieces)).toBe(true);
    const landing = somaGestureLanding(snapshot, "bao-1", pose, "rotate", true);
    expect(landing.valid).toBe(true); expect(landing.snapped).toBe(false); expect(landing.pose).toEqual(pose);
    expect(landing.snapshot.pieces[1]).toBe(snapshot.pieces[1]);
  });
  it("does not pull a free piece above the reference plane or accept an invalid free landing", () => {
    const snapshot = initial(), pose = somaPose(snapshot.pieces[0]);
    const below = somaGestureLanding(snapshot, "bao-1", { ...pose, position: { ...pose.position, y: -2 } }, "rotate", true);
    expect(below.snapped).toBe(false); expect(below.valid).toBe(true); expect(below.pose.position.y).toBe(-2);
    const outside = somaGestureLanding(snapshot, "bao-1", { ...pose, position: { ...pose.position, x: 20 } }, "rotate", true);
    expect(outside.snapped).toBe(false); expect(outside.valid).toBe(false);
  });
  it("precise quarter turns share automatic landing, remain rollable and do not drift over repeated cycles", () => {
    for (const id of SOMA_IDS) for (let orientation = 0; orientation < SOMA_ROTATIONS.length; orientation++) for (const axis of ["x", "y", "z"] as const) {
      const snapshot = { ...initial(), selectedId: id, pieces: [{ id, orientation, position: { x: 0, y: 3, z: 0 } }] };
      let next: SomaSnapshot = snapshot;
      for (let i = 0; i < 4; i++) {
        next = somaRotate(next, axis, 1, true)!;
        expect(next).not.toBeNull(); expect(next.pieces[0].quaternion).toBeUndefined();
      }
      expect(next.pieces).toEqual(snapshot.pieces);
    }
    const next = somaRotate(initial(), "y", 1, true)!;
    expect(somaRoll(next, "x+")).not.toBeNull();
    expect(somaRotate(initial(), "y", 1, true, false)!.pieces[0].quaternion).toBeDefined();
  });
});
