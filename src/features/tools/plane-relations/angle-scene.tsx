import type { ReactNode } from "react";
import type { PlanarPoint, PlanarState } from "../planar-kit/contract";
import { textFor, type PlanarDrawingApi, type PlanarOperation } from "../planar-kit/types";
import { parseConstructionTarget } from "../plane-construction/model";
import { alignAngleTriangle, angleComparison, angleTriangle, canAdjustAngle, copyAngleTriangle, interpolateAngleGeometry, parseAngleHandle, scaleAngleTriangle } from "./angle-model";

const t = (zh: string, en: string) => ({ zh, en });
const fmt = (value: number) => Number(value.toFixed(3)).toString();
const coordinates = (points: readonly PlanarPoint[]) => points.map((point) => `${point.x},${point.y}`).join(" ");
export const angleMode = (operation?: string | null) => operation === "relations-common-angle" ? "independent" : operation === "relations-similar" ? "similar" : null;
export const angleObjectTarget = (target: string | null) => {
  const handle = target ? parseAngleHandle(target) : null;
  return handle ? `object.${handle.id}` : target;
};

export const angleOperations: PlanarOperation[] = [
  { id: "relations-common-angle", icon: "dimensions", label: t("共角分别调边", "Adjust sides along a common angle"),
    fields: (["a", "b"] as const).map((side) => ({ key: `angle-${side}`, min: 1, max: 1600, step: 1,
      label: t(`O${side.toUpperCase()} 长度（u）`, `O${side.toUpperCase()} length (u)`),
      read: (state: PlanarState) => angleTriangle(state)?.[side === "a" ? "aLength" : "bLength"] ?? 0,
      disabled: (state: PlanarState) => !canAdjustAngle(state),
    })),
    actions: [
      { id: "relations-copy-nested-angle", icon: "duplicate", label: t("添加同向共角副本", "Add a nested common-angle copy"),
        disabled: (state) => copyAngleTriangle(state) === state, run: (state) => copyAngleTriangle(state) },
      { id: "relations-copy-hourglass", icon: "duplicate", label: t("添加反向沙漏副本", "Add an opposite hourglass copy"),
        disabled: (state) => copyAngleTriangle(state, true) === state, run: (state) => copyAngleTriangle(state, true) },
    ],
  },
  { id: "relations-similar", icon: "dimensions", label: t("定点等比伸缩", "Scale about the fixed vertex"),
    fields: (["a", "b"] as const).map((side) => ({ key: `similar-${side}`, min: 1, max: 1600, step: 1,
      label: t(`O${side.toUpperCase()} 长度（两边联动）`, `O${side.toUpperCase()} length (scale both sides)`),
      read: (state: PlanarState) => angleTriangle(state)?.[side === "a" ? "aLength" : "bLength"] ?? 0,
      disabled: (state: PlanarState) => !canAdjustAngle(state),
    })),
    actions: [
      { id: "relations-align-similar", icon: "dimensions", label: t("使参照底边与当前底边平行", "Make the current base parallel to the reference"), duration: 1200,
        disabled: (state) => alignAngleTriangle(state) === state, run: alignAngleTriangle, interpolate: interpolateAngleGeometry },
      { id: "relations-scale-half", icon: "decrease", label: t("两边缩为一半", "Halve both sides"), duration: 1400,
        disabled: (state) => scaleAngleTriangle(state, 0.5) === state, run: (state) => scaleAngleTriangle(state, 0.5), interpolate: interpolateAngleGeometry },
      { id: "relations-scale-double", icon: "increase", label: t("两边放大一倍", "Double both sides"), duration: 1400,
        disabled: (state) => scaleAngleTriangle(state, 2) === state, run: (state) => scaleAngleTriangle(state, 2), interpolate: interpolateAngleGeometry },
    ],
  },
];

function Caption({ at, children, anchor = "middle", size = 14 }: { at: PlanarPoint; children: ReactNode; anchor?: "start" | "middle"; size?: number }) {
  return <text x={at.x} y={at.y} textAnchor={anchor} fontSize={size} fill="var(--ink)" stroke="var(--paper)" strokeWidth="4" paintOrder="stroke" pointerEvents="none">{children}</text>;
}

export function AngleOverlay({ state, api }: { state: PlanarState; api: PlanarDrawingApi }) {
  const mode = angleMode(api.operation), target = angleObjectTarget(api.selected);
  const selected = target ? parseConstructionTarget(target)?.id : undefined;
  const model = angleTriangle(state, selected ?? state.params.active), comparison = model && angleComparison(state, model.object.id);
  const operating = !!mode && selected !== undefined;
  if (!model || !operating && !(state.flags.measures && comparison)) return null;
  const handles = operating && api.editable && canAdjustAngle(state, model.object.id);
  const lang = (text: ReturnType<typeof t>) => textFor(text, api.locale);
  return <g data-angle-operation={mode ?? "observe"}>
    <g pointerEvents="none">
      {comparison && <g data-angle-reference={comparison.reference.id}>
        <polygon points={coordinates([model.origin, comparison.a, comparison.b])} fill="none" stroke="var(--crater)" strokeWidth="2.5" strokeDasharray="7 5" />
        <Caption at={{ x: comparison.a.x - 12, y: comparison.a.y + 20 }}>A′</Caption>
        <Caption at={{ x: comparison.b.x + 12, y: comparison.b.y + 20 }}>B′</Caption>
      </g>}
      {[model.a, model.b].map((point, index) => <line key={index} x1={model.origin.x} y1={model.origin.y} x2={point.x} y2={point.y} stroke="var(--leaf-deep)" strokeWidth="3" />)}
      <circle cx={model.origin.x} cy={model.origin.y} r="4" fill="var(--paper)" stroke="var(--ink)" strokeWidth="1.5" />
      <Caption at={{ x: model.origin.x + 13, y: model.origin.y - 13 }}>O</Caption>
    </g>
    {(["a", "b"] as const).map((side) => {
      const at = model[side];
      return <g key={side} {...(handles ? api.bind(`angle.${mode}.${side}.${model.object.id}`, lang(t(`沿 O${side.toUpperCase()} 射线拖动`, `Drag along ray O${side.toUpperCase()}`))) : {})}
        data-angle-handle={handles ? side : undefined} pointerEvents={handles ? undefined : "none"} style={handles ? { cursor: "grab" } : undefined}>
        {handles && <circle cx={at.x} cy={at.y} r="18" fill="transparent" />}
        <circle cx={at.x} cy={at.y} r="5" fill="var(--paper)" stroke="var(--rose)" strokeWidth="2" pointerEvents="none" />
        <Caption at={{ x: at.x + (side === "a" ? -12 : 12), y: at.y - 13 }}>{side.toUpperCase()}</Caption>
      </g>;
    })}
    {state.flags.measures && <g data-angle-measures pointerEvents="none">
      <Caption at={{ x: 28, y: 624 }} anchor="start">{lang(t(`当前材料 ${model.object.id + 1}`, `Current shape ${model.object.id + 1}`))} · OA ≈ {fmt(model.aLength)} u · OB ≈ {fmt(model.bLength)} u · ∠AOB ≈ {fmt(model.degrees)}° · S ≈ {fmt(model.area)} u²</Caption>
      {comparison && <>
        <Caption at={{ x: 28, y: 648 }} anchor="start">{lang(t(`参照材料 ${comparison.reference.id + 1}（${comparison.opposite ? "对顶角" : "共角"}）`, `Reference shape ${comparison.reference.id + 1} (${comparison.opposite ? "opposite angles" : "common angle"})`))} · k₁ = OA / OA′ ≈ {fmt(comparison.aRatio)} · k₂ = OB / OB′ ≈ {fmt(comparison.bRatio)}</Caption>
        <Caption at={{ x: 28, y: 672 }} anchor="start">S / S′ = k₁ × k₂{comparison.parallel ? " = k²" : ""} ≈ {fmt(comparison.areaRatio)}{comparison.parallel ? "" : ` · ${lang(t("两射线的比例不同，底边不平行", "Different ray ratios: bases are not parallel"))}`}</Caption>
      </>}
    </g>}
    {operating && <Caption at={{ x: 28, y: 703 }} anchor="start" size={13}>{lang(!canAdjustAngle(state, model.object.id)
      ? t("先在“选底与面积关系”解除等高线约束，再沿射线调边。", "Release the equal-height constraint in Base and area relationships before adjusting the rays.")
      : mode === "similar" ? t("O 为所选底边的对顶点；拖任一端同时伸缩两边，其他材料不动。", "O is opposite the selected base. Drag either endpoint to scale both sides; other shapes stay fixed.")
        : t("O 为所选底边的对顶点；两端沿射线独立移动。开启测量比较真实边比与面积比。", "O is opposite the selected base. Move each endpoint independently; enable measurements to compare actual ratios."))}</Caption>}
  </g>;
}
