import { BufferAttribute, BufferGeometry } from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export const DICE_CORNER_RADIUS = 0.085;
export const DICE_UV_LENGTH = 1 - 2 * DICE_CORNER_RADIUS + Math.PI * DICE_CORNER_RADIUS;

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
