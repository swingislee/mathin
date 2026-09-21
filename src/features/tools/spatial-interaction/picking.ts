import { Mesh, type Object3D, type Raycaster, type Material } from "three";

/** 复用画面中的真实网格：尺寸、转角和移面之后仍以看到的表面为准。 */
export function pickSpatialObjectHit(raycaster: Raycaster, scene: Object3D): { id: string; point: { x: number; y: number; z: number } } | null {
  for (const hit of raycaster.intersectObject(scene, true)) {
    let object: Object3D | null = hit.object, id: string | null = null, visible = true;
    while (object) {
      visible &&= object.visible;
      if (typeof object.userData.spatialObjectId === "string") id = object.userData.spatialObjectId;
      object = object.parent;
    }
    if (!visible || !id || !(hit.object instanceof Mesh)) continue;
    const material = (Array.isArray(hit.object.material) ? hit.object.material[hit.face?.materialIndex ?? 0] : hit.object.material) as Material;
    if (!material.visible || material.opacity < 0.02 || material.clippingPlanes?.some((plane) => plane.distanceToPoint(hit.point) < -1e-7)) continue;
    return { id, point: { x: hit.point.x, y: hit.point.y, z: hit.point.z } };
  }
  return null;
}

export function pickSpatialObject(raycaster: Raycaster, scene: Object3D): string | null {
  return pickSpatialObjectHit(raycaster, scene)?.id ?? null;
}
