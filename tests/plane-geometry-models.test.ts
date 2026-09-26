import { describe, expect, it } from "vitest";
import { polygonArea } from "../src/features/tools/planar-interaction/geometry";
import { clockHands, distance, hingedFrame, interiorAngle, latticeCounts, perpendicularFoot, pointInPolygon, polygonAltitude, polygonPerimeter, quadrilateral, rectanglePoints, rectangleUnion, sameAreaRectangle, samePerimeterRectangle, sharedRectangleSeams, simplePolygon, staircasePolygon, straightenBoundary, tangramPiece, TANGRAM_PIECES, threeRodGeometry, triangleAngles, triangulatePolygon } from "../src/features/tools/plane-geometry/model";

describe("平面图形与测量的数学合同", () => {
  it("七巧板七片面积严格铺满16，搬动旋转镜像不增减面积", () => {
    expect(TANGRAM_PIECES.map(polygonArea)).toEqual([4, 4, 2, 1, 1, 2, 2]);
    TANGRAM_PIECES.forEach((piece, index) => {
      expect(polygonArea(tangramPiece(index, { x: 120, y: 90 }, 45, 73, true))).toBeCloseTo(polygonArea(piece) * 45 ** 2, 6);
    });
  });
  it("标准七巧板是五个三角形、一正方形和一非矩形平行四边形，且无重叠空隙", () => {
    expect(TANGRAM_PIECES.filter((piece) => piece.length === 3)).toHaveLength(5);
    const quadrilaterals = TANGRAM_PIECES.filter((piece) => piece.length === 4);
    expect(quadrilaterals).toHaveLength(2);
    const corners = quadrilaterals.map((piece) => interiorAngle(piece[1], piece[0], piece[3]));
    expect(corners.filter((angle) => Math.abs(angle - 90) < 1e-6)).toHaveLength(1);
    expect(corners.filter((angle) => Math.abs(angle - 90) > 1e-6)).toHaveLength(1);
    for (let x = 0.0625; x < 4; x += 0.125) for (let y = 0.09375; y < 4; y += 0.125) {
      const classifications = TANGRAM_PIECES.map((piece) => pointInPolygon({ x, y }, piece));
      if (classifications.includes("boundary")) continue;
      expect(classifications.filter((kind) => kind === "inside")).toHaveLength(1);
    }
  });
  it("垂足支持外高，直角标记依据真实方向而不是固定水平", () => {
    const point = { x: -2, y: 5 }, a = { x: 0, y: 0 }, b = { x: 4, y: 2 };
    const result = perpendicularFoot(point, a, b)!;
    expect(result.baseDirection.x * result.heightDirection.x + result.baseDirection.y * result.heightDirection.y).toBeCloseTo(0, 8);
    expect(perpendicularFoot({ x: -2, y: 3 }, { x: 0, y: 0 }, { x: 4, y: 0 })?.parameter).toBeLessThan(0);
    expect(perpendicularFoot(point, a, a)).toBeNull();
    expect(polygonAltitude([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 5, y: -3 }, { x: 1, y: -3 }], 0)?.altitude?.distance).toBe(3);
  });
  it("角大小与边长无关，三个内角合成平角", () => {
    expect(interiorAngle({ x: 100, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 })).toBe(90);
    const angles = triangleAngles([{ x: -20, y: 70 }, { x: 400, y: 70 }, { x: 10, y: 1 }]);
    expect(angles.reduce((a, b) => a + b, 0)).toBeCloseTo(180, 8);
  });
  it("三杆不能合拢时保留准确杆长和可见间隙", () => {
    expect(threeRodGeometry(5, 3, 4)).toMatchObject({ closed: true, gap: 0 });
    for (const [base, left, right] of [[8, 2, 3], [2, 8, 3], [2, 3, 8]]) {
      const result = threeRodGeometry(base, left, right)!;
      expect(result.closed).toBe(false);
      expect(distance({ x: 0, y: 0 }, result.leftJoint)).toBeCloseTo(left);
      expect(distance({ x: base, y: 0 }, result.rightJoint)).toBeCloseTo(right);
      expect(result.gap).toBeCloseTo(3);
    }
  });
  it("铰接框架推斜时四杆不变长，家族约束保持", () => {
    for (const angle of [15, 70, 110, 165]) {
      expect(polygonPerimeter(hingedFrame(4, 3, angle))).toBeCloseTo(14, 8);
    }
    const rhombus = quadrilateral("rhombus", 4, 3, 2);
    expect(polygonPerimeter(rhombus)).toBeCloseTo(16);
    expect(polygonArea(quadrilateral("square", 4, 3, 1))).toBe(16);
  });
  it("搬直周长的每一中间帧保留每条边长", () => {
    const source = rectanglePoints({ x: 50, y: 80, width: 4, height: 3 });
    for (const progress of [0, 0.12, 0.5, 0.8, 1]) {
      expect(straightenBoundary(source, { x: 0, y: 0 }, progress).map(({ a, b }) => distance(a, b))).toEqual(expect.arrayContaining([expect.closeTo(4), expect.closeTo(3)]));
    }
    const target = straightenBoundary(source, { x: 0, y: 0 }, 1);
    expect(target[3].b.x).toBeCloseTo(14);
    expect(target.every(({ a, b }) => a.y === 0 && b.y === 0)).toBe(true);
  });
  it("等周长与等面积两种约束分别维持自己的量", () => {
    for (const width of [2, 3, 4, 6]) {
      expect(polygonPerimeter(rectanglePoints(samePerimeterRectangle(16, width)))).toBeCloseTo(16);
      expect(polygonArea(rectanglePoints(sameAreaRectangle(16, width)))).toBeCloseTo(16);
    }
  });
  it("拼接扣除两份共边，部分拼接和重叠使用真正并集", () => {
    const first = { x: 0, y: 0, width: 3, height: 2 };
    expect(rectangleUnion([first, { ...first, x: 3 }])).toMatchObject({ area: 12, perimeter: 16 });
    expect(rectangleUnion([first, { ...first, x: 3, y: 1 }])).toMatchObject({ area: 12, perimeter: 18 });
    expect(sharedRectangleSeams(first, { ...first, x: 3, y: 1 }).map(({ a, b }) => distance(a, b))).toEqual([1]);
    expect(rectangleUnion([first, { ...first, x: 1 }])).toMatchObject({ area: 8, perimeter: 12 });
  });
  it("皮克关系只处理简单整数格点无孔多边形，边界点准确计数", () => {
    const rectangle = rectanglePoints({ x: 0, y: 0, width: 4, height: 3 });
    const counts = latticeCounts(rectangle)!;
    expect(counts.inside).toHaveLength(6); expect(counts.boundary).toHaveLength(14);
    expect(counts.area).toBe(12); expect(counts.pickArea).toBe(12);
    expect(latticeCounts([{ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 2, y: 0 }])).toBeNull();
    expect(latticeCounts([{ x: 0.1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 2 }])).toBeNull();
  });
  it("单调台阶等外框周长，凹口新增两份深度且仍为简单图形", () => {
    expect(polygonPerimeter(staircasePolygon(7, 5, 3))).toBeCloseTo(24);
    const notched = staircasePolygon(7, 5, 3, 1);
    expect(simplePolygon(notched)).toBe(true);
    expect(polygonPerimeter(notched)).toBeCloseTo(26);
    const triangles = triangulatePolygon(notched);
    expect(triangles.length).toBe(notched.length - 2);
    expect(triangles.reduce((sum, piece) => sum + polygonArea(piece), 0)).toBeCloseTo(polygonArea(notched));
  });
  it("真实钟针按6°/分和0.5°/分同步连续变化", () => {
    expect(clockHands(120)).toEqual({ hour: 60, minute: 0, smallerAngle: 60, largerAngle: 300 });
    expect(clockHands(130)).toEqual({ hour: 65, minute: 60, smallerAngle: 5, largerAngle: 355 });
    expect(clockHands(120 + 120 / 11).smallerAngle).toBeCloseTo(0, 8);
    expect(clockHands(720)).toEqual({ hour: 0, minute: 0, smallerAngle: 0, largerAngle: 360 });
  });
});
