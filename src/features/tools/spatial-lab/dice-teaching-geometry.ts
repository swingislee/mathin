import { BufferAttribute, BufferGeometry, Vector3 } from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { FACE_NORMALS, diceFaceTranslation, quaternion, vector, type DiceFace, type TeachingDie } from "./dice-teaching-model";

export const DICE_CORNER_RADIUS = 0.085;
export const DICE_UV_LENGTH = 1 - 2 * DICE_CORNER_RADIUS + Math.PI * DICE_CORNER_RADIUS;

/** 面的世界坐标轮廓；移面前后的四角使用相同刚体变换。 */
export function diceFaceCorners(die: TeachingDie, face: DiceFace, moved = true): Vector3[] {
  const normal = vector(FACE_NORMALS[face]);
  const u = face[0] === "x" ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
  const v = normal.clone().cross(u);
  const translation = moved ? diceFaceTranslation(die, face) : new Vector3();
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => normal.clone().multiplyScalar(0.5)
    .addScaledVector(u, x * 0.5).addScaledVector(v, y * 0.5).add(translation)
    .applyQuaternion(quaternion(die.rotation)).add(vector(die.position)));
}

/** 保留 RoundedBox 的六个面组，可独立移面；合拢时正好拼回原圆角实体。 */
export function diceFaceGeometries(): BufferGeometry[] {
  const box = new RoundedBoxGeometry(1, 1, 1, 4, DICE_CORNER_RADIUS);
  const faces = box.groups.map((group) => {
    const face = new BufferGeometry();
    for (const name of ["position", "normal", "uv"]) {
      const attr = box.getAttribute(name);
      face.setAttribute(name, new BufferAttribute(new Float32Array(attr.array.slice(group.start * attr.itemSize, (group.start + group.count) * attr.itemSize)), attr.itemSize));
    }
    face.computeBoundingSphere();
    return face;
  });
  box.dispose();
  return faces;
}
