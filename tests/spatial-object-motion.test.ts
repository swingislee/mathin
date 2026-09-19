import { describe, expect, it } from "vitest";
import { BoxGeometry, Euler, Group, Mesh, MeshBasicMaterial, Quaternion, Raycaster, Vector3 } from "three";
import { interpolateRigidPoses, spatialQuarterTurn } from "@/features/tools/spatial-interaction/rigid-motion";
import { pickSpatialObject } from "@/features/tools/spatial-interaction/picking";
import { spatialDirectManipulation } from "@/features/tools/spatial-interaction/policy";
import { somaRigidPoses } from "@/features/tools/soma-cube/motion";
import { SOMA_IDS, SOMA_ROTATIONS, somaCells, somaDefinition, somaTurn } from "@/features/tools/soma-cube/pieces";

describe("shared spatial object actions", () => {
  it("keeps object manipulation in normal observation and leaves specialist gestures to their tools", () => {
    for (const tool of ["orbit", "move"]) expect(spatialDirectManipulation(tool)).toBe(true);
    for (const tool of ["pan", "fold", "cut", "section", "face", "color", "xray", "pips"]) expect(spatialDirectManipulation(tool)).toBe(false);
  });
  it("uses the visible scaled and rotated mesh, not a unit-cube proxy", () => {
    const scene = new Group(), object = new Group(); object.userData.spatialObjectId = "solid";
    const mesh = new Mesh(new BoxGeometry(6, 2, 2), new MeshBasicMaterial());
    object.add(mesh); object.rotation.y = Math.PI / 2; scene.add(object); scene.updateMatrixWorld(true);
    const ray = new Raycaster(new Vector3(5, 0, 2), new Vector3(-1, 0, 0));
    expect(pickSpatialObject(ray, scene)).toBe("solid");
    object.visible = false; expect(pickSpatialObject(ray, scene)).toBeNull();
    mesh.geometry.dispose(); mesh.material.dispose();
  });
  it("rotates about a world axis even after previous turns on other axes", () => {
    const before = { x: 0.43, y: 0.71, z: -0.24 };
    const after = spatialQuarterTurn(before, "y", 1);
    const actual = new Quaternion().setFromEuler(new Euler(after.x, after.y, after.z));
    const expected = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2).multiply(new Quaternion().setFromEuler(new Euler(before.x, before.y, before.z)));
    expect(actual.angleTo(expected)).toBeLessThan(1e-7);
  });
  it("all 7 × 24 Soma orientations preserve exact v1 cells in the shared rigid renderer", () => {
    for (const id of SOMA_IDS) for (let orientation = 0; orientation < SOMA_ROTATIONS.length; orientation++) {
      const piece = { id, orientation, position: { x: 3, y: 4, z: -2 } }, pose = somaRigidPoses([piece])[0];
      const expected = somaCells(piece);
      somaDefinition(id).cells.forEach((cell, index) => {
        const actual = new Vector3(cell.x, cell.y, cell.z).applyQuaternion(new Quaternion(...pose.quaternion)).add(new Vector3(pose.position.x, pose.position.y, pose.position.z));
        expect(actual.distanceTo(new Vector3(expected[index].x, expected[index].y, expected[index].z))).toBeLessThan(1e-7);
      });
    }
  });
  it("Soma quarter turns, undo and redo keep every pairwise distance at every intermediate frame", () => {
    for (const id of SOMA_IDS) for (const axis of ["x", "y", "z"] as const) for (const turn of [-1, 1] as const) {
      const piece = { id, orientation: 5, position: { x: 1, y: 3, z: 2 } };
      const from = somaRigidPoses([piece]), to = somaRigidPoses([{ ...piece, orientation: somaTurn(piece.orientation, axis, turn) }]);
      for (const [start, end] of [[from, to], [to, from]]) for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const pose = interpolateRigidPoses(start, end, t)[0];
        const cells = somaDefinition(id).cells.map((p) => new Vector3(p.x, p.y, p.z));
        const actual = cells.map((p) => p.clone().applyQuaternion(new Quaternion(...pose.quaternion)).add(new Vector3(pose.position.x, pose.position.y, pose.position.z)));
        actual.forEach((a, i) => actual.forEach((b, j) => expect(a.distanceTo(b)).toBeCloseTo(cells[i].distanceTo(cells[j]), 10)));
      }
      expect(interpolateRigidPoses(from, to, 1)).toEqual(to);
      const halfway = new Quaternion(...interpolateRigidPoses(from, to, 0.5)[0].quaternion);
      expect(halfway.angleTo(new Quaternion(...from[0].quaternion))).toBeCloseTo(Math.PI / 4);
      expect(halfway.angleTo(new Quaternion(...to[0].quaternion))).toBeCloseTo(Math.PI / 4);
    }
  });
});
