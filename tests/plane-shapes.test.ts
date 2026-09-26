import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PlanarState } from "../src/features/tools/planar-kit/contract";
import { planarStateSchema } from "../src/features/tools/planar-kit/contract";
import { interpolatePlanarState } from "../src/features/tools/planar-kit/presentation";
import type { PlanarDrawingApi } from "../src/features/tools/planar-kit/types";
import {
  SHAPE_KINDS, addShapeObject, createPlaneShapesState, duplicateShapeObject, moveShapeObject, removeShapeObject,
  selectShapeTarget, setShapeField, shapeBounds, shapeCounts, shapeObject, shapeOutline,
  shapeVertices, toggleShapeDetail, toggleShapeFlag,
} from "../src/features/tools/plane-shapes/model";
import { planeShapesScene } from "../src/features/tools/plane-shapes/scene";
import { isValidPlaneShapesState } from "../src/features/tools/plane-shapes/validation";

function drawingApi(locale = "zh", selected: string | null = null): PlanarDrawingApi {
  return { locale, selected, editable: true, bind: (target, label) => ({ role: "button", tabIndex: 0, "aria-label": label ?? target, "aria-pressed": selected === target, "aria-disabled": false }) };
}
function render(state = createPlaneShapesState(), locale = "zh", selected: string | null = null) {
  return renderToStaticMarkup(createElement("svg", {}, planeShapesScene.draw(state, drawingApi(locale, selected))));
}
const empty = () => removeShapeObject(createPlaneShapesState());
const only = (kind: number) => addShapeObject(empty(), kind);
const observing = (state: PlanarState) => toggleShapeFlag(toggleShapeFlag(state, "edges", true), "vertices", true);
const valid = (state: PlanarState) => {
  expect(isValidPlaneShapesState(state)).toBe(true);
  expect(planarStateSchema.safeParse(state).success).toBe(true);
};

describe("基本图形认识：材料添加在同一舞台", () => {
  it("独立默认场景只有一个长方形，不加载七巧板或全部形状", () => {
    const state = createPlaneShapesState();
    valid(state);
    expect(planeShapesScene.id).toBe("01-basic");
    expect(planeShapesScene.toolId).toBe("plane-shapes");
    expect(state.params).toEqual({ count: 1, active: 0, kind0: 2, scale0: 1, angle0: 0, detail0: 0 });
    expect(state.flags).toEqual({ grid: false, measures: true, edges: false, vertices: false, names: false });
    const markup = render(state);
    expect(markup.match(/data-shape-object=/g)).toHaveLength(1);
    expect(markup).toContain('data-shape-kind="rectangle"');
    expect(markup).not.toContain("边1");
    expect(markup).not.toContain("顶点1");
  });

  it("12项材料分为基本图形与生活轮廓，追加不替换原对象", () => {
    expect(planeShapesScene.materials).toHaveLength(12);
    expect(planeShapesScene.materials!.slice(0, 7).every((material) => material.group.zh === "基本图形")).toBe(true);
    expect(planeShapesScene.materials!.slice(7).every((material) => material.group.zh === "生活中的平面轮廓")).toBe(true);
    for (const [kind, material] of planeShapesScene.materials!.entries()) {
      const before = createPlaneShapesState(), after = material.add(before);
      valid(after);
      expect(after.params.count).toBe(2);
      expect(after.params.kind1).toBe(kind);
      expect(after.params.active).toBe(1);
      expect(shapeObject(after, 0)).toEqual(shapeObject(before, 0));
      expect(material.label.zh).toBeTruthy(); expect(material.label.en).toBeTruthy();
      expect(renderToStaticMarkup(createElement("span", {}, material.preview))).toContain("<svg");
    }
  });

  it.each(SHAPE_KINDS.map((kind, index) => ({ ...kind, index })))("$id 双语绘制及拓扑准确", ({ index, sides, life, id }) => {
    const state = only(index);
    valid(state);
    expect(shapeCounts(index)).toEqual({ straightEdges: sides, vertices: sides, curvedBoundary: sides === 0 });
    expect(shapeVertices(shapeObject(state)!)).toHaveLength(sides);
    for (const locale of ["zh", "en"]) {
      const markup = render(state, locale);
      expect(markup).toContain(`data-shape-kind="${id}"`);
      expect(markup).not.toMatch(/NaN|Infinity/);
      expect(markup.includes("data-life-details")).toBe(life);
    }
  });

  it("删除最后一个对象得到可保存空舞台；继续添加可恢复工作", () => {
    const blank = empty(); valid(blank);
    expect(blank.params).toEqual({ count: 0, active: -1 });
    expect(blank.points).toEqual({}); expect(blank.marks).toEqual([]);
    expect(render(blank)).toContain("从右侧“添加”");
    expect(removeShapeObject(blank)).toBe(blank);
    expect(duplicateShapeObject(blank)).toBe(blank);
    expect(setShapeField(blank, "angle", 45)).toBe(blank);
    const next = addShapeObject(blank, 5); valid(next);
    expect(next.params).toEqual({ count: 1, active: 0, kind0: 5, scale0: 1, angle0: 0, detail0: 0 });
  });

  it("添加与复制共享8个上限；复制准确保留当前姿态但不复制观察标记", () => {
    let state = observing(setShapeField(setShapeField(only(9), "angle", 45), "detail", 0.3));
    state = selectShapeTarget(state, "edge.0.2");
    const copied = duplicateShapeObject(state); valid(copied);
    expect(shapeObject(copied, 1)).toMatchObject({ kind: 9, scale: 1, angle: 45, detail: 0.3 });
    expect(copied.marks).toEqual(["edge.0.2"]);
    expect(copied.points.object1).not.toEqual(copied.points.object0);
    state = copied;
    while (state.params.count < 8) state = duplicateShapeObject(state);
    valid(state);
    expect(addShapeObject(state, 0)).toBe(state);
    expect(duplicateShapeObject(state)).toBe(state);
    expect(planeShapesScene.materials!.every((material) => material.disabled!(state))).toBe(true);
  });

  it("删除中间材料压紧槽位，并让边、顶点、连续曲线标记跟随各自对象", () => {
    let state = observing(addShapeObject(addShapeObject(createPlaneShapesState(), 5), 0));
    for (const target of ["edge.2.2", "vertex.2.0", "boundary.1"]) state = selectShapeTarget(state, target);
    state = selectShapeTarget(state, "object.0");
    const removed = removeShapeObject(state); valid(removed);
    expect(removed.params.count).toBe(2); expect(removed.params.kind0).toBe(5); expect(removed.params.kind1).toBe(0);
    expect(removed.marks).toEqual(["edge.1.2", "vertex.1.0", "boundary.0"]);
    expect(removed.params.kind2).toBeUndefined(); expect(removed.points.object2).toBeUndefined();
  });

  it("靠近舞台右下角复制也会错开，避免完整盖住原对象", () => {
    const state = moveShapeObject(createPlaneShapesState(), "object.0", { x: 10000, y: 10000 });
    const copied = duplicateShapeObject(state); valid(copied);
    expect(Math.hypot(copied.points.object1.x - copied.points.object0.x, copied.points.object1.y - copied.points.object0.y)).toBeGreaterThan(20);
  });
});

describe("基本图形认识：直接手势与观察", () => {
  it("整图拖动使用冻结起点的总位移，观察顶点不会成为变形手柄", () => {
    const start = observing(addShapeObject(createPlaneShapesState(), 0));
    const moved = moveShapeObject(start, "object.0", { x: 60, y: -30 }); valid(moved);
    expect(moved.points.object0).toEqual({ x: 540, y: 330 });
    expect(shapeObject(moved, 1)).toEqual(shapeObject(start, 1));
    expect(moved.params.scale0).toBe(start.params.scale0); expect(moved.params.kind0).toBe(start.params.kind0);
    expect(moveShapeObject(start, "vertex.0.0", { x: 60, y: 20 })).toBe(start);
    expect(moveShapeObject(start, "edge.0.0", { x: 60, y: 20 })).toBe(start);
    expect(planeShapesScene.drag!(start, "object.0", { x: 9, y: 9 }, { x: 60, y: -30 })).toEqual(moved);
  });

  it("边和顶点可独立逐个高亮与编号，重复轻点取消，开关不会清除材料", () => {
    let state = observing(createPlaneShapesState());
    state = selectShapeTarget(selectShapeTarget(state, "edge.0.2"), "vertex.0.1"); valid(state);
    expect(state.marks).toEqual(["edge.0.2", "vertex.0.1"]);
    expect(render(state)).toContain("边3"); expect(render(state)).toContain("点2");
    state = selectShapeTarget(state, "edge.0.2"); expect(state.marks).toEqual(["vertex.0.1"]);
    const hidden = toggleShapeFlag(state, "vertices", false); valid(hidden);
    expect(render(hidden)).not.toContain("点2"); expect(hidden.marks).toEqual(state.marks);
    expect(shapeObject(hidden)).toEqual(shapeObject(state));
    expect(selectShapeTarget(hidden, "vertex.0.2").marks).toEqual(state.marks);
  });

  it.each([5, 6, 10, 11])("曲线材料 %i 没有虚构直边或顶点，可独立点亮整个边界", (kind) => {
    let state = observing(only(kind));
    const initial = state;
    expect(selectShapeTarget(state, "edge.0.0")).toBe(state);
    expect(selectShapeTarget(state, "vertex.0.0")).toBe(state);
    state = selectShapeTarget(state, "boundary.0"); valid(state);
    expect(state.marks).toEqual(["boundary.0"]);
    const markup = render(state);
    expect(markup).toContain("连续曲线 · 0 条直边 · 0 个顶点");
    expect(markup).not.toContain("顶点 1"); expect(markup).not.toContain("<polygon");
    expect(selectShapeTarget(state, "boundary.0")).toEqual(initial);
  });

  it("所有多边形观察标记能达到64项上界且保持唯一", () => {
    let state = observing(createPlaneShapesState());
    while (state.params.count < 8) state = addShapeObject(state, 1);
    for (let i = 0; i < 8; i++) for (let j = 0; j < 4; j++) {
      state = selectShapeTarget(selectShapeTarget(state, `edge.${i}.${j}`), `vertex.${i}.${j}`);
    }
    valid(state); expect(state.marks).toHaveLength(64);
  });

  it("±45°动作和准确角度字段变换同一对象，改变方向不改变图形类别", () => {
    const start = createPlaneShapesState(), before = shapeVertices(shapeObject(start)!);
    const action = planeShapesScene.actions!.find((item) => item.id === "basic-shapes-right")!;
    const end = action.run(start, { selected: "object.0" }); valid(end);
    expect(end.params.angle0).toBe(45); expect(end.params.kind0).toBe(2);
    const after = shapeVertices(shapeObject(end)!);
    for (let i = 0; i < 4; i++) {
      const a = before[i], b = before[(i + 1) % 4], c = after[i], d = after[(i + 1) % 4];
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(Math.hypot(c.x - d.x, c.y - d.y), 9);
    }
    expect(planeShapesScene.setField!(end, "angle", -135).params.angle0).toBe(-135);
    expect(planeShapesScene.fields!.find((field) => field.key === "angle")!.read!(end)).toBe(45);
    const middle = interpolatePlanarState(start, end, 0.5); valid(middle);
    expect(middle.params.angle0).toBe(22.5);
  });

  it.each([7, 8, 9, 10, 11])("生活材料 %i 的淡化保持原来的轮廓、位置、比例、角度", (kind) => {
    const from = setShapeField(only(kind), "angle", 45), to = toggleShapeDetail(from);
    const middle = interpolatePlanarState(from, to, 0.5);
    for (const state of [from, middle, to]) valid(state);
    expect(from.params.detail0).toBe(1); expect(middle.params.detail0).toBe(0.5); expect(to.params.detail0).toBe(0);
    expect(shapeOutline(kind)).toEqual(shapeOutline(shapeObject(to)!.kind));
    expect(shapeBounds(shapeObject(middle)!)).toEqual(shapeBounds(shapeObject(from)!));
    expect(to.points).toEqual(from.points); expect(to.params.scale0).toBe(from.params.scale0); expect(to.params.angle0).toBe(from.params.angle0);
    expect(render(middle)).toContain('opacity="0.5"');
    expect(render(to)).not.toContain("data-life-details");
    expect(toggleShapeDetail(to)).toEqual(from);
  });

  it("全部精确参数极值、动画中间帧与空舞台动作均可稳定重建", () => {
    for (const kind of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
      for (const field of planeShapesScene.fields!) for (const value of [field.min, field.max]) {
        const state = planeShapesScene.setField!(only(kind), field.key, value); valid(state);
        expect(render(state)).not.toMatch(/NaN|Infinity/);
      }
      for (const action of planeShapesScene.actions!) {
        const start = only(kind), end = action.run(start, { selected: "object.0" }); valid(end);
        if (action.duration) {
          const frame = (action.interpolate ?? interpolatePlanarState)(start, end, 0.5); valid(frame);
          expect(render(frame)).not.toMatch(/NaN|Infinity/);
        }
        valid(action.run(empty(), { selected: null }));
      }
    }
  });

  it("超出舞台的位移安全夹取；未知键、越界对象与非有限操作不改现场", () => {
    const state = createPlaneShapesState();
    valid(moveShapeObject(state, "object.0", { x: 1e8, y: -1e8 }));
    expect(moveShapeObject(state, "object.7", { x: 10, y: 10 })).toBe(state);
    expect(moveShapeObject(state, "object.0", { x: NaN, y: 10 })).toBe(state);
    expect(setShapeField(state, "angle", Infinity)).toBe(state);
    expect(setShapeField(state, "unknown", 1)).toBe(state);
    expect(addShapeObject(state, -1)).toBe(state); expect(addShapeObject(state, 12)).toBe(state);
    expect(toggleShapeFlag(state, "unknown", true)).toBe(state);
    expect(selectShapeTarget(state, "vertex.0.7")).toBe(state);
  });
});

describe("基本图形认识：严格存档边界", () => {
  it("拒绝缺失/未知键、非有限数、不合法对象数量和数学拓扑", () => {
    const mutations: ((state: PlanarState) => void)[] = [
      (state) => { state.sceneId = "01"; }, (state) => { state.phase = 0.5; },
      (state) => { state.params.count = 1.2; }, (state) => { state.params.count = 9; },
      (state) => { state.params.active = -1; }, (state) => { state.params.active = 1; },
      (state) => { state.params.kind0 = 12; }, (state) => { state.params.kind0 = 1.5; },
      (state) => { state.params.scale0 = 0.49; }, (state) => { state.params.scale0 = 2.01; },
      (state) => { state.params.angle0 = NaN; }, (state) => { state.params.angle0 = 36001; },
      (state) => { state.params.detail0 = 0.1; }, (state) => { delete state.params.angle0; },
      (state) => { state.params.extra = 1; }, (state) => { state.points.object1 = { x: 480, y: 360 }; },
      (state) => { state.points.object0.x = 59; }, (state) => { state.points.object0.y = 661; },
      (state) => { state.points.object0.y = Infinity; }, (state) => { delete state.points.object0; },
      (state) => { state.flags.extra = true; }, (state) => { delete state.flags.names; },
      (state) => { state.marks = ["boundary.0"]; }, (state) => { state.marks = ["edge.0.4"]; },
      (state) => { state.marks = ["vertex.1.0"]; }, (state) => { state.marks = ["edge.0.0", "edge.0.0"]; },
      (state) => { state.marks = ["constructor"]; }, (state) => { state.marks = ["edge.00.0"]; },
    ];
    for (const mutate of mutations) {
      const state = createPlaneShapesState(); mutate(state);
      expect(isValidPlaneShapesState(state), JSON.stringify(state)).toBe(false);
      expect(planarStateSchema.safeParse(state).success).toBe(false);
    }
    const malformed: unknown[] = [null, undefined, {}, [], { ...createPlaneShapesState(), extra: true }, { ...createPlaneShapesState(), points: null }, { ...createPlaneShapesState(), params: [] }, { ...createPlaneShapesState(), marks: null }, { ...createPlaneShapesState(), flags: { ...createPlaneShapesState().flags, names: 1 } }, { ...createPlaneShapesState(), points: { object0: { x: 480, y: 360, z: 1 } } }];
    for (const input of malformed) expect(isValidPlaneShapesState(input as PlanarState)).toBe(false);
  });

  it("圆的伪顶点、三角形第4边和生活细节越界均被拒绝", () => {
    const round = only(5); round.marks = ["vertex.0.0"]; expect(isValidPlaneShapesState(round)).toBe(false);
    const triangle = only(0); triangle.marks = ["edge.0.3"]; expect(isValidPlaneShapesState(triangle)).toBe(false);
    for (const detail of [-0.01, 1.01, Infinity]) {
      const life = only(7); life.params.detail0 = detail; expect(isValidPlaneShapesState(life)).toBe(false);
    }
  });
});
