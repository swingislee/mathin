import { describe, expect, it, vi } from "vitest";
import { Quaternion, Vector3 } from "three";
import { SOMA_VERSION, SOMA_LEGACY_VERSION, somaLegacyToolSchema, somaSnapshotSchema, somaToolSchema } from "@/features/tools/soma-cube/contract";
import { createSomaInitial, somaAlignToGrid, somaLocalCenter, somaMove, somaRoll, somaRotate, somaRotationPivot, somaCubeState, somaRenderModel } from "@/features/tools/soma-cube/model";
import { somaGestureLanding } from "@/features/tools/soma-cube/manipulation";
import { somaPose, somaCells, somaPlacementValid, type SomaFreePiece } from "@/features/tools/soma-cube/pieces";
import { spatialRigidPoint } from "@/features/tools/spatial-interaction/rigid-geometry";
import { freezeToolScene, parseToolScene } from "@/features/tools/scenes/contract";
import { createClassroomToolState, coursewareToolOriginHash, parseClassroomToolState } from "@/features/tools/courseware/tool-classroom";

const initial = () => ({ ...createSomaInitial(), pieces: [{ id: "bao-1" as const, orientation: 0, position: { x: 0, y: 3, z: 0 } }] });
function freeState() {
  const state = initial(), piece = state.pieces[0], pivot = somaRotationPivot(piece, true);
  const quaternion = new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), 0.67).toArray();
  const offset = spatialRigidPoint(somaLocalCenter(piece.id), { id: piece.id, position: { x: 0, y: 0, z: 0 }, quaternion });
  return somaGestureLanding(state, piece.id, { id: piece.id, quaternion, position: { x: pivot.x - offset.x, y: pivot.y - offset.y, z: pivot.z - offset.z } }, "rotate", true).snapshot;
}
describe("versioned Soma free poses", () => {
  it("persists arbitrary angles, with explicit alignment and exact quarter-turn controls", () => {
    const source = initial(), state = freeState();
    expect(somaSnapshotSchema.safeParse(state).success).toBe(true);
    expect(state.pieces[0].orientation).toBeUndefined(); expect(state.pieces[0].quaternion).toBeDefined();
    const pivot = somaRotationPivot(state.pieces[0], true);
    let turned = state;
    for (let i = 0; i < 4; i++) turned = somaRotate(turned, "x", 1, true)!;
    expect(new Quaternion(...somaPose(turned.pieces[0]).quaternion).angleTo(new Quaternion(...somaPose(state.pieces[0]).quaternion))).toBeLessThan(1e-7);
    const nextPivot = somaRotationPivot(turned.pieces[0], true);
    expect(Math.hypot(nextPivot.x - pivot.x, nextPivot.y - pivot.y, nextPivot.z - pivot.z)).toBeLessThan(1e-8);
    expect(somaRoll(state, "x+")).toBeNull();
    const aligned = somaAlignToGrid(state)!; expect(aligned.pieces[0].quaternion).toBeUndefined();
    expect(aligned.pieces[0].orientation).toBeDefined(); expect(somaPlacementValid(aligned.pieces)).toBe(true);
    expect(source).toEqual(initial());
    expect(() => somaRenderModel(somaCubeState(state.pieces), state, "Soma")).not.toThrow();
  });
  it("keeps relative whole-unit movement without snapping an existing free angle or fractional origin", () => {
    const state = freeState(), source = state.pieces[0], pose = somaPose(source);
    const landing = somaGestureLanding(state, source.id, { ...pose, position: { ...pose.position, x: pose.position.x + 1.2, z: pose.position.z - 0.6 } }, "translate", true);
    expect(landing.valid).toBe(true); expect(landing.snapshot.pieces[0].quaternion).toEqual(source.quaternion);
    expect(landing.pose.position.x).toBeCloseTo(pose.position.x + 1); expect(landing.pose.position.z).toBeCloseTo(pose.position.z - 1);
    expect(somaMove(state, source.id, "y", 1)?.pieces[0].position.y).toBeCloseTo(source.position.y + 1);
  });
  it("validates rotated geometry, unit quaternions, bounds and mutually exclusive pose formats", () => {
    const state = freeState(), piece = state.pieces[0] as SomaFreePiece;
    for (const invalid of [
      { ...piece, quaternion: [0, 0, 0, 0] }, { ...piece, quaternion: [NaN, 0, 0, 1] },
      { ...piece, orientation: 0 }, { ...piece, quaternion: [0, 0, 0, 2] },
      { ...piece, position: { x: 12, y: 12, z: 12 } },
    ]) expect(somaSnapshotSchema.safeParse({ ...state, pieces: [invalid] }).success).toBe(false);
    expect(somaSnapshotSchema.safeParse({ ...state, pieces: [piece, { ...piece, id: "bao-2" }] }).success).toBe(false);
    const upright: SomaFreePiece = { id: "bao-1", position: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] };
    expect(somaPlacementValid([upright, { id: "bao-2", orientation: 0, position: { x: 1, y: 0, z: 0 } }])).toBe(true);
    const tilted = somaRotate({ ...initial(), pieces: [upright] }, "z", 1, true)!;
    expect(somaPlacementValid(tilted.pieces)).toBe(true); // 自由空间的网格不是实体地板。
    expect(somaCells(piece)).toHaveLength(3);
  });
  it("freezes and replays v2 on HTTP while rejecting free poses under the legacy wire identity", () => {
    vi.stubGlobal("crypto", {});
    try {
      const legacy = somaLegacyToolSchema.parse({ toolId: "soma-cube", contentVersion: SOMA_LEGACY_VERSION, payload: { title: "Old", initial: initial() } });
      const scene = somaToolSchema.parse({ toolId: "soma-cube", contentVersion: SOMA_VERSION, payload: { title: "Free", initial: freeState() } });
      const frozen = freezeToolScene(scene), restored = parseToolScene(JSON.parse(JSON.stringify(frozen)));
      expect(restored).toEqual(scene); expect(parseToolScene(legacy)).toEqual(legacy);
      expect(() => parseToolScene({ ...scene, contentVersion: SOMA_LEGACY_VERSION })).toThrow();
      const event = createClassroomToolState("page", "doc", "soma", { toolId: "soma-cube", contentVersion: SOMA_VERSION, state: scene.payload.initial }, coursewareToolOriginHash(scene.payload));
      expect(parseClassroomToolState(JSON.parse(JSON.stringify(event)))?.state).toEqual(scene.payload.initial);
      expect(parseClassroomToolState({ ...event, contentVersion: SOMA_LEGACY_VERSION })).toBeNull();
      expect(legacy.payload.initial).toEqual(initial());
    } finally { vi.unstubAllGlobals(); }
  });
});
