import type { PlanarPoint, PlanarState } from "../planar-kit/contract";
import type { PlanarAction, PlanarSceneDefinition, PlanarText } from "../planar-kit/types";
import { constructionBounds, constructionObject, constructionObjects, parseConstructionTarget } from "../plane-construction/model";
import { createConstructionDefinition } from "../plane-construction/scenes";
import { regionPath } from "../plane-relations/geometry";
import { OVERLAP_MATERIALS, OVERLAP_SCENE_ID, addOverlapMaterial, assignOverlap, createOverlapGeometry, createOverlapState, dragOverlap, overlapModel, setOverlapField, settleOverlap } from "./model";

const t = (zh: string, en: string): PlanarText => ({ zh, en });
const base = createConstructionDefinition(OVERLAP_SCENE_ID, "plane-overlap", t("重叠与区域", "Overlap and regions"));
const coordinates = (points: readonly PlanarPoint[]) => points.map((point) => `${point.x},${point.y}`).join(" ");
const wrapAction = (action: PlanarAction): PlanarAction => ({ ...action,
  run: (state, context) => settleOverlap(state, action.run(state, context)),
  disabled: (state, context) => !!action.disabled?.(state, context) || settleOverlap(state, action.run(state, context)) === state,
});
const pairActions: PlanarAction[] = (["pairA", "pairB"] as const).map((slot) => ({
  id: `overlap-${slot}`, icon: "select", label: t(`当前纸片作为 ${slot.slice(-1)}`, `Use current paper as ${slot.slice(-1)}`),
  active: (state) => state.params[slot] >= 0 && state.params[slot] === state.params.active,
  disabled: (state) => !constructionObject(state) || state.params.active === state.params[slot === "pairA" ? "pairB" : "pairA"],
  run: (state) => assignOverlap(state, slot),
}));
const names = [t("只看原纸片", "Original papers"), t("交集：重叠部分", "Intersection: shared region"), t("并集：合在一起", "Union: combined region"), t("差集：A 中去掉 B", "Difference: A outside B")];
const pairLabel = (state: PlanarState) => `A: ${state.params.pairA < 0 ? "—" : state.params.pairA + 1} · B: ${state.params.pairB < 0 ? "—" : state.params.pairB + 1}`;

export const planeOverlapScene: PlanarSceneDefinition = {
  ...base,
  description: t("添加或自绘不同大小的凸多边形纸片，明确指定 A 和 B，再移动、转动或观察交并差。其它纸片留在原现场；本批直边运算不包含圆弧。", "Add or draw convex polygon papers of different sizes. Assign A and B, then move, rotate and inspect their regions. Other papers remain in place. These straight-edge operations do not include circular arcs."),
  create: createOverlapState,
  fields: base.fields?.filter((field) => field.key !== "detail"),
  setField: setOverlapField,
  materials: OVERLAP_MATERIALS.map((material) => ({
    id: `overlap-${material.id}`, label: t(material.zh, material.en), group: t("添加凸纸片", "Add convex paper"),
    preview: <svg viewBox="-175 -145 350 290" width="76" height="60" aria-hidden="true" focusable="false"><polygon points={coordinates(material.points)} fill="var(--moon)" stroke="var(--ink)" strokeWidth="2" /></svg>,
    add: (state) => addOverlapMaterial(state, material.id), disabled: (state) => addOverlapMaterial(state, material.id) === state,
  })),
  actions: base.actions!.filter((action) => action.id !== "construction-life-outline").map(wrapAction),
  operations: [
    { id: "regions", icon: "compareContents", label: t("观察 A / B 交并差", "Inspect A / B regions"),
      actions: pairActions,
      fields: [{ key: "region", label: t("显示区域", "Region to show"), min: 0, max: 3, step: 1,
        options: names.map((label, value) => ({ value, label })), read: (state) => state.params.region,
        disabled: (state) => !overlapModel(state) }],
    },
    ...base.operations!.filter((operation) => operation.id !== "reflect").map((operation) => ({ ...operation, actions: operation.actions?.map(wrapAction) })),
  ],
  construction: {
    maxPoints: 32,
    tools: [
      { id: "polygon", label: t("画凸多边形纸片", "Draw convex polygon paper"), kind: "points" },
      { id: "rectangle", label: t("画长方形纸片", "Draw rectangular paper"), kind: "drag" },
    ],
    invalidHint: t("请围出不自交、有面积的凸多边形；凹入、交叉和超过 16 张纸片／总计 192 点的轮廓保留为未完成草稿。圆弧使用原圆方材料，不作折线近似。", "Enclose a non-crossing convex polygon with area. Concave or crossed outlines, or exceeding 16 papers / 192 points, remain unfinished drafts. Circular materials retain their original arcs rather than polygon approximations."),
    create: createOverlapGeometry,
    preview: base.construction!.preview,
  },
  drag: dragOverlap,
  contextActions: (state, selected) => {
    const id = selected ? parseConstructionTarget(selected)?.id : undefined, object = id === undefined ? null : constructionObject(state, id);
    return object ? { bounds: constructionBounds(object), items: [
      { kind: "operation", id: "regions" }, { kind: "action", id: "construction-edit" },
      { kind: "operation", id: "rotate" },
      { kind: "action", id: "construction-duplicate" },
    ] } : null;
  },
  draw: (state, api) => {
    const model = overlapModel(state), mode = state.params.region;
    const regions = !model || mode === 0 ? [] : mode === 1 ? [model.intersection] : mode === 2 ? model.union : model.difference;
    return <g data-plane-overlap="true">
      {base.draw(state, api)}
      <g pointerEvents="none">
        {!!model && mode > 0 && <>
          <path data-overlap-region={mode} d={regionPath(regions.filter((polygon) => polygon.length >= 3))} fill="var(--rose)" fillOpacity="0.55" fillRule="nonzero" stroke="none" />
          {[model.a, model.b].map((polygon, index) => <polygon key={index} points={coordinates(polygon)} fill="none" stroke="var(--ink)" strokeWidth="1.5" />)}
        </>}
        {constructionObjects(state).map((object) => {
          const bounds = constructionBounds(object), slot = state.params.pairA === object.id ? "A" : state.params.pairB === object.id ? "B" : "";
          return <text key={object.id} data-overlap-paper-label={object.id} x={object.center.x} y={bounds.minY - 12} textAnchor="middle" fill="var(--ink)" paintOrder="stroke" stroke="var(--paper)" strokeWidth="5" fontSize="17">{slot ? `${slot} · ` : ""}{object.id + 1}</text>;
        })}
        <text x="40" y="652" fill="var(--ink)" fontSize="16" paintOrder="stroke" stroke="var(--paper)" strokeWidth="5">{pairLabel(state)} · {api.locale === "en" ? names[mode].en : names[mode].zh}</text>
        {state.flags.measures && model && <text x="40" y="681" fill="var(--ink)" fontSize="15" paintOrder="stroke" stroke="var(--paper)" strokeWidth="5">{api.locale === "en" ? "Intersection" : "交集"} {model.intersectionArea.toFixed(1)} · {api.locale === "en" ? "Union" : "并集"} {model.unionArea.toFixed(1)} · A−B {model.differenceArea.toFixed(1)} u²</text>}
      </g>
    </g>;
  },
  summary: (state) => pairLabel(state),
};
