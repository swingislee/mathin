import type { PlanarPoint, PlanarState } from "../planar-kit/contract";
import { HeightMark } from "../planar-kit/geometry";
import type { PlanarAction, PlanarSceneDefinition, PlanarText } from "../planar-kit/types";
import { constructionArea, constructionBounds, constructionObject, constructionObjects, parseConstructionTarget } from "../plane-construction/model";
import { createConstructionDefinition } from "../plane-construction/scenes";
import { RELATION_MATERIALS, RELATIONS_SCENE_ID, addRelationMaterial, copyMidpointTriangle, copyRelationParts, createRelationGeometry, createRelationsState, dragRelation, nestMidpointTriangle, relationFlag, relationModel, setRelationField, setRelationFlag, syncRelations, tapRelation } from "./model";

const t = (zh: string, en: string): PlanarText => ({ zh, en });
const base = createConstructionDefinition(RELATIONS_SCENE_ID, "plane-area-relations", t("面积关系", "Area relationships"));
const coordinates = (points: readonly PlanarPoint[]) => points.map((point) => `${point.x},${point.y}`).join(" ");
const isTriangle = (state: PlanarState) => constructionObject(state)?.vertices.length === 3;
const colors = ["var(--leaf)", "var(--moon)", "var(--cheek)", "var(--crater)"];
const ownedId = (selected: string | null) => selected?.startsWith("division.") ? Number(selected.slice(9)) : selected ? parseConstructionTarget(selected)?.id : undefined;
const wrapAction = (action: PlanarAction): PlanarAction => ({ ...action, run: (state, context) => syncRelations(state, action.run(state, context), action.id === "construction-duplicate" ? state.params.active : undefined) });
const toggle = (key: "height" | "division" | "diagonals" | "midpoints", icon: PlanarAction["icon"], label: PlanarText): PlanarAction => ({
  id: `relations-${key}`, icon, label, active: (state) => relationFlag(state, key),
  disabled: (state) => !constructionObject(state) || (key === "diagonals" ? constructionObject(state)?.vertices.length !== 4 : key !== "height" && !isTriangle(state)),
  run: (state) => setRelationFlag(state, key),
});

const relationActions: PlanarAction[] = [
  toggle("height", "measure", t("显示到底边的高", "Show altitudes to the base")),
  toggle("division", "vertex", t("添加底边分点与分割线", "Show base division and its segment")),
  { id: "relations-midpoint", icon: "vertex", label: t("分点移到中点", "Place division at the midpoint"), disabled: (state) => !isTriangle(state),
    active: (state) => relationFlag(state, "division") && state.params[`fraction.${state.params.active}`] === 0.5,
    run: (state) => setRelationFlag(setRelationField(state, "divisionRatio", 0.5), "division", true) },
  toggle("diagonals", "edge", t("连接两条对角线", "Join both diagonals")),
  toggle("midpoints", "vertex", t("连接三个中点", "Join the three midpoints")),
  { id: "relations-copy-midpoints", icon: "duplicate", label: t("复制中点三角形", "Copy the midpoint triangle"),
    disabled: (state) => copyMidpointTriangle(state) === state, run: copyMidpointTriangle },
  { id: "relations-copy-parts", icon: "duplicate", label: t("复制当前分区为独立材料", "Copy current partitions as independent pieces"),
    disabled: (state) => copyRelationParts(state) === state, run: copyRelationParts },
  { id: "relations-nest-midpoints", icon: "add", label: t("原位添加一层中点三角形", "Add one nested midpoint triangle"),
    disabled: (state) => nestMidpointTriangle(state) === state, run: nestMidpointTriangle },
];

export const planeRelationsScene: PlanarSceneDefinition = {
  ...base,
  description: t("画出或添加三角形、凸四边形，选底并添加分点、高或对角线。当前分区可复制成独立材料，中点三角形可逐层原位添加；原材料与观察保留。", "Draw or add triangles and convex quadrilaterals, choose a base and add division points, altitudes or diagonals. Copy partitions as independent pieces and add nested midpoint triangles; original materials and observations remain."),
  create: createRelationsState,
  fields: base.fields?.filter((field) => field.key !== "detail").map((field) => ({ ...field,
    disabled: (state) => !!field.disabled?.(state) || (["width", "height"].includes(field.key) && relationFlag(state, "parallel")),
  })),
  setField: setRelationField,
  materials: RELATION_MATERIALS.map((material) => ({
    id: `relations-${material.id}`, label: t(material.zh, material.en), group: t("添加材料", "Add material"),
    preview: <svg viewBox="-180 -130 360 260" width="76" height="60" aria-hidden="true" focusable="false"><polygon points={coordinates(material.points)} fill="var(--leaf)" stroke="var(--ink)" strokeWidth="2" /></svg>,
    add: (state) => addRelationMaterial(state, material.id), disabled: (state) => addRelationMaterial(state, material.id) === state,
  })),
  actions: base.actions?.filter((action) => !["construction-life-outline", "construction-insert-vertex", "construction-remove-vertex"].includes(action.id)).map(wrapAction),
  operations: [
    { id: "relations", icon: "edge", label: t("选底与面积关系", "Base and area relationships"),
      fields: [
        { key: "divisionRatio", label: t("底边分点比例", "Base division fraction"), min: 0.05, max: 0.95, step: 0.01,
          read: (state) => state.params[`fraction.${state.params.active}`] ?? 0.5, disabled: (state) => !isTriangle(state) },
        { key: "heightLock", label: t("顶点的平行线约束", "Parallel-line constraint for vertices"), min: 0, max: 1, step: 1,
          options: [{ value: 0, label: t("自由移动，比较高的变化", "Move freely and compare heights") }, { value: 1, label: t("保持底线与等高线", "Keep the base and equal-height lines") }],
          read: (state) => relationFlag(state, "parallel") ? 1 : 0, disabled: (state) => !isTriangle(state) },
      ], actions: relationActions },
    ...base.operations!.filter((operation) => operation.id !== "reflect").map((operation) => ({ ...operation, actions: operation.actions?.map(wrapAction) })),
  ],
  construction: {
    maxPoints: 4,
    tools: [
      { id: "polygon", label: t("画三角形／凸四边形", "Draw a triangle or convex quadrilateral"), kind: "points" },
      { id: "rectangle", label: t("画长方形", "Draw a rectangle"), kind: "drag" },
    ],
    invalidHint: t("依次点出 3 或 4 个顶点，再点起点闭合；本批面积关系使用有面积的三角形和凸四边形，最多保留 16 张材料。", "Choose 3 or 4 vertices, then close at the first point. This area workspace accepts non-degenerate triangles and convex quadrilaterals, up to 16 materials."),
    create: createRelationGeometry,
    preview: base.construction!.preview,
  },
  drag: dragRelation,
  tap: tapRelation,
  contextActions: (state, selected) => {
    const id = ownedId(selected), object = id === undefined ? null : constructionObject(state, id);
    return object ? { bounds: constructionBounds(object), items: [
      { kind: "operation", id: "relations" }, { kind: "action", id: "construction-edit" },
      { kind: "operation", id: "rotate" }, { kind: "action", id: "construction-duplicate" },
    ] } : null;
  },
  draw: (state, api) => {
    const selected = ownedId(api.selected), selectingBase = api.operation === "relations";
    return <g data-plane-relations="true">
      {base.draw({ ...state, flags: { ...state.flags, edges: state.flags.edges || selectingBase } }, { ...api, selected: api.selected?.startsWith("division.") ? `object.${selected}` : api.selected })}
      {constructionObjects(state).map((object) => {
        const model = relationModel(state, object.id);
        if (!model) return null;
        const showBase = relationFlag(state, "height", object.id) || relationFlag(state, "division", object.id) || relationFlag(state, "parallel", object.id) || selectingBase && selected === object.id;
        const direction = { x: (model.b.x - model.a.x) / model.length, y: (model.b.y - model.a.y) / model.length };
        return <g key={object.id} data-relation-object={object.id}>
          <g pointerEvents="none">
            {model.parts.map((points, index) => <g key={index}>
              <polygon points={coordinates(points)} fill={colors[index]} fillOpacity="0.65" stroke="var(--ink)" strokeWidth="1.4" />
              {state.flags.measures && <text x={points.reduce((sum, point) => sum + point.x, 0) / points.length} y={points.reduce((sum, point) => sum + point.y, 0) / points.length} textAnchor="middle" fill="var(--ink)" paintOrder="stroke" stroke="var(--paper)" strokeWidth="4" fontSize="15">S{index + 1} = {constructionArea(points).toFixed(1)}</text>}
            </g>)}
            {showBase && <line data-relation-base={object.id} x1={model.a.x} y1={model.a.y} x2={model.b.x} y2={model.b.y} stroke="var(--leaf-deep)" strokeWidth="4" />}
            {relationFlag(state, "parallel", object.id) && [model.a, model.heights[0].vertex].map((point, index) => <line key={index} data-relation-parallel={object.id} x1={point.x - direction.x * 420} y1={point.y - direction.y * 420} x2={point.x + direction.x * 420} y2={point.y + direction.y * 420} stroke="var(--muted)" strokeWidth="1.3" strokeDasharray="7 5" />)}
            {relationFlag(state, "height", object.id) && model.heights.map((height, index) => <HeightMark key={index} {...height} label={state.flags.measures ? `h${model.heights.length > 1 ? index + 1 : ""} = ${height.amount.toFixed(1)}` : model.heights.length > 1 ? `h${index + 1}` : "h"} />)}
            {relationFlag(state, "midpoints", object.id) && <polygon data-relation-midpoints={object.id} points={coordinates(model.inner)} fill="none" stroke="var(--rose)" strokeWidth="2.3" strokeDasharray="6 4" />}
          </g>
          {relationFlag(state, "division", object.id) && <g {...(selectingBase && selected === object.id ? api.bind(`division.${object.id}`, api.locale === "en" ? "Move the base division point" : "拖动底边分点") : {})} pointerEvents={selectingBase && selected === object.id ? undefined : "none"} data-relation-division={object.id}>
            <circle cx={model.division.x} cy={model.division.y} r="17" fill="transparent" />
            <circle cx={model.division.x} cy={model.division.y} r="5" fill="var(--paper)" stroke="var(--rose)" strokeWidth="2" />
            <text x={model.division.x + 10} y={model.division.y - 12} fill="var(--ink)" fontSize="16" paintOrder="stroke" stroke="var(--paper)" strokeWidth="4" pointerEvents="none">D</text>
          </g>}
        </g>;
      })}
    </g>;
  },
  summary: (state, locale) => locale === "en" ? `${constructionObjects(state).length} independent materials` : `${constructionObjects(state).length} 张独立材料`,
};
