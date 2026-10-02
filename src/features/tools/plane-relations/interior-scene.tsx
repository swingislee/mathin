import type { PlanarPoint, PlanarState } from "../planar-kit/contract";
import { HeightMark } from "../planar-kit/geometry";
import type { PlanarAction, PlanarSceneDefinition } from "../planar-kit/types";
import { constructionArea, constructionObjects, parseConstructionTarget } from "../plane-construction/model";
import { relationFlag } from "./model";
import { planeRelationsScene } from "./scenes";
import { applyInteriorBase, copyInteriorParts, createInteriorState, dragInterior, interiorModel, setInteriorField, tapInterior, toggleInterior } from "./interior-model";
import { INTERIOR_SCENE_ID, interiorBaseState } from "./interior-validation";

const t = (zh: string, en: string) => ({ zh, en });
const coordinates = (points: readonly PlanarPoint[]) => points.map((point) => `${point.x},${point.y}`).join(" ");
const colors = ["var(--leaf)", "var(--moon)", "var(--cheek)", "var(--crater)"];
const ownedId = (selected: string | null) => /^(interior|division)\./.test(selected ?? "") ? Number(selected!.split(".")[1]) : selected ? parseConstructionTarget(selected)?.id : undefined;
const wrapAction = (action: PlanarAction): PlanarAction => {
  const run: PlanarAction["run"] = (state, context) => action.id === "relations-copy-parts" && relationFlag(state, "interior")
    ? copyInteriorParts(state)
    : applyInteriorBase(state, (base) => action.run(base, context), action.id === "construction-duplicate" ? state.params.active : undefined);
  return { ...action, run,
    disabled: (state, context) => action.id === "relations-copy-parts" && relationFlag(state, "interior") ? copyInteriorParts(state) === state : !!action.disabled?.(interiorBaseState(state), context),
    active: action.active ? (state) => action.active!(interiorBaseState(state)) : undefined,
    interpolate: action.interpolate ? (from, to, progress) => applyInteriorBase(from, (base) => action.interpolate!(base, interiorBaseState(to), progress)) : undefined,
  };
};
const copyAction = wrapAction(planeRelationsScene.operations!.flatMap((operation) => operation.actions ?? []).find((action) => action.id === "relations-copy-parts")!);
const unavailable = (state: PlanarState) => !interiorModel(state) || !relationFlag(state, "interior");

export const planeInteriorScene: PlanarSceneDefinition = {
  ...planeRelationsScene, id: INTERIOR_SCENE_ID,
  description: t("在自己的三角形内添加 P，拖动 P 和底边分点 D，比较四个分区与两翼面积；可以保持或解除顶点、P、D 共线。原有底、高、对角线和中点材料继续保留。", "Add P inside your own triangle and move P and base division D to compare four regions and the two wings. Keep or release apex–P–D collinearity; existing base, altitude, diagonal and midpoint tools remain."),
  create: createInteriorState, setField: setInteriorField,
  setFlag: planeRelationsScene.setFlag ? (state, key, value) => applyInteriorBase(state, (base) => planeRelationsScene.setFlag!(base, key, value)) : undefined,
  actions: planeRelationsScene.actions?.map(wrapAction),
  materials: planeRelationsScene.materials?.map((material) => ({ ...material,
    add: (state) => applyInteriorBase(state, material.add),
    disabled: (state) => !!material.disabled?.(interiorBaseState(state)),
  })),
  operations: [
    { id: "relations-interior", icon: "vertex", label: t("内点与两翼", "Interior point and wings"),
      fields: [
        { key: "divisionRatio", label: t("底边分点比例", "Base division fraction"), min: 0.05, max: 0.95, step: 0.01,
          read: (state) => state.params[`fraction.${state.params.active}`] ?? 0.5, disabled: unavailable },
        { key: "innerBase", label: t("内点的底边方向比例", "Interior base fraction"), min: 0.05, max: 0.95, step: 0.01,
          read: (state) => state.params[`innerBase.${state.params.active}`] ?? 0.5, disabled: (state) => unavailable(state) || relationFlag(state, "collinear") },
        { key: "innerHeight", label: t("内点的高度比例", "Interior height fraction"), min: 0.05, max: 0.95, step: 0.01,
          read: (state) => state.params[`innerHeight.${state.params.active}`] ?? 0.4, disabled: unavailable },
        { key: "innerConstraint", label: t("内点的共线约束", "Interior collinearity"), min: 0, max: 1, step: 1,
          options: [{ value: 0, label: t("内点自由移动", "Move freely inside the triangle") }, { value: 1, label: t("保持顶点、P、D 共线", "Keep apex, P and D collinear") }],
          read: (state) => relationFlag(state, "collinear") ? 1 : 0, disabled: unavailable },
      ], actions: [
        { id: "relations-interior-point", icon: "vertex", label: t("显示内点与四个分区", "Show the interior point and four regions"),
          active: (state) => relationFlag(state, "interior"), disabled: (state) => !interiorModel(state), run: toggleInterior },
        copyAction,
      ] },
    ...planeRelationsScene.operations!.map((operation) => ({ ...operation, actions: operation.actions?.map(wrapAction) })),
  ],
  construction: { ...planeRelationsScene.construction!, create: (state, tool, points) => {
    const result = applyInteriorBase(state, (base) => planeRelationsScene.construction!.create(base, tool, points) ?? base);
    return result === state ? null : result;
  } },
  drag: dragInterior, tap: tapInterior,
  snap: planeRelationsScene.snap ? (state, target) => {
    if (/^(interior|division)\./.test(target)) return null;
    const result = applyInteriorBase(state, (base) => planeRelationsScene.snap!(base, target) ?? base);
    return result === state ? null : result;
  } : undefined,
  contextActions: (state, selected) => {
    const id = ownedId(selected), canonical = id === undefined ? selected : `object.${id}`;
    const result = planeRelationsScene.contextActions?.(state, canonical);
    return result && interiorModel(state, id) ? { ...result, items: [{ kind: "operation", id: "relations-interior" }, ...result.items] } : result ?? null;
  },
  draw: (state, api) => {
    const selected = ownedId(api.selected), adjusting = api.operation === "relations-interior";
    const base = interiorBaseState(state), baseFlags = { ...base.flags };
    for (const object of constructionObjects(state)) if (relationFlag(state, "interior", object.id)) baseFlags[`division.${object.id}`] = false;
    return <g data-plane-interior="true">
      {planeRelationsScene.draw({ ...base, flags: baseFlags }, { ...api, selected: selected === undefined ? api.selected : `object.${selected}`, operation: adjusting ? "relations" : api.operation })}
      {constructionObjects(state).map((object) => {
        const model = interiorModel(state, object.id);
        if (!model || !relationFlag(state, "interior", object.id)) return null;
        const handles = adjusting && selected === object.id && api.editable;
        return <g key={object.id} data-interior-object={object.id}>
          <g pointerEvents="none">
            {model.parts.map((points, index) => <g key={index} data-interior-part={index + 1}>
              <polygon points={coordinates(points)} fill={colors[index]} fillOpacity="0.65" stroke="var(--ink)" strokeWidth="1.4" />
              {state.flags.measures && <text x={points.reduce((sum, point) => sum + point.x, 0) / 3} y={points.reduce((sum, point) => sum + point.y, 0) / 3} textAnchor="middle" fill="var(--ink)" fontSize="15" paintOrder="stroke" stroke="var(--paper)" strokeWidth="4">S{index + 1} = {constructionArea(points).toFixed(1)}</text>}
            </g>)}
            <line x1={model.c.x} y1={model.c.y} x2={model.division.x} y2={model.division.y} stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="6 4" data-interior-guide={model.collinear ? "constrained" : "comparison"} />
            {relationFlag(state, "height", object.id) && <HeightMark vertex={model.point} baseA={model.a} baseB={model.b} label={state.flags.measures ? `hP = ${(model.heights[0].amount * model.v).toFixed(1)}` : "hP"} />}
          </g>
          {([{ name: "P", target: "interior", at: model.point }, { name: "D", target: "division", at: model.division }] as const).map(({ name, target, at }) => <g key={target}
            {...(handles ? api.bind(`${target}.${object.id}`, api.locale === "en" ? `Move ${name}` : `拖动${name === "P" ? "内点 P" : "底边分点 D"}`) : {})}
            data-interior-point={name} pointerEvents={handles ? undefined : "none"}>
            {handles && <circle cx={at.x} cy={at.y} r="18" fill="transparent" />}
            <circle cx={at.x} cy={at.y} r="5" fill="var(--paper)" stroke="var(--rose)" strokeWidth="2" />
            <text x={at.x + 10} y={at.y - 12} fill="var(--ink)" fontSize="16" paintOrder="stroke" stroke="var(--paper)" strokeWidth="4" pointerEvents="none">{name}</text>
          </g>)}
        </g>;
      })}
    </g>;
  },
};
