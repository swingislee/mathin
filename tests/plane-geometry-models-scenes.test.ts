import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { planeGeometryScenes } from "../src/features/tools/plane-geometry/scenes";
import { isValidPlaneGeometryState } from "../src/features/tools/plane-geometry/validation";
import { planarStateSchema } from "../src/features/tools/planar-kit/contract";
import { interpolatePlanarState } from "../src/features/tools/planar-kit/presentation";
import type { PlanarDrawingApi, PlanarSceneDefinition } from "../src/features/tools/planar-kit/types";

function api(locale = "zh"): PlanarDrawingApi {
  return { locale, selected: null, editable: true, bind: (target, label) => ({ role: "button", tabIndex: 0, "aria-label": label ?? target, "aria-pressed": false, "aria-disabled": false, onPointerDown: () => {}, onKeyDown: () => {} }) };
}
function getScene(id: string) { return planeGeometryScenes.find((scene) => scene.id === id)!; }
function render(scene: PlanarSceneDefinition, state = scene.create(), locale = "zh") {
  return renderToStaticMarkup(createElement("svg", { viewBox: "0 0 960 720" }, scene.draw(state, api(locale))));
}
const context = { selected: null };

describe("图形与测量场景：同一模型提供直接操作、准确参数和动作终点", () => {
  it("精确覆盖本批16场景，不把暂缓直尺场景09夹带进来", () => {
    expect(planeGeometryScenes.map((scene) => scene.id)).toEqual(["01", "02", "03", "04", "05", "06", "07", "08", "10", "11", "12", "13", "34", "43", "56", "60"]);
  });
  it.each(planeGeometryScenes)("$id 起点和参数极值可恢复且双语可绘制", (scene) => {
    const initial = scene.create();
    expect(planarStateSchema.safeParse(initial).success).toBe(true);
    expect(isValidPlaneGeometryState(initial)).toBe(true);
    for (const locale of ["zh", "en"]) {
      const svg = render(scene, initial, locale);
      expect(svg).not.toMatch(/NaN|Infinity/);
      expect(svg).toMatch(/<(polygon|path|line|rect|circle|ellipse)/);
    }
    for (const field of scene.fields ?? []) for (const value of [field.min, field.max]) {
      const end = scene.setField ? scene.setField(initial, field.key, value) : { ...initial, params: { ...initial.params, [field.key]: value } };
      expect(isValidPlaneGeometryState(end), `${scene.id}:${field.key}=${value}`).toBe(true);
      expect(render(scene, end)).not.toMatch(/NaN|Infinity/);
    }
  });
  it.each(planeGeometryScenes)("$id 所有已声明动作及中间帧可重建", (scene) => {
    for (const action of scene.actions ?? []) {
      const start = scene.create(), end = action.run(start, context);
      expect(planarStateSchema.safeParse(end).success, action.id).toBe(true);
      expect(isValidPlaneGeometryState(end), action.id).toBe(true);
      expect(render(scene, end)).not.toMatch(/NaN|Infinity/);
      if (action.duration) {
        const interpolate = action.interpolate ?? interpolatePlanarState;
        const middle = interpolate(start, end, 0.5);
        expect(planarStateSchema.safeParse(middle).success, action.id).toBe(true);
        expect(render(scene, middle)).not.toMatch(/NaN|Infinity/);
        expect(interpolate(start, end, 1)).toEqual(end);
        if (JSON.stringify(start) !== JSON.stringify(end)) expect(middle).not.toEqual(end);
      }
    }
  });
  it("垂距、四边形高与90°张角都调用共用规范直角标记", () => {
    expect(render(getScene("05"))).toContain('data-right-angle="true"');
    expect(render(getScene("08"))).toContain('data-right-angle="true"');
    const angle = getScene("04"), right = { ...angle.create(), params: { ...angle.create().params, angle: 90 } };
    expect(render(angle, right)).toContain('data-right-angle="true"');
    expect(render(angle)).not.toContain('data-right-angle="true"');
  });
  it("点选、直接拖片、旋转字段和±45°动作指向同一片", () => {
    const scene = getScene("02"), selected = scene.tap!(scene.create(), "piece4");
    const moved = scene.drag!(selected, "piece4", { x: 540, y: 480 }, { x: 80, y: 30 });
    expect(moved.points.piece4).toEqual({ x: 370, y: 210 });
    expect(moved.points.piece3).toEqual({ x: 290, y: 180 });
    const rotated = scene.actions!.find((action) => action.id === "piece-right")!.run(moved, { selected: "piece4" });
    expect(rotated.params.angle4).toBe(45); expect(rotated.params.rotation).toBe(45);
    expect(scene.setField!(rotated, "rotation", 120).params.angle4).toBe(120);
  });
  it("翻面保留真实中间投影而不是旗标瞬切", () => {
    const scene = getScene("02"), action = scene.actions!.find((item) => item.id === "piece-mirror")!, start = scene.create(), end = action.run(start, context);
    expect(start.params.reflection0).toBe(1); expect(end.params.reflection0).toBe(-1);
    expect(interpolatePlanarState(start, end, 0.5).params.reflection0).toBe(0);
  });
  it("形状点拖动真实改变角、距、杆长、底高、周长或钟针参数", () => {
    const cases = [
      ["03", "via", { x: 480, y: 410 }], ["04", "rayB", { x: 340, y: 200 }], ["05", "q", { x: 250, y: 475 }],
      ["06", "body", { x: 600, y: 485 }], ["07", "c", { x: 600, y: 180 }], ["08", "vertex1", { x: 610, y: 500 }],
      ["10", "size", { x: 510, y: 325 }], ["12", "resize", { x: 666, y: 400 }], ["13", "b", { x: 720, y: 350 }],
      ["34", "v0", { x: 210, y: 160 }], ["43", "notch", { x: 320, y: 315 }], ["60", "minute", { x: 660, y: 350 }],
    ] as const;
    for (const [id, target, point] of cases) {
      const scene = getScene(id), before = scene.create(), after = scene.drag!(before, target, point, { x: 60, y: 30 });
      expect(after, `${id}:${target}`).not.toEqual(before);
      expect(isValidPlaneGeometryState(after), `${id}:${target}`).toBe(true);
    }
  });
  it("手铺后继续铺满不遗留反选空洞；缩小网格清理越界标记", () => {
    const scene = getScene("11"), handFilled = scene.tap!(scene.create(), "cell3"), action = scene.actions!.find((item) => item.id === "unit-square-fill")!;
    const target = action.run(handFilled, context), middle = action.interpolate!(handFilled, target, 0.5);
    expect(middle.marks).toContain("cell3");
    expect(target.params.filled).toBe(12); expect(target.marks).toEqual([]);
    const shrunk = scene.setField!(target, "columns", 1);
    expect(shrunk.params.filled).toBe(3); expect(isValidPlaneGeometryState(shrunk)).toBe(true);
  });
  it("锁长时三角形只整体移动；四杆仍可以推斜而不改边长", () => {
    const scene = getScene("06"), start = scene.create();
    expect(scene.drag!(start, "left", { x: 600, y: 200 }, { x: 40, y: 20 })).toEqual(start);
    const moved = scene.drag!(start, "body", { x: 600, y: 200 }, { x: 40, y: 20 });
    expect(moved.params).toEqual(start.params); expect(moved.points.origin).toEqual({ x: 310, y: 505 });
    const frame = { ...start, flags: { ...start.flags, frame: true } }, sheared = scene.drag!(frame, "joint", { x: 400, y: 250 }, { x: 40, y: 20 });
    expect(sheared.params.opening).not.toEqual(frame.params.opening);
    expect(sheared.params.base).toBe(frame.params.base); expect(sheared.params.left).toBe(frame.params.left);
  });
  it("已拆三角片可独立移动且放回时从现位置连续回原形", () => {
    const scene = getScene("56"), action = scene.actions![0], split = action.run(scene.create(), context);
    const moved = scene.drag!(split, "part0", { x: 400, y: 300 }, { x: 60, y: 15 });
    expect(moved.points.part0).toBeDefined();
    const to = action.run(moved, context), midway = action.interpolate!(moved, to, 0.5);
    expect(midway.points.part0.x).toBeCloseTo(moved.points.part0.x / 2);
    expect(midway.points.part0.y).toBeCloseTo(moved.points.part0.y / 2);
    expect(to.points.part0).toBeUndefined(); expect(to.phase).toBe(0);
  });
  it("保存参数缺失、动态数量超限、格点自交会失败而非悄悄换成默认图", () => {
    const paper = getScene("01").create();
    expect(isValidPlaneGeometryState({ ...paper, params: {} })).toBe(false);
    expect(isValidPlaneGeometryState({ ...paper, params: { ...paper.params, count: 500 } })).toBe(false);
    const lattice = getScene("34").create();
    expect(isValidPlaneGeometryState({ ...lattice, points: { ...lattice.points, v0: { x: 1.5, y: 2 } } })).toBe(false);
    expect(isValidPlaneGeometryState({ ...lattice, points: { ...lattice.points, v0: lattice.points.v3 } })).toBe(false);
  });
});
