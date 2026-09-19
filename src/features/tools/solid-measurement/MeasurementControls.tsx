"use client";

import { useId } from "react";
import { Minus, Plus, Ruler } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CubeCanvasPanel, CubeIconButton } from "../spatial-lab/CubeWorkbenchControls";
import type { SolidEntity, SolidFeatureSelection } from "../solid-geometry/solid-geometry-contract";
import { getSolidMetrics, getSolidTopology } from "../solid-geometry/solid-geometry";
import { solidGeometryMessages } from "../solid-geometry/solid-geometry-messages";
import type { MeasurementSettings } from "./measurement-contract";
import { formatMeasurementValue, measurementFaceArea, measurementTargetLayers, measurementUnitFillAvailability } from "./measurement-model";
import { measurementMessages } from "./measurement-messages";

export interface MeasurementButtonProps { locale: string; active: boolean; disabled?: boolean; onClick: () => void }
export function MeasurementButton({ locale, active, disabled, onClick }: MeasurementButtonProps) {
  return <CubeIconButton label={measurementMessages(locale).title} active={active} disabled={disabled} onClick={onClick} data-solid-measurement-button><Ruler aria-hidden /></CubeIconButton>;
}

export interface MeasurementPanelProps {
  locale: string; settings: MeasurementSettings; selected: SolidEntity | null; feature?: SolidFeatureSelection | null; disabled?: boolean;
  onChange: (next: MeasurementSettings) => void; onSelectFace?: (feature: SolidFeatureSelection | null) => void; onClose: () => void;
}

/** 原测量面板的数学内核继续复用，窗口与按钮改为已有画布非模态原语。 */
export function MeasurementPanel({ locale, settings, selected, feature = null, disabled = false, onChange, onSelectFace, onClose }: MeasurementPanelProps) {
  const m = measurementMessages(locale), solidMessages = solidGeometryMessages(locale), id = useId();
  const support = measurementUnitFillAvailability(selected), metrics = selected ? getSolidMetrics(selected) : null;
  const topology = selected ? getSolidTopology(selected) : null;
  const selectedFace = feature?.entityId === selected?.id && feature?.kind === "face" ? feature.id : null;
  const faceArea = selected && selectedFace ? measurementFaceArea(selected, selectedFace) : null;
  const box = selected?.kind === "cube" || selected?.kind === "cuboid", target = measurementTargetLayers(selected, settings);
  const inactive = disabled || !settings.enabled;
  const toggle = (key: "enabled" | "dimensions" | "faceArea" | "totals" | "unitGrid" | "unitFill", unavailable = false) => <div key={key} className="flex items-center justify-between gap-3">
    <Label className="text-xs" htmlFor={`${id}-${key}`}>{m[key]}</Label>
    <Switch id={`${id}-${key}`} checked={settings[key]} disabled={disabled || (key !== "enabled" && !settings.enabled) || unavailable}
      onCheckedChange={(checked) => onChange({ ...settings, [key]: checked })} />
  </div>;
  const changeLayers = (layers: number) => onChange({ ...settings, enabled: true, unitFill: true, fillLayers: layers });
  const faceLabel = (faceId: string) => faceId in solidMessages.faces ? solidMessages.faces[faceId as keyof typeof solidMessages.faces] : faceId;
  const supportHint = support.available ? null : support.reason === "select-solid" ? m.selectSolid : support.reason === "cuboid-only" ? m.cuboidOnly : support.reason === "whole-units" ? m.fillWhole : m.fillLimit;
  return <CubeCanvasPanel title={m.title} closeLabel={m.close} onClose={onClose}>
    <div className="space-y-3 text-xs" data-solid-measurement-panel data-unit-fill-available={support.available}>
      {toggle("enabled")}
      <p className="leading-5 text-muted">{m.units}</p>
      {!selected && <p>{m.selectSolid}</p>}
      {selected && <>
        {toggle("dimensions")}
        {toggle("faceArea")}
        {settings.enabled && settings.faceArea && <div className="space-y-2" role="group" aria-label={m.chooseFace}>
          <div className="flex flex-wrap gap-1">{topology!.faces.map((face) => <Button key={face.id} type="button" size="sm" variant={face.id === selectedFace ? "secondary" : "ghost"}
            aria-pressed={face.id === selectedFace} disabled={inactive || !onSelectFace} onClick={() => onSelectFace?.(face.id === selectedFace ? null : { entityId: selected.id, kind: "face", id: face.id })}>{faceLabel(face.id)}</Button>)}</div>
          {faceArea === null ? <p className="leading-5 text-muted">{m.noFace}</p>
            : <p data-measurement-face-area={faceArea}>{faceLabel(selectedFace!)} · {formatMeasurementValue(faceArea, locale, 2)}</p>}
        </div>}
        {toggle("totals")}
        {settings.enabled && settings.totals && metrics && <dl className="space-y-1" data-measurement-readings>
          <div className="flex flex-wrap items-baseline justify-between gap-x-2"><dt>{m.surfaceArea}</dt><dd>{formatMeasurementValue(metrics.surfaceArea, locale, 2)}</dd></div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-2"><dt>{m.volume}</dt><dd>{formatMeasurementValue(metrics.volume, locale, 3)}</dd></div>
        </dl>}
        {toggle("unitGrid", !box && !settings.unitGrid)}
        {settings.enabled && settings.unitGrid && box && <p className="leading-5 text-muted">{m.gridHint}</p>}
        {toggle("unitFill", !support.available && !settings.unitFill)}
        {supportHint && <p className="leading-5 text-muted" data-unit-fill-boundary>{supportHint}</p>}
        {settings.enabled && settings.unitFill && support.available && <div className="space-y-2" data-measurement-layer-controls>
          <p>{m.perLayer} · {support.perLayer} u³</p>
          <div className="flex flex-wrap items-center justify-between gap-2"><span>{m.targetLayers} · {target} / {support.layers}</span>
            <div className="flex gap-1"><Button type="button" size="sm" variant="secondary" aria-label={m.removeLayer} disabled={inactive || target === 0} onClick={() => changeLayers(target - 1)}><Minus aria-hidden className="size-4" /></Button>
              <Button type="button" size="sm" variant="secondary" aria-label={m.addLayer} disabled={inactive || target === support.layers} onClick={() => changeLayers(target + 1)}><Plus aria-hidden className="size-4" /></Button></div></div>
          <p data-measurement-target-count={target * support.perLayer}>{m.filled} · {target * support.perLayer} / {support.total}</p>
          <div className="flex flex-wrap gap-1"><Button type="button" size="sm" variant="secondary" disabled={inactive || target === support.layers} onClick={() => changeLayers(support.layers)}>{m.fillAll}</Button>
            <Button type="button" size="sm" variant="ghost" disabled={inactive || target === 0} onClick={() => changeLayers(0)}>{m.clear}</Button></div>
          <p className="leading-5 text-muted">{m.layerHint}</p>
        </div>}
        <p className="leading-5 text-muted">{m.sourceSolid}</p>
      </>}
    </div>
  </CubeCanvasPanel>;
}
