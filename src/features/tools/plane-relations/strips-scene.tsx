import type { PlanarPoint, PlanarState } from "../planar-kit/contract";
import { textFor, type PlanarAction, type PlanarDrawingApi, type PlanarField, type PlanarSceneDefinition } from "../planar-kit/types";
import { constructionObjects, parseConstructionTarget } from "../plane-construction/model";
import { between } from "./geometry";
import { relationFlag } from "./model";
import { planeInteriorScene as base } from "./interior-scene";
import { angleObjectTarget } from "./angle-scene";
import { STRIPS_SCENE_ID, stripsBaseState } from "./strips-validation";
import { applyStripsBase, copySquareStrips, createStripsState, refineStrips, setStripCount, squareStripModel, toggleStrips } from "./strips-model";

const t = (zh: string, en: string) => ({ zh, en });
const coordinates = (points: readonly PlanarPoint[]) => points.map((point) => `${point.x},${point.y}`).join(" ");
const fmt = (value: number) => Number(value.toFixed(2)).toString();
const wrapField = (field: PlanarField): PlanarField => ({ ...field,
  read: field.read ? (state) => field.read!(stripsBaseState(state)) : undefined,
  disabled: field.disabled ? (state) => field.disabled!(stripsBaseState(state)) : undefined,
});
const wrapAction = (action: PlanarAction): PlanarAction => ({ ...action,
  run: (state, context) => applyStripsBase(state, (inner) => action.run(inner, context), action.id === "construction-duplicate" ? state.params.active : undefined),
  active: action.active ? (state) => action.active!(stripsBaseState(state)) : undefined,
  disabled: action.disabled ? (state, context) => action.disabled!(stripsBaseState(state), context) : undefined,
  interpolate: action.interpolate ? (from, to, progress) => {
    if (progress <= 0) return from;
    if (progress >= 1) return to;
    return applyStripsBase(from, (inner) => action.interpolate!(inner, stripsBaseState(to), progress), action.id === "construction-duplicate" ? from.params.active : undefined);
  } : undefined,
});

export function SquareStripsOverlay({ state, api }: { state: PlanarState; api: PlanarDrawingApi }) {
  const target = angleObjectTarget(api.selected), selected = target ? parseConstructionTarget(target)?.id : undefined;
  const active = squareStripModel(state, selected ?? state.params.active), operating = api.operation === "relations-strips";
  const observing = active && relationFlag(state, "strips", active.object.id);
  return <g data-square-strips-overlay pointerEvents="none">
    {constructionObjects(state).map((object) => {
      const model = relationFlag(state, "strips", object.id) && squareStripModel(state, object.id);
      if (!model) return null;
      return <g key={object.id} data-square-strips-object={object.id}>
        {model.strips.map((strip) => {
          const [a, b, c, d] = strip.points;
          const grid = Array.from({ length: strip.count - 1 }, (_, index) => {
            const first = between(a, b, (index + 1) / strip.count), last = between(d, c, (index + 1) / strip.count);
            return `M ${first.x} ${first.y} L ${last.x} ${last.y}`;
          }).join(" ");
          return <g key={strip.row} data-square-strip={strip.row} data-square-count={strip.count}>
            <polygon points={coordinates(strip.points)} fill={strip.row % 2 ? "var(--moon)" : "var(--leaf)"} fillOpacity="0.72" stroke="var(--muted)" strokeWidth="1" />
            <path d={grid} fill="none" stroke="var(--muted)" strokeWidth="0.65" />
          </g>;
        })}
        <polygon points={coordinates(model.points)} fill="none" stroke="var(--ink)" strokeWidth="2" data-square-strip-outline />
      </g>;
    })}
    {(operating || observing && state.flags.measures) && <g fill="var(--ink)" stroke="var(--paper)" strokeWidth="4" paintOrder="stroke" fontSize="14" data-square-strip-caption>
      {operating && <>
        <text x="28" y="32">{textFor(t("正方形条带是阶梯近似，不是三角形的精确切片或完整内覆盖。", "Square strips form an approximation, not an exact dissection or an inner cover."), api.locale)}</text>
        <text x="28" y="56">{textFor(t("底和高固定时，沿等高线移动对顶点，各条只平移。", "With base and height fixed, moving the apex along its parallel line only slides the strips."), api.locale)}</text>
      </>}
      {observing && state.flags.measures && <>
        <text x="28" y={operating ? 80 : 32} data-square-strip-measures>{textFor(t(`材料 ${active.object.id + 1}`, `Shape ${active.object.id + 1}`), api.locale)} · {textFor(t("方格边长", "Square side"), api.locale)} ≈ {fmt(active.size)} u · {active.squareCount} {textFor(t("格", "squares"), api.locale)} · {textFor(t("近似条面积", "Strip approximation"), api.locale)} ≈ {fmt(active.approximateArea)} u² · S△ ≈ {fmt(active.area)} u²</text>
      </>}
      {operating && <text x="28" y={observing && state.flags.measures ? 104 : 80}>{textFor(!active ? t("选中三角形以开启条带；凸四边形保留原有操作。", "Select a triangle to add strips. Quadrilaterals keep their existing operations.")
        : !observing ? t("开启正方形条带后，可继续细分或复制独立条片。", "Show square strips, then refine or copy them as independent materials.")
          : !active.strips.length ? t("当前密度还不能形成完整方格条，请继续细分。", "This density yields no complete square strips. Refine further.")
            : t("复制时每条成为一张材料；容量不足时降低密度或移去材料。", "Each copied strip uses one material slot. Reduce density or remove materials if full."), api.locale)}</text>}
    </g>}
  </g>;
}

export const planeStripsScene: PlanarSceneDefinition = {
  ...base, id: STRIPS_SCENE_ID, create: createStripsState,
  description: t("在自己的三角形上开启正方形条带并逐级细分，比较近似面积与真实面积。底和高固定时，沿等高线移动顶点，各条只平移。条带可复制为独立矩形材料，原三角形保持；底、高、内点、共角与相似操作继续保留。", "Show square strips on your own triangle, refine them and compare approximate and exact areas. With a fixed base and height, sliding the apex only translates each strip. Copy strips as independent rectangles while keeping the triangle. Existing base, altitude, interior, common-angle and similarity operations remain."),
  fields: base.fields?.map(wrapField),
  setField: (state, key, value) => key === "stripDivisions" ? setStripCount(state, value) : applyStripsBase(state, (inner) => base.setField!(inner, key, value)),
  setFlag: base.setFlag ? (state, key, value) => applyStripsBase(state, (inner) => base.setFlag!(inner, key, value)) : undefined,
  actions: base.actions?.map(wrapAction),
  materials: base.materials?.map((material) => ({ ...material,
    add: (state) => applyStripsBase(state, material.add), disabled: material.disabled ? (state) => material.disabled!(stripsBaseState(state)) : undefined,
  })),
  operations: [
    { id: "relations-strips", icon: "grid", label: t("正方形条带与细分", "Square strips and refinement"),
      fields: [{ key: "stripDivisions", label: t("细分密度（底与高中较长者的等分数）", "Density (divisions of the longer base or height)"), min: 4, max: 48, step: 1,
        read: (state) => state.params[`stripCount.${state.params.active}`] ?? 16, disabled: (state) => !squareStripModel(state) }],
      actions: [
        { id: "relations-square-strips", icon: "grid", label: t("显示正方形条带", "Show square strips"), active: (state) => relationFlag(state, "strips"), disabled: (state) => !squareStripModel(state), run: toggleStrips },
        { id: "relations-refine-strips", icon: "increase", label: t("继续细分方格条", "Refine the square strips"), disabled: (state) => refineStrips(state) === state, run: refineStrips },
        { id: "relations-copy-strips", icon: "duplicate", label: t("复制近似条为独立材料", "Copy approximate strips as independent materials"), disabled: (state) => copySquareStrips(state) === state, run: copySquareStrips },
      ] },
    ...base.operations!.map((operation) => ({ ...operation, fields: operation.fields?.map(wrapField), actions: operation.actions?.map(wrapAction) })),
  ],
  construction: { ...base.construction!,
    tools: base.construction!.tools.map((tool) => ({ ...tool, disabled: tool.disabled ? (state) => tool.disabled!(stripsBaseState(state)) : undefined })),
    create: (state, tool, points) => { const result = applyStripsBase(state, (inner) => base.construction!.create(inner, tool, points) ?? inner); return result === state ? null : result; },
  },
  drag: base.drag ? (state, target, point, delta, context) => applyStripsBase(state, (inner) => base.drag!(inner, target, point, delta, context?.previous ? { previous: stripsBaseState(context.previous) } : undefined)) : undefined,
  tap: base.tap ? (state, target) => applyStripsBase(state, (inner) => base.tap!(inner, target)) : undefined,
  snap: base.snap ? (state, target) => { const result = applyStripsBase(state, (inner) => base.snap!(inner, target) ?? inner); return result === state ? null : result; } : undefined,
  selectionAfterChange: base.selectionAfterChange ? (before, after, selected) => base.selectionAfterChange!(stripsBaseState(before), stripsBaseState(after), selected) : undefined,
  contextActions: (state, selected) => {
    const context = base.contextActions?.(stripsBaseState(state), selected);
    return context ? { ...context, items: context.items.map((item) => item.id === "relations-common-angle" ? { ...item, id: "relations-strips" } : item) } : null;
  },
  draw: (state, api) => <g data-plane-strips="true">{base.draw(stripsBaseState(state), api)}<SquareStripsOverlay state={state} api={api} /></g>,
};
