import type { PlaceValueSpan } from "./radix-contract";
import { rodUnitAt, rodUnitPosition, type PlaceValueRod } from "./radix-model";

export const PLACE_VALUE_CUBE_BUDGET = 2048;
export const isRedUnit = (id: number, red: PlaceValueSpan[]) => red.some((span) => id >= span.start && id < span.start + span.count);
/** 分格材质每个连续身份区间只画一个长方体；红色仅是表现覆盖，不改写原颜色。 */
export function placeValueRodSegments(rod: PlaceValueRod, red: PlaceValueSpan[], base: number) {
  let offset = 0;
  return rod.group.flatMap((span) => {
    const boundaries = new Set([0, span.count]);
    for (const mark of red) for (const edge of [mark.start, mark.start + mark.count]) if (edge > span.start && edge < span.start + span.count) boundaries.add(edge - span.start);
    const points = [...boundaries].sort((a, b) => a - b), origin = offset; offset += span.count;
    return points.slice(0, -1).map((start, i) => ({ start: span.start + start, count: points[i + 1] - start, phase: (span.phase + start) % base,
      offset: origin + start, red: isRedUnit(span.start + start, red) }));
  });
}
export function placeValueRenderPlan(rods: PlaceValueRod[], red: PlaceValueSpan[], base: number, budget = PLACE_VALUE_CUBE_BUDGET) {
  let used = 0;
  const cubes: { id: number; x: number; y: number; z: number; phase: number; red: boolean; rod: PlaceValueRod }[] = [];
  const detailed: PlaceValueRod[] = [], compact: PlaceValueRod[] = [];
  for (const rod of [...rods].sort((a, b) => a.length - b.length)) {
    if (used + rod.length > budget) { compact.push(rod); continue; }
    used += rod.length; detailed.push(rod);
    for (let i = 0; i < rod.length; i++) {
      const unit = rodUnitAt(rod, i);
      cubes.push({ ...unit, ...rodUnitPosition(rod, i), phase: unit.phase % base, red: isRedUnit(unit.id, red), rod });
    }
  }
  return { cubes, detailed, compact };
}
