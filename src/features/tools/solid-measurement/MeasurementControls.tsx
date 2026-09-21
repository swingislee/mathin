"use client";

import { SpatialActionButton } from "../spatial-interaction/SpatialActionButton";
import { SpatialActionIcon } from "../spatial-interaction/SpatialActionIcon";

import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SpatialCanvasPanel } from "../spatial-interaction/SpatialWorkbenchControls";
import type { SolidEntity, SolidFeatureSelection } from "../solid-geometry/solid-geometry-contract";
import { getSolidMetrics, getSolidTopology } from "../solid-geometry/solid-geometry";
import { solidGeometryMessages } from "../solid-geometry/solid-geometry-messages";
import type { AnyMeasurementSettings, MeasurementV2Settings } from "./measurement-v2-contract";
import { measurementSettingsSchema, type MeasurementSettings } from "./measurement-contract";
import { MeasurementUnitsControls } from "./MeasurementUnitsControls";
import { formatMeasurementValue, measurementFaceArea, measurementTargetLayers, measurementUnitFillAvailability } from "./measurement-model";
import { measurementMessages } from "./measurement-messages";

export interface MeasurementButtonProps { locale: string; active: boolean; disabled?: boolean; onClick: () => void }
export function MeasurementButton({ locale, active, disabled, onClick }: MeasurementButtonProps) {
  return <SpatialActionButton action="measure" label={measurementMessages(locale).title} active={active} disabled={disabled} onClick={onClick} data-solid-measurement-button />;
}

export interface MeasurementPanelProps<S extends AnyMeasurementSettings = MeasurementSettings> {
  locale: string; settings: S; selected: SolidEntity | null; feature?: SolidFeatureSelection | null; disabled?: boolean;
  onChange: (next: S) => void; onSelectFace?: (feature: SolidFeatureSelection | null) => void; onClose: () => void;
  onUnitExample?: (settings: MeasurementV2Settings) => void;
}

/** 原测量面板的数学内核继续复用，窗口与按钮改为已有画布非模态原语。 */
export function MeasurementPanel(props: MeasurementPanelProps) { return <MeasurementAnyPanel {...props} onChange={(next) => props.onChange(measurementSettingsSchema.parse(next))} />; }
export function MeasurementAnyPanel({ locale, settings, selected, feature = null, disabled = false, onChange, onSelectFace, onClose, onUnitExample }: MeasurementPanelProps<AnyMeasurementSettings>) {
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
      onCheckedChange={(checked) => onChange(key === "unitFill" && "version" in settings ? { ...settings, unitFill: checked, accumulation: "none", accumulationCount: 0 } : { ...settings, [key]: checked })} />
  </div>;
  const changeLayers = (layers: number) => onChange("version" in settings ? { ...settings, enabled: true, unitFill: true, fillLayers: layers, accumulation: "none", accumulationCount: 0 } : { ...settings, enabled: true, unitFill: true, fillLayers: layers });
  const faceLabel = (faceId: string) => faceId in solidMessages.faces ? solidMessages.faces[faceId as keyof typeof solidMessages.faces] : faceId;
  const supportHint = support.available ? null : support.reason === "select-solid" ? m.selectSolid : support.reason === "cuboid-only" ? m.cuboidOnly : support.reason === "whole-units" ? m.fillWhole : m.fillLimit;
  return <SpatialCanvasPanel title={m.title} closeLabel={m.close} onClose={onClose}>
    <div className="space-y-3 text-xs" data-solid-measurement-panel data-unit-fill-available={support.available}>
      {toggle("enabled")}
      {"version" in settings ? <MeasurementUnitsControls settings={settings} selected={selected} locale={locale} disabled={disabled} onChange={onChange} onExample={onUnitExample} /> : <p className="leading-5 text-muted">{m.units}</p>}
      {!selected && <p>{m.selectSolid}</p>}
      {selected && <>
        {toggle("dimensions")}
        {toggle("faceArea")}
        {settings.enabled && settings.faceArea && <div className="space-y-2" role="group" aria-label={m.chooseFace}>
          <div className="flex flex-wrap gap-1">{topology!.faces.map((face) => <Button key={face.id} type="button" size="sm" variant={face.id === selectedFace ? "secondary" : "ghost"}
            aria-pressed={face.id === selectedFace} disabled={inactive || !onSelectFace} onClick={() => onSelectFace?.(face.id === selectedFace ? null : { entityId: selected.id, kind: "face", id: face.id })}>{faceLabel(face.id)}</Button>)}</div>
          {faceArea === null ? <p className="leading-5 text-muted">{m.noFace}</p>
            : <p data-measurement-face-area={faceArea}>{faceLabel(selectedFace!)} · {formatMeasurementValue(faceArea, locale, 2, settings)}</p>}
        </div>}
        {toggle("totals")}
        {settings.enabled && settings.totals && metrics && <dl className="space-y-1" data-measurement-readings>
          <div className="flex flex-wrap items-baseline justify-between gap-x-2"><dt>{m.surfaceArea}</dt><dd>{formatMeasurementValue(metrics.surfaceArea, locale, 2, settings)}</dd></div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-2"><dt>{m.volume}</dt><dd>{formatMeasurementValue(metrics.volume, locale, 3, settings)}</dd></div>
        </dl>}
        {toggle("unitGrid", !box && !settings.unitGrid)}
        {settings.enabled && settings.unitGrid && box && <p className="leading-5 text-muted">{"version" in settings ? locale === "en" ? `Grid spacing is 1 ${settings.unit === "unit" ? "u" : settings.unit}; a fractional last interval keeps its exact size.` : `网格间隔为 1 ${settings.unit === "unit" ? "u" : settings.unit}；末格不足一个单位时保留真实长度。` : m.gridHint}</p>}
        {toggle("unitFill", !support.available && !settings.unitFill)}
        {supportHint && <p className="leading-5 text-muted" data-unit-fill-boundary>{supportHint}</p>}
        {settings.enabled && settings.unitFill && support.available && <div className="space-y-2" data-measurement-layer-controls>
          <p>{m.perLayer} · {formatMeasurementValue(support.perLayer, locale, 3, settings)}</p>
          <div className="flex flex-wrap items-center justify-between gap-2"><span>{m.targetLayers} · {target} / {support.layers}</span>
            <div className="flex gap-1"><Button type="button" size="sm" variant="secondary" aria-label={m.removeLayer} disabled={inactive || target === 0} onClick={() => changeLayers(target - 1)}><SpatialActionIcon action="decrease" aria-hidden className="size-4" /></Button>
              <Button type="button" size="sm" variant="secondary" aria-label={m.addLayer} disabled={inactive || target === support.layers} onClick={() => changeLayers(target + 1)}><SpatialActionIcon action="increase" aria-hidden className="size-4" /></Button></div></div>
          <p data-measurement-target-count={target * support.perLayer}>{m.filled} · {target * support.perLayer} / {support.total}</p>
          <div className="flex flex-wrap gap-1"><Button type="button" size="sm" variant="secondary" disabled={inactive || target === support.layers} onClick={() => changeLayers(support.layers)}>{m.fillAll}</Button>
            <Button type="button" size="sm" variant="ghost" disabled={inactive || target === 0} onClick={() => changeLayers(0)}>{m.clear}</Button></div>
          <p className="leading-5 text-muted">{m.layerHint}</p>
        </div>}
        <p className="leading-5 text-muted">{m.sourceSolid}</p>
      </>}
    </div>
  </SpatialCanvasPanel>;
}
