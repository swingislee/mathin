import type { PlanarPoint, PlanarState } from "../planar-kit/contract";
import { textFor, type PlanarAction, type PlanarDrawingApi, type PlanarField, type PlanarSceneDefinition } from "../planar-kit/types";
import { constructionObjects, parseConstructionTarget } from "../plane-construction/model";
import { regionPath } from "./geometry";
import { relationFlag } from "./model";
import { angleObjectTarget } from "./angle-scene";
import { planeStripsScene as base } from "./strips-scene";
import { COVERAGE_SCENE_ID, coverageBaseState } from "./coverage-validation";
import { applyCoverageBase, canCoverCells, cellCoverageModel, createCoverageState, refineCoverCells, setCoverCount, toggleCoverCells } from "./coverage-model";

const t = (zh: string, en: string) => ({ zh, en });
const coordinates = (points: readonly PlanarPoint[]) => points.map((point) => `${point.x},${point.y}`).join(" ");
const fmt = (value: number) => Number(value.toFixed(2)).toString();
const wrapField = (field: PlanarField): PlanarField => ({ ...field,
  read: field.read ? (state) => field.read!(coverageBaseState(state)) : undefined,
  disabled: field.disabled ? (state) => field.disabled!(coverageBaseState(state)) : undefined,
});
const wrapAction = (action: PlanarAction): PlanarAction => ({ ...action,
  run: (state, context) => applyCoverageBase(state, (inner) => action.run(inner, context), action.id === "construction-duplicate" ? state.params.active : undefined),
  active: action.active ? (state) => action.active!(coverageBaseState(state)) : undefined,
  disabled: action.disabled ? (state, context) => action.disabled!(coverageBaseState(state), context) : undefined,
  interpolate: action.interpolate ? (from, to, progress) => {
    if (progress <= 0) return from;
    if (progress >= 1) return to;
    return applyCoverageBase(from, (inner) => action.interpolate!(inner, coverageBaseState(to), progress), action.id === "construction-duplicate" ? from.params.active : undefined);
  } : undefined,
});

export function CellCoverageOverlay({ state, api }: { state: PlanarState; api: PlanarDrawingApi }) {
  const target = angleObjectTarget(api.selected), selected = target ? parseConstructionTarget(target)?.id : undefined;
  const id = selected ?? state.params.active, operating = api.operation === "relations-cell-coverage";
  const models = constructionObjects(state).flatMap((object) => {
    const model = relationFlag(state, "coverCells", object.id) && cellCoverageModel(state, object.id);
    return model ? [model] : [];
  });
  const active = models.find((model) => model.object.id === id), lang = (text: ReturnType<typeof t>) => textFor(text, api.locale);
  return <g data-cell-coverage-overlay pointerEvents="none">
    {models.map((model) => <g key={model.object.id} data-cell-coverage-object={model.object.id}>
      {(["full", "boundary"] as const).map((kind) => {
        const cells = model.cells.filter((cell) => cell.kind === kind);
        // 每类合并为一个 SVG path，满容量与最高密度也只产生两个网格绘制节点。
        return <path key={kind} data-cell-coverage-kind={kind} data-cell-count={cells.length}
          d={regionPath(cells.map((cell) => cell.points))} fill={kind === "full" ? "var(--leaf)" : "var(--moon)"}
          fillOpacity="0.6" stroke="var(--muted)" strokeWidth="0.8" />;
      })}
      <polygon points={coordinates(model.points)} fill="none" stroke="var(--ink)" strokeWidth="2" data-cell-coverage-outline />
    </g>)}
    {(operating || active && state.flags.measures) && <g fill="var(--ink)" stroke="var(--paper)" strokeWidth="4" paintOrder="stroke" fontSize="13" data-cell-coverage-caption>
      {operating && <>
        <text x="28" y="132">{lang(t("方格沿所选底边排列；密度按真实投影宽高中较长者等分。", "The grid follows the selected base; density divides the longer projected width or height."))}</text>
        <text x="28" y="154">{lang(t("绿色是完整格，黄色是有正面积交集的边界格；仅点或边接触不计入。", "Green: full cells. Gold: boundary cells with positive overlap. Touching alone does not count."))}</text>
      </>}
      {active && state.flags.measures && <g data-cell-coverage-measures>
        <text x="28" y={operating ? 176 : 132}>{lang(t(`材料 ${active.object.id + 1}`, `Shape ${active.object.id + 1}`))} · {lang(t("方格边长", "Square side"))} ≈ {fmt(active.size)} u · {lang(t("完整格", "Full cells"))} {active.fullCount} · {lang(t("边界格", "Boundary cells"))} {active.boundaryCount}</text>
        <text x="28" y={operating ? 198 : 154}>{lang(t("内覆盖", "Inner cover"))} ≈ {fmt(active.innerArea)} u² ≤ S△ ≈ {fmt(active.area)} u² ≤ {lang(t("外覆盖", "Outer cover"))} ≈ {fmt(active.outerArea)} u²</text>
      </g>}
      {operating && !active && <text x="28" y="176">{lang(canCoverCells(state)
        ? t("开启完整格与边界格覆盖，再继续细分；原条带观察可独立开关。", "Show cell coverage, then refine. Square-strip observation has its own switch.")
        : t("选中三角形以开启覆盖；凸四边形保留原有操作。", "Select a triangle for cell coverage. Quadrilaterals keep their existing operations."))}</text>}
    </g>}
  </g>;
}

export const planeCoverageScene: PlanarSceneDefinition = {
  ...base, id: COVERAGE_SCENE_ID, create: createCoverageState,
  description: t("沿三角形的真实底边开启完整格与边界格覆盖，逐级细分并比较内覆盖、原形和外覆盖面积。密度按实际投影宽高中较长者等分，旋转、镜像与换底均跟随真实几何。条带、底高、内点、共角及相似操作继续保留。", "Show full and boundary cells along the triangle’s actual base, refine the grid and compare inner cover, triangle and outer cover areas. Density divides the longer projected width or height, following rotation, reflection and base changes. Square strips, base, altitude, interior, common-angle and similarity operations remain."),
  fields: base.fields?.map(wrapField),
  setField: (state, key, value) => key === "coverDivisions" ? setCoverCount(state, value) : applyCoverageBase(state, (inner) => base.setField!(inner, key, value)),
  setFlag: base.setFlag ? (state, key, value) => applyCoverageBase(state, (inner) => base.setFlag!(inner, key, value)) : undefined,
  actions: base.actions?.map(wrapAction),
  materials: base.materials?.map((material) => ({ ...material,
    add: (state) => applyCoverageBase(state, material.add), disabled: material.disabled ? (state) => material.disabled!(coverageBaseState(state)) : undefined,
  })),
  operations: [
    { id: "relations-cell-coverage", icon: "grid", label: t("完整格与边界格覆盖", "Full and boundary cell coverage"),
      fields: [{ key: "coverDivisions", label: t("覆盖密度（投影宽高中较长者的等分数）", "Coverage density (divisions of the longer projected extent)"), min: 4, max: 48, step: 1,
        read: (state) => state.params[`coverCount.${state.params.active}`] ?? 16, disabled: (state) => !canCoverCells(state) }],
      actions: [
        { id: "relations-cover-cells", icon: "grid", label: t("显示完整格与边界格", "Show full and boundary cells"), active: (state) => relationFlag(state, "coverCells"), disabled: (state) => !canCoverCells(state), run: toggleCoverCells },
        { id: "relations-refine-cover-cells", icon: "increase", label: t("继续细分覆盖方格", "Refine the coverage grid"), disabled: (state) => refineCoverCells(state) === state, run: refineCoverCells },
      ] },
    ...base.operations!.map((operation) => ({ ...operation, fields: operation.fields?.map(wrapField), actions: operation.actions?.map(wrapAction) })),
  ],
  construction: { ...base.construction!,
    tools: base.construction!.tools.map((tool) => ({ ...tool, disabled: tool.disabled ? (state) => tool.disabled!(coverageBaseState(state)) : undefined })),
    projectPoint: base.construction!.projectPoint ? (point, state) => base.construction!.projectPoint!(point, coverageBaseState(state)) : undefined,
    preview: (tool, points, state) => base.construction!.preview(tool, points, state ? coverageBaseState(state) : undefined),
    create: (state, tool, points) => { const result = applyCoverageBase(state, (inner) => base.construction!.create(inner, tool, points) ?? inner); return result === state ? null : result; },
  },
  drag: base.drag ? (state, target, point, delta, context) => applyCoverageBase(state, (inner) => base.drag!(inner, target, point, delta, context?.previous ? { previous: coverageBaseState(context.previous) } : undefined)) : undefined,
  tap: base.tap ? (state, target) => applyCoverageBase(state, (inner) => base.tap!(inner, target)) : undefined,
  snap: base.snap ? (state, target) => { const result = applyCoverageBase(state, (inner) => base.snap!(inner, target) ?? inner); return result === state ? null : result; } : undefined,
  selectionAfterChange: base.selectionAfterChange ? (before, after, selected) => base.selectionAfterChange!(coverageBaseState(before), coverageBaseState(after), selected) : undefined,
  summary: base.summary ? (state, locale) => base.summary!(coverageBaseState(state), locale) : undefined,
  contextActions: (state, selected) => {
    const context = base.contextActions?.(coverageBaseState(state), selected);
    return context ? { ...context, items: context.items.map((item) => item.id === "relations-strips" ? { ...item, id: "relations-cell-coverage" } : item) } : null;
  },
  draw: (state, api) => <g data-plane-cell-coverage="true">{base.draw(coverageBaseState(state), { ...api, ghostState: api.ghostState ? coverageBaseState(api.ghostState) : undefined })}<CellCoverageOverlay state={state} api={api} /></g>,
};
