import { describe, expect, it } from "vitest";
import { DoubleSide, Group, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { createSolidEntity } from "@/features/tools/solid-geometry/solid-geometry-contract";
import { createSolidCut, createSolidGeometryExplorationInitial, solidCutPieceId, solidExplorationObjects, solidMeshTopology } from "@/features/tools/solid-geometry/exploration-contract";
import { solidFaceGeometry } from "@/features/tools/solid-geometry/SolidGeometryScene";
import { pickSpatialObjectHit } from "@/features/tools/spatial-interaction/picking";

describe("closed cut pieces use the shared mesh-hit path", () => {
  it("hits the actual cut face and does not let an old cuboid bounding mesh intercept the empty half", () => {
    const source = createSolidEntity("cube", "source", { x: 0, y: 0, z: 0 }), cut = createSolidCut(source, { normal: { x: 1, y: 0, z: 0 }, distance: 0 })!;
    const objects = solidExplorationObjects({ ...createSolidGeometryExplorationInitial(), entities: [source], cuts: [cut] });
    const piece = objects.entities[0], mesh = objects.meshes.get(piece.id)!, scene = new Group(), group = new Group();
    group.userData.spatialObjectId = piece.id; group.position.set(piece.position.x, piece.position.y, piece.position.z); scene.add(group);
    const material = new MeshBasicMaterial({ side: DoubleSide });
    const geometries = solidMeshTopology(mesh).faces.map(solidFaceGeometry);
    for (const geometry of geometries) group.add(new Mesh(geometry, material)); scene.updateMatrixWorld(true);
    const capHit = pickSpatialObjectHit(new Raycaster(new Vector3(-3, 0, 0), new Vector3(1, 0, 0)), scene);
    expect(capHit?.id).toBe(solidCutPieceId(cut, 0)); expect(capHit?.point.x).toBeCloseTo(0, 9);
    // 原立方体左半部已不存在，这条射线不能命中隐藏源或代理包围盒。
    expect(pickSpatialObjectHit(new Raycaster(new Vector3(-0.5, 3, 0), new Vector3(0, -1, 0)), scene)).toBeNull();
    expect(pickSpatialObjectHit(new Raycaster(new Vector3(0.5, 3, 0), new Vector3(0, -1, 0)), scene)?.id).toBe(piece.id);
    group.visible = false; expect(pickSpatialObjectHit(new Raycaster(new Vector3(0.5, 3, 0), new Vector3(0, -1, 0)), scene)).toBeNull();
    geometries.forEach((geometry) => geometry.dispose()); material.dispose();
  });
});
