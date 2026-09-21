"use client";

import { Html } from "@react-three/drei";
import { Button } from "@/components/ui/button";
import { SpatialActionIcon } from "../spatial-interaction/SpatialActionIcon";
import { SpatialColorPicker } from "../spatial-interaction/SpatialWorkbenchControls";
import type { SolidEntity } from "../solid-geometry/solid-geometry-contract";
import type { SolidCut } from "../solid-geometry/exploration-contract";
import { arrangeSolidCut } from "../solid-geometry/exploration-contract";
import { solidGeometryMessages } from "../solid-geometry/solid-geometry-messages";
import { splitSolidByPlane } from "./solid-cut-model";
import { getSolidMetrics } from "../solid-geometry/solid-geometry";
import { formatModelMeasurement } from "../solid-measurement/measurement-units";
import type { MeasurementV2Settings } from "../solid-measurement/measurement-v2-contract";

export function SolidCutControls({ cut, entity, locale, settings, disabled, onArrange, onRestore, onColor, onSelect }: {
  cut: SolidCut; entity: SolidEntity; locale: string; settings: MeasurementV2Settings; disabled: boolean;
  onArrange: (apart: boolean) => void; onRestore: () => void; onColor: (color: SolidCut["cutColor"]) => void; onSelect: (index: 0 | 1) => void;
}) {
  const en = locale === "en", parts = splitSolidByPlane(entity, cut); if (!parts) return null;
  const original = getSolidMetrics(entity), f = (value: number, exponent: 2 | 3) => formatModelMeasurement(value, locale, exponent, settings);
  const assembled = arrangeSolidCut(cut, entity, false).pieces;
  const atOrigin = cut.pieces.every((piece, index) => (["x", "y", "z"] as const).every((axis) => Math.abs(piece.position[axis] - assembled[index].position[axis]) < 1e-6 && Math.abs(piece.rotation[axis] - assembled[index].rotation[axis]) < 1e-6));
  return <div className="space-y-3 text-xs" data-solid-cut-controls>
    <p className="leading-5 text-muted">{en ? "Drag either closed piece on the table. Axis and plane handles move precisely; rotation rings turn that piece. The colored faces are the two new cut surfaces." : "直接拖动任一闭合切块在桌面移动；轴与平面手柄精确移动，旋转环转动该切块。相同颜色的两个面就是新增切面。"}</p>
    <div className="flex flex-wrap gap-1">{([0, 1] as const).map((index) => <Button key={index} size="sm" variant="secondary" disabled={disabled} onClick={() => onSelect(index)}>{en ? "Piece" : "切块"} {index + 1}</Button>)}</div>
    <div className="flex flex-wrap gap-1"><Button size="sm" variant="secondary" disabled={disabled} onClick={() => onArrange(true)}><SpatialActionIcon action="separate" className="mr-1 size-3.5" />{en ? "Separate pieces" : "分开切块"}</Button>
      <Button size="sm" variant="secondary" disabled={disabled} onClick={() => onArrange(false)}><SpatialActionIcon action="assemble" className="mr-1 size-3.5" />{en ? "Reassemble" : "拼回原位"}</Button>
      <Button size="sm" variant="ghost" disabled={disabled || !atOrigin} title={atOrigin ? undefined : en ? "Reassemble the pieces before removing the cut" : "先拼回原位，再恢复未切开"} onClick={onRestore}><SpatialActionIcon action="reset" className="mr-1 size-3.5" />{en ? "Remove cut" : "恢复未切开"}</Button></div>
    <SpatialColorPicker value={cut.cutColor} labels={solidGeometryMessages(locale).colors} label={en ? "Cut surface color" : "切面颜色"} disabled={disabled} onChange={onColor} />
    <p data-cut-volume>{f(parts[0].volume, 3)} + {f(parts[1].volume, 3)} = {f(original.volume, 3)}</p>
    <p>{en ? "Original outer area" : "原来的外表面积"} · {f(original.surfaceArea, 2)}</p>
    <p data-cut-area>{en ? "Separated total surface area" : "分开后的总表面积"} · {f(parts[0].surfaceArea + parts[1].surfaceArea, 2)}</p>
    <p className="leading-5 text-muted">{en ? "Volume is unchanged; the added surface area is twice the cut area. When fitted together, these two faces are internal." : "总体积不变；分开后的表面积增加两个切面的面积。拼回后，这两个面位于内部。"}</p>
  </div>;
}
export function SolidCutPieceReadout({ entity, source, cut, index, locale, settings }: { entity: SolidEntity; source: SolidEntity; cut: SolidCut; index: number; locale: string; settings: MeasurementV2Settings }) {
  const part = splitSolidByPlane(source, cut)?.[index]; if (!part) return null;
  const high = Math.max(...part.mesh.vertices.map((point) => point.y));
  return <group position={[entity.position.x, entity.position.y, entity.position.z]} rotation={[entity.rotation.x, entity.rotation.y, entity.rotation.z]}>
    <Html center position={[0, high + 0.48, 0]} style={{ pointerEvents: "none" }} zIndexRange={[5, 0]}><span className="block whitespace-nowrap rounded bg-paper/95 px-2 py-1 text-xs">{locale === "en" ? "Piece" : "切块"} {index + 1} · V = {formatModelMeasurement(part.volume, locale, 3, settings)}<br />S = {formatModelMeasurement(part.surfaceArea, locale, 2, settings)}</span></Html>
  </group>;
}
