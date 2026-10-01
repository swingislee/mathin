import { Quaternion, Vector3 } from "three";

type Point = [number, number, number];
export interface SpatialOutlineBox {
  position: Point;
  size: Point;
  rotation?: [number, number, number, number];
}

/** 按展示盒尺寸生成十二条棱边，便于统一维护整圈边框的颜色和粗细。 */
export function spatialBoxEdgePoints(boxes: readonly SpatialOutlineBox[], padding = 0): Point[] {
  return boxes.flatMap((box) => {
    const half = box.size.map((size) => size / 2 + padding), points: Point[] = [];
    const rotation = new Quaternion(...(box.rotation ?? [0, 0, 0, 1]));
    for (let axis = 0; axis < 3; axis++) for (const first of [-1, 1]) for (const second of [-1, 1]) {
      for (const end of [-1, 1]) {
        const point = new Vector3().setComponent(axis, end * half[axis])
          .setComponent((axis + 1) % 3, first * half[(axis + 1) % 3]).setComponent((axis + 2) % 3, second * half[(axis + 2) % 3])
          .applyQuaternion(rotation).add(new Vector3(...box.position));
        points.push(point.toArray() as Point);
      }
    }
    return points;
  });
}
