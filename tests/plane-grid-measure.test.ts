import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PlanarPoint, PlanarState } from "../src/features/tools/planar-kit/contract";
import type { PlanarDrawingApi } from "../src/features/tools/planar-kit/types";
import { polygonArea } from "../src/features/tools/planar-interaction/geometry";
import { latticeCounts, polygonPerimeter } from "../src/features/tools/plane-geometry/model";
import { gridCoverage, gridPolygonCorners, gridTriangles, isGridPolygon, unitSquareUnion } from "../src/features/tools/plane-grid-measure/geometry";
import {
  GRID_ORIGIN, GRID_SCALE, addGridPolygon, addUnitRow, addUnitSquare, constructGridMaterial, createGridMeasureState,
  duplicateGridMaterial, gridMaterial, gridMaterials, gridPolygons, gridToStage, gridUnits, insertGridVertex, interpolateGridSeparation,
  moveGridMaterial, parseGridTarget, projectGridPoint, removeGridMaterial, removeGridVertex, separateGridPolygon, setGridField, setGridFlag,
  snapGridMaterial, stageToGrid, tapGridMaterial, unitSquares, type GridPolygon,
} from "../src/features/tools/plane-grid-measure/model";
import { planeGridMeasureScenes } from "../src/features/tools/plane-grid-measure/scenes";
import { isValidGridMeasureState } from "../src/features/tools/plane-grid-measure/validation";

const blank = (geoboard = true) => createGridMeasureState(geoboard ? "34-create" : "11-create", true);
const valid = (state: PlanarState) => expect(isValidGridMeasureState(state), JSON.stringify(state)).toBe(true);
const rectangle = (x = 1, y = 1, width = 4, height = 3): PlanarPoint[] => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
const polygon = (state: PlanarState) => gridMaterial(state) as GridPolygon;
const concave = [{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 5 }, { x: 1, y: 5 }];
const api = (selected: string | null = null, operation?: string, locale = "zh"): PlanarDrawingApi => ({ locale, selected, operation, editable: true,
  bind: (target, label) => ({ role: "button", tabIndex: 0, "aria-label": label ?? target, "aria-pressed": target === selected, "aria-disabled": false }) });
const geoScene = planeGridMeasureScenes[0], areaScene = planeGridMeasureScenes[1];
const draw = (state: PlanarState, selected: string | null = null, operation?: string, locale = "zh") => renderToStaticMarkup(createElement("svg", null, (state.sceneId === "34-create" ? geoScene : areaScene).draw(state, api(selected, operation, locale))));

describe("开放钉板与面积单位：材料、格点和准确终点", () => {
  it.each(["34-create", "11-create"] as const)("%s 有严格默认材料，空白现场仍可保存", (sceneId) => {
    const state = createGridMeasureState(sceneId); valid(state);
    expect(gridPolygons(state)).toHaveLength(1); expect(unitSquares(state)).toHaveLength(0);
    expect(state.flags.measures).toBe(false); expect(state.flags.height).toBe(false); expect(state.flags.grid).toBe(false);
    const empty = removeGridMaterial(state); valid(empty); expect(gridMaterials(empty)).toHaveLength(0); expect(empty.params.active).toBe(-1);
  });

  it("40舞台单位严格等于一格，支持半格面积的最小格点三角形", () => {
    expect(gridToStage({ x: 1, y: 1 })).toEqual({ x: GRID_ORIGIN.x + 40, y: GRID_ORIGIN.y + 40 });
    expect(stageToGrid(gridToStage({ x: 3.25, y: 4.5 }))).toEqual({ x: 3.25, y: 4.5 });
    const state = addGridPolygon(blank(), [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]); valid(state);
    expect(polygonArea(polygon(state).vertices)).toBe(0.5);
    expect(polygonPerimeter(polygon(state).vertices)).toBeCloseTo(2 + Math.SQRT2);
    expect(latticeCounts(polygon(state).vertices)).toMatchObject({ area: 0.5, pickArea: 0.5, inside: [] });
  });

  it("草稿点投影与创建终点相同，偏离原始点击的可见首钉点仍可作为闭合位置", () => {
    const state = blank(), raw = gridToStage({ x: 2.49, y: 3.49 }), first = projectGridPoint(raw, state);
    expect(Math.hypot(first.x - raw.x, first.y - raw.y)).toBeGreaterThan(14);
    expect(first).toEqual(gridToStage({ x: 2, y: 3 })); expect(projectGridPoint(first, state)).toEqual(first);
    const projected = constructGridMaterial(state, "polygon", [raw, gridToStage({ x: 5.2, y: 3.1 }), gridToStage({ x: 3.2, y: 7.1 })]); valid(projected);
    expect(gridToStage(polygon(projected).vertices[0])).toEqual(first);
    const free = setGridFlag(blank(false), "snap", false); expect(projectGridPoint(raw, free)).toEqual(raw);
    expect(geoScene.construction!.projectPoint).toBe(projectGridPoint); expect(areaScene.construction!.projectPoint).toBe(projectGridPoint);
  });

  it("自绘与快捷材料追加到当前现场，不重置先前图形及观察", () => {
    const first = setGridFlag(addGridPolygon(blank(), concave), "height", true), original = structuredClone(first);
    const drawn = constructGridMaterial(first, "polygon", [{ x: 7.2, y: 2.1 }, { x: 11.1, y: 2.2 }, { x: 8.2, y: 6.2 }].map(gridToStage)); valid(drawn);
    expect(gridPolygons(drawn)).toHaveLength(2); expect(gridPolygons(drawn)[0].vertices).toEqual(concave); expect(drawn.flags.height).toBe(true); expect(first).toEqual(original);
    const target = areaScene.construction!.create(createGridMeasureState("11-create"), "rectangle", [{ x: 10, y: 2 }, { x: 14, y: 6 }].map(gridToStage))!; valid(target);
    expect(gridPolygons(target)).toHaveLength(2);
  });

  it("拒绝重复点、自交、相邻回折和零面积，不用绝对面积掩盖交叉", () => {
    const invalid = [
      [{ x: 1, y: 1 }, { x: 5, y: 4 }, { x: 1, y: 4 }, { x: 4, y: 1 }],
      [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 1 }, { x: 1, y: 4 }],
      [{ x: 1, y: 1 }, { x: 4, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 4 }, { x: 1, y: 4 }],
      [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }],
    ];
    for (const points of invalid) { const state = blank(); expect(isGridPolygon(points)).toBe(false); expect(addGridPolygon(state, points)).toBe(state); }
    expect(addGridPolygon(blank(), [{ x: 1.5, y: 1 }, { x: 4, y: 1 }, { x: 1, y: 4 }])).toEqual(blank());
    expect(isValidGridMeasureState(addGridPolygon(blank(false), [{ x: 1.5, y: 1 }, { x: 4, y: 1 }, { x: 1, y: 4 }]))).toBe(true);
  });

  it("格点拖动保留自由帧，松手才取整且只改变点位", () => {
    const state = addGridPolygon(blank(), rectangle()), id = state.params.active;
    const moved = moveGridMaterial(state, `vertex.${id}.2`, gridToStage({ x: 6.3, y: 5.4 }), { x: 52, y: 56 });
    expect(isValidGridMeasureState(moved)).toBe(false); expect(polygon(moved).vertices[2]).toEqual({ x: 6.3, y: 5.4 });
    const settled = snapGridMaterial(moved, `vertex.${id}.2`)!; valid(settled);
    expect(polygon(settled).vertices[2]).toEqual({ x: 6, y: 5 });
    expect({ ...moved, points: null }).toEqual({ ...settled, points: null });
    const crossed = moveGridMaterial(state, `vertex.${id}.1`, gridToStage({ x: 0, y: 3 }), { x: -200, y: 80 }); expect(crossed).toBe(state);
    const previous = moveGridMaterial(state, `vertex.${id}.1`, gridToStage({ x: 6.2, y: 1.4 }), { x: 48, y: 16 });
    expect(moveGridMaterial(state, `vertex.${id}.1`, gridToStage({ x: 0, y: 3 }), { x: -200, y: 80 }, { previous })).toBe(previous);
  });

  it("直接抓未选中图形或边移动，受边界约束且保留形状", () => {
    const first = addGridPolygon(blank(), rectangle()), id = first.params.active;
    const state = addGridPolygon(first, rectangle(10, 5, 3, 2));
    const moved = moveGridMaterial(state, `edge.${id}.0`, gridToStage({ x: 5, y: 5 }), { x: 43, y: 17 });
    const settled = snapGridMaterial(moved, `edge.${id}.0`)!; valid(settled);
    expect(settled.params.active).toBe(id); expect(polygonArea((gridMaterial(settled, id) as GridPolygon).vertices)).toBe(12);
    expect(gridMaterial(settled, state.params.active)).toEqual(gridMaterial(state, state.params.active));
    const bounded = snapGridMaterial(moveGridMaterial(first, `object.${id}`, gridToStage({ x: 99, y: 99 }), { x: 5000, y: 5000 }), `object.${id}`)!; valid(bounded);
    expect(Math.max(...polygon(bounded).vertices.map((point) => point.x))).toBe(18); expect(Math.max(...polygon(bounded).vertices.map((point) => point.y))).toBe(12);
  });

  it("新增与删除控制点准确保留格点与面积，最短格点边没有虚构中点", () => {
    const state = addGridPolygon(blank(), rectangle()), id = state.params.active;
    const inserted = insertGridVertex(state, `edge.${id}.0`); valid(inserted);
    expect(polygon(inserted).vertices).toHaveLength(5); expect(polygon(inserted).vertices[1]).toEqual({ x: 3, y: 1 });
    expect(gridPolygonCorners(polygon(inserted).vertices)).toHaveLength(4);
    expect(polygonArea(polygon(inserted).vertices)).toBe(12);
    const removed = removeGridVertex(inserted, `vertex.${id}.1`); valid(removed); expect(polygon(removed).vertices).toEqual(polygon(state).vertices);
    const small = addGridPolygon(blank(), [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]);
    expect(insertGridVertex(small, `edge.${small.params.active}.0`)).toBe(small);
    expect(removeGridVertex(small, `vertex.${small.params.active}.1`)).toBe(small);
  });

  it("凹图形与共线控制点按真实面积分割，分片移动后可拼回与准确恢复", () => {
    let state = addGridPolygon(blank(), concave); state = insertGridVertex(state, `edge.${state.params.active}.0`);
    const triangles = gridTriangles(polygon(state).vertices); expect(triangles).toHaveLength(4);
    expect(triangles.reduce((total, triangle) => total + polygonArea(triangle), 0)).toBe(7);
    const split = separateGridPolygon(state); valid(split); expect(polygon(split).offsets).toHaveLength(4);
    const middle = interpolateGridSeparation(state, split, 0.5); valid(middle);
    expect(polygon(middle).offsets[0].x).toBeCloseTo(polygon(split).offsets[0].x / 2);
    const moved = moveGridMaterial(split, `part.${split.params.active}.0`, { x: 400, y: 400 }, { x: 53, y: -25 }); valid(moved);
    expect(polygon(moved).vertices).toEqual(concave.slice(0, 1).concat([{ x: 3, y: 1 }], concave.slice(1)));
    const restored = separateGridPolygon(moved); valid(restored);
    expect(polygon(restored).split).toBe(false); expect(Object.keys(restored.points).some((key) => key.startsWith("part."))).toBe(false);
    expect(polygon(restored).vertices).toEqual(polygon(state).vertices);
    const reverseMiddle = interpolateGridSeparation(moved, restored, 0.5); valid(reverseMiddle);
    expect(polygon(reverseMiddle).offsets[0].x).toBeCloseTo(polygon(moved).offsets[0].x / 2);
    expect(interpolateGridSeparation(moved, restored, 1)).toEqual(restored);
  });

  it("单位方格可按任意位置点放、连续搬动、复制与移去", () => {
    let state = setGridFlag(blank(false), "snap", false);
    state = constructGridMaterial(state, "unit-square", [gridToStage({ x: 1.2, y: 3.4 })]); valid(state);
    const id = state.params.active, moved = moveGridMaterial(state, `tile.${id}`, { x: 0, y: 0 }, { x: 20, y: -16 }); valid(moved);
    expect(unitSquares(moved)[0].at.x).toBeCloseTo(1.7); expect(unitSquares(moved)[0].at.y).toBeCloseTo(3);
    expect(snapGridMaterial(moved, `tile.${id}`)).toBeNull();
    const copied = duplicateGridMaterial(moved); valid(copied); expect(unitSquares(copied)).toHaveLength(2);
    const removed = removeGridMaterial(copied); valid(removed); expect(unitSquares(removed)).toHaveLength(1); expect(removed.params.active).toBe(id);
    expect(addUnitSquare(blank())).toEqual(blank());
  });

  it("重新开启吸附后搬动自由目标，吸附平移不改变多边形轮廓", () => {
    const vertices = [{ x: 1.2, y: 1.3 }, { x: 3.7, y: 1.3 }, { x: 2.1, y: 3.9 }], state = addGridPolygon(blank(false), vertices), id = state.params.active;
    const shifted = moveGridMaterial(state, `object.${id}`, { x: 200, y: 200 }, { x: 17, y: 13 }), settled = snapGridMaterial(shifted, `object.${id}`)!; valid(settled);
    expect(polygonArea(polygon(settled).vertices)).toBeCloseTo(polygonArea(vertices));
    expect(polygonPerimeter(polygon(settled).vertices)).toBeCloseTo(polygonPerimeter(vertices));
    expect(polygon(settled).vertices[0]).toEqual({ x: 2, y: 2 });
  });

  it("cm/dm 换算仅改变读数，1dm²等于100cm²且平方因子一致", () => {
    const state = addUnitSquare(addGridPolygon(blank(false), rectangle(1, 1, 10, 10)), { x: 1, y: 1 });
    const converted = setGridField(state, "unit", 2); valid(converted); expect(converted.points).toEqual(state.points);
    expect(gridUnits(state)).toMatchObject({ factor: 1, areaFactor: 1, area: "cm²" });
    expect(gridUnits(converted)).toMatchObject({ factor: 0.1, areaFactor: 0.01, area: "dm²" });
    expect(polygonArea(gridPolygons(converted)[0].vertices) * gridUnits(converted).areaFactor).toBe(1);
    expect(GRID_SCALE * gridUnits(converted).factor).toBe(4);
  });
});

describe("单位方格真实覆盖：并集、裁剪与凹区域", () => {
  it("重复方格、半格重叠与越界不重复计算目标覆盖", () => {
    const squares = [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0, y: 0 }, { x: 3, y: 3 }], cells = unitSquareUnion(squares);
    expect(cells.reduce((sum, cell) => sum + cell.width * cell.height, 0)).toBeCloseTo(2.5);
    const coverage = gridCoverage(rectangle(0, 0, 2, 2), cells);
    expect(coverage).toMatchObject({ area: 4, covered: 1.5, uncovered: 2.5, outside: 1 });
    expect(coverage.pieces.reduce((area, piece) => area + polygonArea(piece), 0)).toBeCloseTo(1.5);
  });

  it("部分覆盖由多边形裁剪计算，不把碰到目标的整块算成一平方单位", () => {
    const triangle = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }];
    expect(gridCoverage(triangle, unitSquareUnion([{ x: 0, y: 0 }]))).toMatchObject({ area: 0.5, covered: 0.5, outside: 0.5 });
    expect(gridCoverage(triangle, unitSquareUnion([{ x: 0.5, y: 0 }])).covered).toBeCloseTo(0.125);
    expect(gridCoverage(triangle, unitSquareUnion([{ x: 1, y: 0 }])).covered).toBe(0);
  });

  it("凹口不算覆盖，平移和方向翻转保持计算结果", () => {
    const cells = unitSquareUnion([{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 1.5, y: 1.5 }]), coverage = gridCoverage(concave, cells);
    expect(coverage.covered).toBeCloseTo(1.5); expect(coverage.area).toBe(7);
    expect(gridCoverage([...concave].reverse(), cells).covered).toBeCloseTo(coverage.covered);
    const offset = { x: 4.3, y: 2.7 }, moved = concave.map((point) => ({ x: point.x + offset.x, y: point.y + offset.y }));
    expect(gridCoverage(moved, cells.map((cell) => ({ ...cell, x: cell.x + offset.x, y: cell.y + offset.y }))).covered).toBeCloseTo(coverage.covered);
  });

  it("100块单位方格可以铺成100cm²；整排追加仍保持每块独立", () => {
    let state = blank(false);
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) state = addUnitSquare(state, { x, y });
    valid(state); expect(unitSquares(state)).toHaveLength(100); expect(addUnitSquare(state)).toBe(state);
    const coverage = gridCoverage(rectangle(0, 0, 10, 10), unitSquareUnion(unitSquares(state).map((square) => square.at)));
    expect(coverage).toMatchObject({ area: 100, covered: 100, uncovered: 0, outside: 0 });
    const row = addUnitRow(blank(false)); valid(row); expect(unitSquares(row)).toHaveLength(10); expect(new Set(unitSquares(row).map((square) => square.id)).size).toBe(10);
  });
});

describe("v2 严格合同及工作台公共入口", () => {
  it("限制目标、控制点总数与有效引用", () => {
    let state = blank();
    for (let i = 0; i < 4; i++) state = addGridPolygon(state, rectangle(i, i));
    valid(state); expect(addGridPolygon(state, rectangle())).toBe(state);
    const shape = Array.from({ length: 32 }, (_, i) => ({ x: 8 + 3 * Math.cos(i * Math.PI / 16), y: 6 + 3 * Math.sin(i * Math.PI / 16) }));
    let large = blank(false); for (let i = 0; i < 3; i++) large = addGridPolygon(large, shape); valid(large);
    expect(addGridPolygon(large, rectangle())).toBe(large);
  });

  it.each([
    ["未知顶层键", (s: PlanarState) => Object.assign(s, { area: 4 })],
    ["未知参数", (s: PlanarState) => { s.params.hidden = 2; }],
    ["未知点位", (s: PlanarState) => { s.points.draft = { x: 1, y: 2 }; }],
    ["未知开关", (s: PlanarState) => { s.flags.answer = true; }],
    ["不存在的对象", (s: PlanarState) => { s.params.active = 900; }],
    ["越过nextId", (s: PlanarState) => { s.params.nextId = s.params.active; }],
    ["非整数格点", (s: PlanarState) => { s.points[`v.${s.params.active}.0`].x = 3.2; }],
    ["越界", (s: PlanarState) => { s.points[`v.${s.params.active}.0`].x = -1; }],
    ["缺失顶点", (s: PlanarState) => { delete s.points[`v.${s.params.active}.0`]; }],
    ["错误底边", (s: PlanarState) => { s.params[`base.${s.params.active}`] = 4; }],
    ["缺失分片", (s: PlanarState) => { s.params[`split.${s.params.active}`] = 1; }],
    ["幽灵分片", (s: PlanarState) => { s.points[`part.${s.params.active}.0`] = { x: 0, y: 0 }; }],
    ["非有限数", (s: PlanarState) => { s.params.unit = NaN; }],
    ["伪造流程", (s: PlanarState) => { s.phase = 0.5; }],
    ["伪造标记", (s: PlanarState) => { s.marks = ["answer"]; }],
    ["公共30px网格", (s: PlanarState) => { s.flags.grid = true; }],
    ["旧场景", (s: PlanarState) => { s.sceneId = "34"; }],
  ] as const)("拒绝%s", (_name, mutate) => {
    const state = createGridMeasureState("34-create"); mutate(state); expect(isValidGridMeasureState(state)).toBe(false);
  });

  it("保存再读保留材料、观察、分片和单位，没有派生面积缓存", () => {
    const state = setGridFlag(separateGridPolygon(addGridPolygon(blank(), concave)), "relation", true), restored = JSON.parse(JSON.stringify(state)); valid(restored);
    expect(restored).toEqual(state); expect(Object.keys(state)).toEqual(["sceneId", "params", "points", "flags", "marks", "phase"]);
    const old = structuredClone(state), moved = moveGridMaterial(state, `part.${state.params.active}.1`, { x: 500, y: 400 }, { x: 40, y: 40 }); valid(moved); expect(state).toEqual(old);
  });

  it("同一现场添加能力且就近动作引用公共动作/面板，编辑柄仅在编辑面板出现", () => {
    for (const scene of planeGridMeasureScenes) {
      expect(scene.referenceGrid).toBe(false);
      const state = scene.create(), selected = `object.${state.params.active}`;
      const contexts = scene.contextActions!(state, selected)!;
      const actions = [...scene.actions!, ...scene.operations!.flatMap((operation) => operation.actions ?? [])];
      for (const item of contexts.items) expect(item.kind === "action" ? actions.some((action) => action.id === item.id) : scene.operations!.some((operation) => operation.id === item.id)).toBe(true);
      expect(scene.contextActions!(state, null)).toBeNull();
      expect(draw(state, selected)).not.toContain("data-grid-editing");
      expect(draw(state, selected, "edit")).toContain("data-grid-editing");
      expect(draw(state, selected, "move")).not.toContain("data-grid-editing");
      const added = scene.materials![0].add(state); valid(added); expect(gridMaterials(added).length).toBeGreaterThan(gridMaterials(state).length);
    }
  });

  it("高使用公共垂线与标准直角标记，底边改变后仍由真实点计算", () => {
    const state = setGridFlag(addGridPolygon(blank(), [{ x: 2, y: 4 }, { x: 6, y: 2 }, { x: 8, y: 7 }]), "height", true), id = state.params.active;
    const markup = draw(state, `object.${id}`); expect(markup).toContain('data-height-mark="true"'); expect(markup).toContain('data-right-angle="true"');
    const changed = tapGridMaterial(state, `edge.${id}.1`); valid(changed); expect(polygon(changed).base).toBe(1);
    const measured = draw(setGridFlag(changed, "measures", true), `object.${id}`, undefined, "en"); expect(measured).toContain("h ="); expect(measured).toContain("S =");
  });

  it("单位面积与覆盖读数默认关闭，按需叠加且两个语言有明确比例", () => {
    const state = addUnitSquare(createGridMeasureState("11-create"), { x: 3, y: 3 });
    expect(draw(state)).not.toContain("已覆盖"); expect(draw(state)).toContain("40 舞台单位");
    const shown = setGridFlag(setGridFlag(state, "measures", true), "coverage", true);
    expect(draw(shown)).toContain("已覆盖"); expect(draw(shown)).toContain('data-unit-coverage="1"'); expect(draw(shown, null, undefined, "en")).toContain("Covered");
    expect(shown.points).toEqual(state.points);
  });

  it("选中/删除/拼回后的焦点仍指向有效材料，解析拒绝畸形target", () => {
    const state = geoScene.create(), id = state.params.active, removed = removeGridMaterial(state);
    expect(geoScene.selectionAfterChange!(state, removed, `object.${id}`)).toBeNull();
    expect(geoScene.selectionAfterChange!(state, setGridFlag(state, "measures", true), null)).toBeNull();
    const split = separateGridPolygon(state), joined = separateGridPolygon(split);
    expect(geoScene.selectionAfterChange!(split, joined, `part.${id}.0`)).toBe(`object.${id}`);
    expect(parseGridTarget("vertex.01.0")).toBeNull(); expect(parseGridTarget("object.__proto__")).toBeNull();
  });

  it("SQL只追加严格helper，工具/版本/场景成对且不修改总入口或业务数据", () => {
    const sql = readFileSync(new URL("../supabase/migrations/20261002000200_tool_plane_grid_measure.sql", import.meta.url), "utf8");
    expect(sql).toContain("tool_plane_grid_measure_state_is_valid(s jsonb)"); expect(sql).toContain("tool_plane_grid_measure_scene_is_valid(s jsonb)");
    expect(sql).toContain("plane-geoboard-lesson-v2"); expect(sql).toContain("plane-measurement-lesson-v2"); expect(sql).toContain("'34-create'"); expect(sql).toContain("'11-create'");
    expect(sql).toContain("exception when others then return false"); expect(sql).toContain("from public,anon,authenticated,service_role");
    expect(sql).not.toMatch(/create or replace|update\s+public\.|delete\s+from|tool_scene_is_valid/iu);
  });
});
