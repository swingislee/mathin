import { describe, expect, it } from "vitest";
import type { PlanarPoint, PlanarState } from "../src/features/tools/planar-kit/contract";
import { shapeOutline } from "../src/features/tools/plane-shapes/model";
import {
  addConstruction, addPreset, constructionBounds, constructionCorners, constructionDimensions, constructionLifeMatrix,
  constructionMatrix, constructionMeasurements, constructionObject, constructionObjects, createConstructionState,
  duplicateConstruction, insertConstructionVertex, interpolateConstruction, isConstructionRectangle,
  isSimpleConstructionPolygon, moveConstruction, parseConstructionTarget, removeConstruction, removeConstructionVertex,
  setConstructionField, tapConstruction, toggleConstructionFlag, transformConstruction, worldVertices,
  type ConstructionMatrix, type ConstructionObject, type ConstructionOperation,
} from "../src/features/tools/plane-construction/model";
import { isValidConstructionState } from "../src/features/tools/plane-construction/validation";

const blank = () => removeConstruction(createConstructionState("01-create"));
const editing = (state: PlanarState) => toggleConstructionFlag(state, "edit", true);
const observing = (state: PlanarState) => toggleConstructionFlag(toggleConstructionFlag(state, "edges", true), "vertices", true);
const valid = (state: PlanarState) => expect(isValidConstructionState(state), JSON.stringify(state)).toBe(true);
const apply = (matrix: ConstructionMatrix, point: PlanarPoint) => ({ x: matrix[0] * point.x + matrix[2] * point.y + matrix[4], y: matrix[1] * point.x + matrix[3] * point.y + matrix[5] });
const closePoint = (actual: PlanarPoint, expected: PlanarPoint, precision = 7) => { expect(actual.x).toBeCloseTo(expected.x, precision); expect(actual.y).toBeCloseTo(expected.y, precision); };
const subtract = (a: PlanarPoint, b: PlanarPoint) => ({ x: a.x - b.x, y: a.y - b.y });
const length = (point: PlanarPoint) => Math.hypot(point.x, point.y);
const regular = (count: number, center = { x: 400, y: 360 }) => Array.from({ length: count }, (_, i) => ({ x: center.x + 120 * Math.cos(i * 2 * Math.PI / count), y: center.y + 120 * Math.sin(i * 2 * Math.PI / count) }));
function sample(object: ConstructionObject) {
  return object.kind < 2 ? worldVertices(object) : Array.from({ length: 8 }, (_, i) => apply(constructionMatrix(object), { x: object.rx * Math.cos(i * Math.PI / 4), y: object.ry * Math.sin(i * Math.PI / 4) }));
}
function expectedRotation(point: PlanarPoint, center: PlanarPoint, angle: number) {
  const x = point.x - center.x, y = point.y - center.y, c = Math.cos(angle * Math.PI / 180), s = Math.sin(angle * Math.PI / 180);
  return { x: center.x + c * x - s * y, y: center.y + s * x + c * y };
}
function expectedReflection(point: PlanarPoint, center: PlanarPoint, angle: number, factor = -1) {
  const x = point.x - center.x, y = point.y - center.y, ux = Math.cos(angle * Math.PI / 180), uy = Math.sin(angle * Math.PI / 180);
  const along = x * ux + y * uy, normal = -x * uy + y * ux;
  return { x: center.x + along * ux - factor * normal * uy, y: center.y + along * uy + factor * normal * ux };
}

describe("共用构造模型：真实材料与稳定身份", () => {
  it.each(["01-create", "20-create"] as const)("%s 默认一个可改长宽的矩形，观察结论默认关闭", (id) => {
    const state = createConstructionState(id); valid(state);
    expect(constructionObjects(state)).toHaveLength(1);
    expect(constructionObject(state)).toMatchObject({ id: 0, kind: 1, life: 0, detail: 0, flip: 1 });
    expect(state.params.nextId).toBe(1);
    expect(constructionDimensions(constructionObject(state)!)).toEqual({ width: 260, height: 168 });
    expect(Object.entries(state.flags).filter(([, value]) => value).map(([key]) => key)).toEqual(id === "20-create" ? ["ghost"] : []);
    const width = setConstructionField(state, "width", 400), resized = setConstructionField(width, "height", 120); valid(resized);
    expect(constructionDimensions(constructionObject(resized)!)).toEqual({ width: 400, height: 120 });
    expect(constructionObject(resized)!.kind).toBe(1);
  });

  it("绘制多边形、长方形、圆、椭圆都追加真实几何而非替换现场", () => {
    const start = createConstructionState("01-create");
    const rectangle = addConstruction(start, "rectangle", [{ x: 100, y: 120 }, { x: 420, y: 250 }]); valid(rectangle);
    expect(constructionObject(rectangle)).toMatchObject({ id: 1, kind: 1, center: { x: 260, y: 185 } });
    expect(constructionDimensions(constructionObject(rectangle)!)).toEqual({ width: 320, height: 130 });
    expect(constructionObject(rectangle, 0)).toEqual(constructionObject(start, 0));
    const circle = addConstruction(rectangle, "circle", [{ x: 500, y: 400 }, { x: 530, y: 440 }]); valid(circle);
    expect(constructionObject(circle)).toMatchObject({ id: 2, kind: 2, center: { x: 500, y: 400 }, rx: 50, ry: 50, vertices: [] });
    const ellipse = addConstruction(circle, "ellipse", [{ x: 100, y: 100 }, { x: 340, y: 220 }]); valid(ellipse);
    expect(constructionObject(ellipse)).toMatchObject({ id: 3, kind: 3, rx: 120, ry: 60 });
    const points = [{ x: 500, y: 100 }, { x: 720, y: 110 }, { x: 590, y: 210 }, { x: 530, y: 240 }];
    const polygon = addConstruction(ellipse, "polygon", [...points, points[0]]); valid(polygon);
    expect(constructionObject(polygon)).toMatchObject({ id: 4, kind: 0 });
    worldVertices(constructionObject(polygon)!).forEach((point, i) => closePoint(point, points[i]));
  });

  it.each(Array.from({ length: 12 }, (_, index) => index))("预设%i只是可编辑材料，生活元数据与实际轮廓匹配", (preset) => {
    const state = addPreset(blank(), preset); valid(state);
    const object = constructionObject(state)!;
    expect(object.life).toBe(preset < 7 ? 0 : preset - 6);
    expect(object.detail).toBe(preset < 7 ? 0 : 1);
    expect(constructionObjects(state)).toHaveLength(1);
    expect(sample(object).every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
  });

  it("复制和删除不重排存续ID，nextId始终递增；删除对象清理自己的观察标记", () => {
    let state = observing(addPreset(addPreset(createConstructionState("01-create"), 0), 5));
    state = tapConstruction(tapConstruction(state, "edge.1.1"), "boundary.2");
    state = tapConstruction(state, "object.0");
    const removed = removeConstruction(state); valid(removed);
    expect(constructionObjects(removed).map((object) => object.id)).toEqual([1, 2]);
    expect(removed.marks).toEqual(["edge.1.1", "boundary.2"]); expect(removed.params.nextId).toBe(3);
    const copied = duplicateConstruction(removed); valid(copied);
    expect(constructionObjects(copied).map((object) => object.id)).toEqual([1, 2, 3]);
    expect(copied.params.active).toBe(3); expect(copied.params.nextId).toBe(4);
    const again = removeConstruction(tapConstruction(copied, "object.1")); valid(again);
    expect(again.marks).toEqual(["boundary.2"]);
    expect(constructionObjects(again).map((object) => object.id)).toEqual([2, 3]);
  });

  it("空舞台、没有活动对象、16对象上限与最大稳定ID均有准确合同", () => {
    let state = blank(); valid(state); expect(state.params.active).toBe(-1);
    expect(removeConstruction(state)).toBe(state); expect(duplicateConstruction(state)).toBe(state);
    while (constructionObjects(state).length < 16) state = addPreset(state, 5);
    valid(state); expect(addPreset(state, 0)).toBe(state); expect(duplicateConstruction(state)).toBe(state);
    const deselected = { ...state, params: { ...state.params, active: -1 } }; valid(deselected);
    expect(transformConstruction(deselected, "translate")).toBe(deselected);
    const almostExhausted = { ...blank(), params: { ...blank().params, nextId: 99998 } };
    const last = addPreset(almostExhausted, 0); valid(last);
    expect(last.params.active).toBe(99998); expect(last.params.nextId).toBe(99999);
    expect(addPreset(last, 1)).toBe(last);
    const noLast = removeConstruction(last); valid(noLast); expect(noLast.params.nextId).toBe(99999);
  });

  it("全场顶点上限192与单对象32共同约束；曲线不制造多边形顶点", () => {
    let state = blank();
    for (let i = 0; i < 6; i++) state = addConstruction(state, "polygon", regular(32));
    valid(state); expect(constructionObjects(state).reduce((sum, object) => sum + object.vertices.length, 0)).toBe(192);
    expect(addConstruction(state, "polygon", regular(3))).toBe(state); expect(duplicateConstruction(state)).toBe(state);
    const withCircle = addPreset(state, 5); valid(withCircle);
    expect(constructionObject(withCircle)!.vertices).toEqual([]);
    expect(constructionMeasurements(constructionObject(withCircle)!)).toMatchObject({ vertices: 0, straightEdges: 0, curvedBoundary: true });
  });
});

describe("共用构造模型：编辑与同源准确参数", () => {
  it("不开编辑只移动整体；编辑顶点才改变真实多边形并清生活身份", () => {
    const state = addPreset(blank(), 8), object = constructionObject(state)!, target = `vertex.${object.id}.0`;
    expect(moveConstruction(state, target, { x: 400, y: 200 }, { x: 25, y: 10 })).toBe(state);
    const edited = moveConstruction(editing(state), target, { x: 400, y: 200 }, { x: 25, y: 10 }); valid(edited);
    const changed = constructionObject(edited)!;
    expect(changed.kind).toBe(0); expect(changed.life).toBe(0); expect(changed.detail).toBe(0);
    closePoint(worldVertices(changed)[0], { x: worldVertices(object)[0].x + 25, y: worldVertices(object)[0].y + 10 });
    expect(changed.vertices.slice(1)).toEqual(object.vertices.slice(1));
  });

  it("旋转及反射后的顶点拖动仍遵循世界手势，而不是错用局部x/y", () => {
    let state = setConstructionField(createConstructionState("01-create"), "angle", 37);
    state = editing(transformConstruction(state, "reflect"));
    const before = constructionObject(state)!, start = worldVertices(before)[0];
    const moved = moveConstruction(state, `vertex.${before.id}.0`, { x: start.x + 15, y: start.y - 8 }, { x: 15, y: -8 }); valid(moved);
    closePoint(worldVertices(constructionObject(moved)!)[0], { x: start.x + 15, y: start.y - 8 });
  });

  it("相交、折返与退化拖动不产生畸形材料", () => {
    const state = editing(createConstructionState("01-create")), before = constructionObject(state)!;
    const vertex = worldVertices(before)[0], opposite = worldVertices(before)[2];
    expect(moveConstruction(state, "vertex.0.0", opposite, subtract(opposite, vertex))).toBe(state);
    const crossing = { x: worldVertices(before)[1].x + 50, y: worldVertices(before)[1].y + 20 };
    expect(moveConstruction(state, "vertex.0.0", crossing, subtract(crossing, vertex))).toBe(state);
    expect(isSimpleConstructionPolygon([{ x: 0, y: 0 }, { x: 80, y: 80 }, { x: 0, y: 80 }, { x: 80, y: 0 }])).toBe(false);
    expect(isSimpleConstructionPolygon([{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 50 }])).toBe(false);
    expect(isSimpleConstructionPolygon([{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0, y: 10 }])).toBe(false);
  });

  it("插入直边中点只新增编辑控制点，不谎报新的数学顶点；可删回且最少三点", () => {
    let state = observing(editing(createConstructionState("01-create")));
    state = tapConstruction(tapConstruction(state, "vertex.0.1"), "edge.0.0");
    const before = constructionMeasurements(constructionObject(state)!);
    const inserted = insertConstructionVertex(state, "edge.0.0"); valid(inserted);
    expect(constructionObject(inserted)!.vertices).toHaveLength(5); expect(constructionObject(inserted)!.kind).toBe(0);
    expect(constructionCorners(constructionObject(inserted)!).map((corner) => corner.index)).toEqual([0, 2, 3, 4]);
    expect(constructionMeasurements(constructionObject(inserted)!)).toEqual(before);
    expect(inserted.marks).toContain("vertex.0.2"); expect(inserted.marks).not.toContain("vertex.0.1");
    expect(tapConstruction(inserted, "vertex.0.1").marks).toEqual(inserted.marks);
    const removed = removeConstructionVertex(inserted, "vertex.0.1"); valid(removed);
    expect(constructionObject(removed)!.vertices).toHaveLength(4); expect(constructionMeasurements(constructionObject(removed)!)).toEqual(before);
    const triangle = removeConstructionVertex(removed, "vertex.0.0"); valid(triangle);
    expect(constructionObject(triangle)!.vertices).toHaveLength(3);
    expect(removeConstructionVertex(triangle, "vertex.0.0")).toBe(triangle);
  });

  it("任意局部方向的矩形可独立改长宽；生活细节严格跟随轮廓", () => {
    let state = addPreset(blank(), 9), object = constructionObject(state)!;
    object.vertices.forEach((point, i) => { state.points[`vertex.${object.id}.${i}`] = expectedRotation(point, { x: 0, y: 0 }, 31); });
    valid(state);
    state = setConstructionField(setConstructionField(state, "width", 310), "height", 120); valid(state);
    object = constructionObject(state)!;
    expect(isConstructionRectangle(object.vertices)).toBe(true);
    expect(constructionDimensions(object).width).toBeCloseTo(310, 7); expect(constructionDimensions(object).height).toBeCloseTo(120, 7);
    expect(object.life).toBe(3);
    const source = shapeOutline(9); expect(source.type).toBe("polygon");
    if (source.type === "polygon") source.vertices.forEach((point, i) => closePoint(apply(constructionLifeMatrix(object), point), worldVertices(object)[i]));
  });

  it("曲线半轴手柄与数值字段共用半径：圆保持同径，椭圆可分别调整", () => {
    let state = editing(addPreset(blank(), 5)), object = constructionObject(state)!;
    state = moveConstruction(state, `radius-x.${object.id}`, { x: 0, y: 0 }, { x: 30, y: 0 }); valid(state);
    expect(constructionObject(state)).toMatchObject({ rx: 136, ry: 136 });
    state = setConstructionField(state, "height", 140); valid(state); expect(constructionObject(state)).toMatchObject({ rx: 70, ry: 70 });
    state = editing(setConstructionField(addPreset(blank(), 6), "angle", 90)); object = constructionObject(state)!;
    state = moveConstruction(state, `radius-x.${object.id}`, { x: 0, y: 0 }, { x: 0, y: 40 }); valid(state);
    expect(constructionObject(state)).toMatchObject({ rx: 180, ry: 90 });
    expect(constructionObject(setConstructionField(state, "ry", 60))).toMatchObject({ rx: 180, ry: 60 });
  });

  it("吸附只影响直接落位，准确参数与辅助点用同一几何位置", () => {
    let state = toggleConstructionFlag(createConstructionState("01-create"), "snap", true);
    state = moveConstruction(state, "object.0", { x: 0, y: 0 }, { x: 14, y: 15 }); valid(state);
    expect(constructionObject(state)!.center).toEqual({ x: 390, y: 360 });
    state = setConstructionField(state, "width", 257); valid(state); expect(constructionDimensions(constructionObject(state)!).width).toBe(257);
    state = moveConstruction(state, "pivot", { x: 0, y: 0 }, { x: 14, y: -17 }); valid(state); expect(state.points.pivot).toEqual({ x: 480, y: 330 });
    state = moveConstruction(state, "axis-handle", { x: 580, y: 460 }, { x: 0, y: 0 }); valid(state); expect(state.params.axisAngle).toBeCloseTo(45);
  });
});

describe("共用构造模型：运动连续性与准确终点", () => {
  it("平移只操作活动图形、保持轮廓与其它材料不变", () => {
    let state = addPreset(createConstructionState("20-create"), 0);
    state = setConstructionField(setConstructionField(state, "dx", -120), "dy", 65);
    const before = constructionObject(state)!, end = transformConstruction(state, "translate"); valid(end);
    expect(constructionObject(end, 0)).toEqual(constructionObject(state, 0));
    expect(constructionObject(end)!.vertices).toEqual(before.vertices);
    closePoint(constructionObject(end)!.center, { x: before.center.x - 120, y: before.center.y + 65 });
    const middle = interpolateConstruction(state, end, 0.5, "translate"); valid(middle);
    closePoint(constructionObject(middle)!.center, { x: before.center.x - 60, y: before.center.y + 32.5 });
  });

  it("旋转中间帧沿pivot圆弧，边长及纸片面积全程不变", () => {
    const state = setConstructionField(createConstructionState("20-create"), "turn", 180), before = constructionObject(state)!;
    const end = transformConstruction(state, "rotate"); valid(end);
    const middle = interpolateConstruction(state, end, 0.5, "rotate"); valid(middle);
    const vertices = worldVertices(before), actual = worldVertices(constructionObject(middle)!);
    vertices.forEach((point, i) => closePoint(actual[i], expectedRotation(point, state.points.pivot, 90)));
    const startDistance = length(subtract(before.center, state.points.pivot));
    expect(length(subtract(constructionObject(middle)!.center, state.points.pivot))).toBeCloseTo(startDistance, 7);
    expect(constructionMeasurements(constructionObject(middle)!).area).toBeCloseTo(constructionMeasurements(before).area, 7);
    expect(constructionMeasurements(constructionObject(middle)!).perimeter).toBeCloseTo(constructionMeasurements(before).perimeter, 7);
    expect(interpolateConstruction(state, end, 1, "rotate")).toBe(end);
  });

  it.each([-90, -35, 0, 27, 90, 180])("轴角度%i：任意图形镜像终点及翻折中途都使用真实轴法向", (angle) => {
    for (const preset of [0, 2, 5, 6, 7, 9, 10, 11]) {
      const state = setConstructionField(setConstructionField(addPreset(blank(), preset), "angle", 31), "axisAngle", angle);
      const before = constructionObject(state)!, end = transformConstruction(state, "reflect"); valid(end);
      const originalPoints = sample(before), axis = state.points.axis;
      // 反射端点保留原局部点序；使用同一规范点比较，避免椭圆参数方向重排。
      const localPoints = before.kind < 2 ? before.vertices : Array.from({ length: 8 }, (_, i) => ({ x: before.rx * Math.cos(i * Math.PI / 4), y: before.ry * Math.sin(i * Math.PI / 4) }));
      for (const progress of [0.25, 0.5, 0.75]) {
        const frame = interpolateConstruction(state, end, progress, "reflect"), object = constructionObject(frame)!;
        expect(isValidConstructionState(frame)).toBe(false);
        localPoints.forEach((point, i) => closePoint(apply(constructionMatrix(object), point), expectedReflection(originalPoints[i], axis, angle, Math.cos(Math.PI * progress))));
        expect(constructionMeasurements(object).area).toBeCloseTo(constructionMeasurements(before).area, 6);
        expect(constructionMeasurements(object).perimeter).toBeCloseTo(constructionMeasurements(before).perimeter, 6);
        expect(constructionCorners(object).length).toBe(constructionCorners(before).length);
      }
      localPoints.forEach((point, i) => closePoint(apply(constructionMatrix(constructionObject(end)!), point), expectedReflection(originalPoints[i], axis, angle)));
      const twice = transformConstruction(end, "reflect"); valid(twice);
      sample(constructionObject(twice)!).forEach((point, i) => closePoint(point, originalPoints[i]));
    }
  });

  it("生活实例细节与轮廓在任意轴中途共用同一仿射投影", () => {
    for (const preset of [7, 8, 9, 10, 11]) {
      let from = addPreset(blank(), preset);
      from = setConstructionField(setConstructionField(setConstructionField(from, "width", 260), "height", 190), "axisAngle", 27);
      const to = transformConstruction(from, "reflect"), frame = interpolateConstruction(from, to, 0.37, "reflect");
      const source = shapeOutline(preset), before = constructionObject(from)!, during = constructionObject(frame)!;
      const points = source.type === "polygon" ? source.vertices : [{ x: source.rx, y: 0 }, { x: 0, y: source.ry }];
      points.forEach((point) => closePoint(apply(constructionLifeMatrix(during), point), expectedReflection(apply(constructionLifeMatrix(before), point), from.points.axis, 27, Math.cos(Math.PI * 0.37))));
    }
  });

  it("投影外接框正确包含曲线，而准确终点不留frame参数", () => {
    const state = setConstructionField(addPreset(blank(), 6), "axisAngle", 23), end = transformConstruction(state, "reflect");
    const middle = interpolateConstruction(state, end, 0.5, "reflect"), object = constructionObject(middle)!, bounds = constructionBounds(object);
    expect(sample(object).every((point) => point.x >= bounds.minX - 1e-7 && point.x <= bounds.maxX + 1e-7 && point.y >= bounds.minY - 1e-7 && point.y <= bounds.maxY + 1e-7)).toBe(true);
    expect(Object.keys(end.params).some((key) => key.startsWith("frame"))).toBe(false);
    expect(interpolateConstruction(state, end, 0, "reflect")).toBe(state);
    expect(interpolateConstruction(state, end, 1, "reflect")).toBe(end);
  });

  it("越界运动整次拒绝不裁剪；长时间旋转仍能得到合法等价角度", () => {
    const edge = setConstructionField(setConstructionField(createConstructionState("20-create"), "centerX", 2000), "dx", 100);
    expect(transformConstruction(edge, "translate")).toBe(edge);
    expect(interpolateConstruction(edge, edge, 0.5, "translate")).toBe(edge);
    const turned = setConstructionField(setConstructionField(createConstructionState("20-create"), "angle", 35980), "turn", 360);
    const end = transformConstruction(turned, "rotate"); valid(end);
    expect(Math.abs(constructionObject(end)!.angle)).toBeLessThanOrEqual(36000);
    worldVertices(constructionObject(end)!).forEach((point, i) => closePoint(point, worldVertices(constructionObject(turned)!)[i], 6));
  });
});

describe("共用构造模型：严格存档边界", () => {
  it("拒绝额外键、缺字段、表现参数、非法稳定ID、点位和数学形状", () => {
    const mutations: ((state: PlanarState) => void)[] = [
      (state) => { state.sceneId = "01-basic"; }, (state) => { state.phase = 0.5; },
      (state) => { state.params.nextId = 0; }, (state) => { state.params.nextId = 100000; }, (state) => { state.params.active = 1; },
      (state) => { state.params.dx = 601; }, (state) => { state.params.dy = -601; }, (state) => { state.params.turn = 361; }, (state) => { state.params.axisAngle = 181; },
      (state) => { state.params["kind.0"] = 4; }, (state) => { state.params["count.0"] = 3; }, (state) => { state.params["angle.0"] = 36001; },
      (state) => { state.params["rx.0"] = 1; }, (state) => { state.params["flip.0"] = 0; }, (state) => { state.params["life.0"] = 4; }, (state) => { state.params["detail.0"] = 0.5; },
      (state) => { state.params["frameA.0"] = 1; }, (state) => { state.params["kind.00"] = 1; }, (state) => { delete state.params["angle.0"]; },
      (state) => { state.points["center.0"].x = 2001; }, (state) => { state.points.pivot.y = 1721; }, (state) => { state.points.axis.x = -1001; },
      (state) => { state.points["vertex.0.0"].x = -801; }, (state) => { state.points["vertex.0.0"].x = -129; },
      (state) => { state.points["vertex.0.0"] = state.points["vertex.0.2"]; }, (state) => { state.points["vertex.0.4"] = { x: 0, y: 0 }; },
      (state) => { state.flags.other = false; }, (state) => { delete state.flags.counts; },
      (state) => { state.marks = ["vertex.0.4"]; }, (state) => { state.marks = ["vertex.00.1"]; }, (state) => { state.marks = ["vertex.0.01"]; },
      (state) => { state.marks = ["boundary.0"]; }, (state) => { state.marks = ["object.0"]; }, (state) => { state.marks = ["vertex.0.0", "vertex.0.0"]; },
    ];
    for (const mutate of mutations) {
      const state = createConstructionState("01-create"); mutate(state);
      expect(isValidConstructionState(state), JSON.stringify(state)).toBe(false);
    }
    for (const malformed of [null, undefined, [], {}, { ...createConstructionState("01-create"), points: null }, { ...createConstructionState("01-create"), extra: true }, { ...createConstructionState("01-create"), marks: [null] }]) {
      expect(isValidConstructionState(malformed as PlanarState)).toBe(false);
    }
  });

  it("曲线半径/生活关系/点位键和标记均执行真实几何约束", () => {
    const circle = addPreset(blank(), 5), id = constructionObject(circle)!.id;
    for (const value of [5.99, 350.01, NaN, Infinity]) {
      const bad = structuredClone(circle); bad.params[`rx.${id}`] = value; bad.params[`ry.${id}`] = value;
      expect(isValidConstructionState(bad)).toBe(false);
    }
    const unequal = structuredClone(circle); unequal.params[`ry.${id}`] += 1; expect(isValidConstructionState(unequal)).toBe(false);
    const forged = structuredClone(circle); forged.points[`vertex.${id}.0`] = { x: 0, y: 0 }; expect(isValidConstructionState(forged)).toBe(false);
    const falseCorner = structuredClone(circle); falseCorner.marks = [`vertex.${id}.0`]; expect(isValidConstructionState(falseCorner)).toBe(false);
    const badLife = structuredClone(circle); badLife.params[`life.${id}`] = 5; expect(isValidConstructionState(badLife)).toBe(false);
    expect(parseConstructionTarget("edge.99998.31")).toEqual({ type: "edge", id: 99998, part: 31 });
    for (const target of ["edge.01.1", "edge.1.32", "edge.99999.1", "constructor", "object.-1"]) expect(parseConstructionTarget(target)).toBeNull();
  });

  it("动作和字段极值都返回合法终点；非法输入原地返回", () => {
    const keys = { dx: [-600, 600], dy: [-600, 600], turn: [-360, 360], axisAngle: [-180, 180], width: [12, 700], height: [12, 700], angle: [-36000, 36000], detail: [0, 1], centerX: [-1000, 2000], centerY: [-1000, 1720], pivotX: [-1000, 2000], pivotY: [-1000, 1720], axisX: [-1000, 2000], axisY: [-1000, 1720] };
    for (const preset of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
      const state = addPreset(blank(), preset);
      for (const [key, values] of Object.entries(keys)) for (const value of values) valid(setConstructionField(state, key, value));
      for (const operation of ["translate", "rotate", "reflect"] as ConstructionOperation[]) valid(transformConstruction(state, operation));
    }
    const state = createConstructionState("01-create");
    expect(setConstructionField(state, "width", NaN)).toBe(state); expect(setConstructionField(state, "unknown", 1)).toBe(state);
    expect(moveConstruction(state, "object.0", { x: Infinity, y: 0 }, { x: 1, y: 0 })).toBe(state);
    expect(addConstruction(state, "polygon", [{ x: 0, y: 0 }, { x: Infinity, y: 5 }, { x: 5, y: 0 }])).toBe(state);
    expect(addPreset(state, 12)).toBe(state); expect(addPreset(state, -1)).toBe(state);
  });
});
