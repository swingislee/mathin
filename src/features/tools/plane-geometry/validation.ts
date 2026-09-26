import type { PlanarState } from "../planar-kit/contract";
import { distance, simplePolygon } from "./model";

/** 本领域存档只承载可重建的数学状态；局部缩放、焦点与浏览器事件不在合同里。 */
export function isValidPlaneGeometryState(state: PlanarState): boolean {
  const number = (key: string, min: number, max: number, integer = false) => {
    const value = state.params[key];
    return Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));
  };
  const point = (key: string, minX = -10000, maxX = 10000, minY = -10000, maxY = 10000, integer = false) => {
    const value = state.points[key];
    return !!value && Number.isFinite(value.x) && Number.isFinite(value.y) && value.x >= minX && value.x <= maxX && value.y >= minY && value.y <= maxY && (!integer || (Number.isInteger(value.x) && Number.isInteger(value.y)));
  };
  if (!Object.values(state.points).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) <= 10000 && Math.abs(p.y) <= 10000)) return false;
  switch (state.sceneId) {
    case "01": case "02": {
      const count = state.sceneId === "02" ? 7 : state.params.count;
      if (!number("count", state.sceneId === "02" ? 7 : 1, state.sceneId === "02" ? 7 : 20, true) || !number("active", 0, count - 1, true) || !number("rotation", -100000, 100000)) return false;
      for (let i = 0; i < count; i++) {
        if (!point(`piece${i}`) || !number(`angle${i}`, -100000, 100000) || !number(`reflection${i}`, -1, 1)) return false;
        if (state.params[`kind${i}`] !== undefined && !number(`kind${i}`, 0, 3, true)) return false;
      }
      return true;
    }
    case "03": return ["a", "b", "via"].every((key) => point(key)) && distance(state.points.a, state.points.b) >= 30 && !(state.flags.ray && state.flags.fullLine);
    case "04": return point("vertex") && point("protractor") && number("angle", 0, 180) && number("lengthA", 1, 6) && number("lengthB", 1, 6) && number("protractorRotation", -180, 180);
    case "05": return ["a", "b", "p"].every((key) => point(key)) && distance(state.points.a, state.points.b) >= 80 && number("along", -0.2, 1.2);
    case "06": return number("base", 1, 7) && number("left", 1, 6) && number("right", 1, 6) && number("opening", 15, 165);
    case "07": return ["a", "b", "c"].every((key) => point(key)) && simplePolygon([state.points.a, state.points.b, state.points.c]);
    case "08": return number("family", 0, 4, true) && number("width", 2, 7) && number("height", 1, 5) && number("slant", -3, 3) && number("base", 0, 3, true) && (!state.points.origin || point("origin"));
    case "10": return number("width", 2, 5) && number("height", 1, 3.5);
    case "11": {
      if (!number("columns", 1, 7, true) || !number("rows", 1, 5, true)) return false;
      const capacity = state.flags.subdivision ? 100 : state.params.columns * state.params.rows;
      return number("filled", 0, capacity) && state.marks.every((mark) => /^cell\d+$/.test(mark) && Number(mark.slice(4)) < capacity) && new Set(state.marks).size === state.marks.length;
    }
    case "12": return number("width", 2, 7);
    case "13": return point("a") && point("b");
    case "34": case "56": return ["v0", "v1", "v2", "v3", "v4"].every((key) => point(key, 0, 10, 0, 8, true)) && simplePolygon([state.points.v0, state.points.v1, state.points.v2, state.points.v3, state.points.v4]);
    case "43": return number("steps", 2, 8, true) && number("notch", 0, 1.5);
    case "60": return number("minutes", 0, 1440) && number("start", 0, 1440) && number("span", 1, 120);
    default: return false;
  }
}
