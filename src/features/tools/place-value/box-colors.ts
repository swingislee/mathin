import type { PlaceValueGroup } from "./radix-contract";

/** 每个已压缩颜色区间占一个纹理像素，不按百万个原单位展开；动画继续引用原成员的颜色相位。 */
export function writePlaceValueBoxColors(groups: PlaceValueGroup[], data: Float32Array) {
  let offset = 0;
  const ranges: [number, number][] = [];
  for (const group of groups) {
    ranges.push([offset, group.length]);
    let end = 0;
    for (const span of group) {
      data[offset * 4] = end + span.count;
      data[offset * 4 + 1] = span.phase - end;
      end += span.count; offset++;
    }
  }
  return ranges;
}
