"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SpatialActionIcon } from "../spatial-interaction/SpatialActionIcon";
import type { SolidEntity } from "../solid-geometry/solid-geometry-contract";
import { MEASUREMENT_UNITS, type MeasurementV2Settings } from "./measurement-v2-contract";
import { accumulationSupport, formatModelMeasurement } from "./measurement-units";

export function MeasurementUnitsControls({ settings, selected, locale, disabled, onChange, onExample }: {
  settings: MeasurementV2Settings; selected: SolidEntity | null; locale: string; disabled: boolean;
  onChange: (settings: MeasurementV2Settings) => void; onExample?: (settings: MeasurementV2Settings) => void;
}) {
  const en = locale === "en", support = accumulationSupport(selected, settings.accumulation), total = support.available ? support.total : 0;
  const count = Math.min(total, settings.accumulationCount);
  const modes = { none: en ? "Off" : "收起累积", length: en ? "Along an edge" : "沿边排单位长", area: en ? "Cover one layer" : "铺一层单位面", volume: en ? "Fill the solid" : "堆满单位体" };
  const changeCount = (accumulationCount: number) => onChange({ ...settings, enabled: true, unitFill: false, accumulationCount });
  return <div className="space-y-3" data-measurement-units="v2">
    <p className="leading-5 text-muted">{en ? "The model scale assigns a real unit to each model interval. It does not measure pixels or the physical screen. Changing only the display unit preserves the same quantity and geometry." : "模型标尺为每个模型间隔指定单位，不是测量屏幕上的实际长度。只切换读数单位时，数量与模型大小保持不变。"}</p>
    <div className="space-y-1"><Label className="text-xs">{en ? "One model interval" : "每个模型间隔代表"}</Label><div className="flex flex-wrap gap-1">{MEASUREMENT_UNITS.map((unit) => <Button key={unit} size="sm" variant={settings.unit === unit ? "secondary" : "ghost"} aria-pressed={settings.unit === unit} disabled={disabled} onClick={() => onChange({ ...settings, unit, displayUnit: unit })}>1 {unit === "unit" ? "u" : unit}</Button>)}</div></div>
    <div className="space-y-1"><Label className="text-xs">{en ? "Show equivalent values in" : "等量换算为"}</Label><div className="flex flex-wrap gap-1">{MEASUREMENT_UNITS.filter((unit) => settings.unit === "unit" ? unit === "unit" : unit !== "unit").map((unit) => <Button key={unit} size="sm" variant={settings.displayUnit === unit ? "secondary" : "ghost"} aria-pressed={settings.displayUnit === unit} disabled={disabled} onClick={() => onChange({ ...settings, displayUnit: unit })}>{unit === "unit" ? "u" : unit}</Button>)}</div></div>
    <div className="leading-5" data-unit-conversion>{([1, 2, 3] as const).map((power) => <p key={power}>1 {settings.unit === "unit" ? "u" : settings.unit}{power === 1 ? "" : power === 2 ? "²" : "³"} = {formatModelMeasurement(1, locale, power, settings)}</p>)}</div>
    <div className="flex flex-wrap gap-1" role="group" aria-label={en ? "Unit accumulation" : "单位累积"}>{(["none", "length", "area", "volume"] as const).map((mode) => <Button key={mode} size="sm" variant={settings.accumulation === mode ? "secondary" : "ghost"} aria-pressed={settings.accumulation === mode} disabled={disabled} onClick={() => onChange({ ...settings, enabled: true, unitFill: false, accumulation: mode, accumulationCount: 0 })}>{modes[mode]}</Button>)}</div>
    {settings.accumulation !== "none" && (!support.available ? <p className="leading-5 text-muted">{en ? "Choose a cube or cuboid with whole-number sides from 1 to 12 model units; fractional dimensions are kept exact." : "选择各边为 1–12 个整数模型单位的正方体或长方体；小数尺寸保持原值，不近似铺满。"}</p> : <div className="space-y-2">
      <p>{count} / {total}</p><div className="flex flex-wrap gap-1">
        <Button size="sm" variant="secondary" disabled={disabled || count >= total} onClick={() => changeCount(count + 1)}><SpatialActionIcon action="increase" className="mr-1 size-3.5" />{en ? "Add one unit" : "加一个单位"}</Button>
        <Button size="sm" variant="secondary" disabled={disabled || count === total} onClick={() => changeCount(total)}><SpatialActionIcon action="play" className="mr-1 size-3.5" />{en ? "Accumulate all" : "依次排满"}</Button>
        <Button size="sm" variant="ghost" disabled={disabled || count === 0} onClick={() => changeCount(0)}><SpatialActionIcon action="reset" className="mr-1 size-3.5" />{en ? "Clear units" : "清空单位"}</Button>
      </div>
    </div>)}
    {onExample && selected && <Button size="sm" variant="secondary" disabled={disabled} onClick={() => onExample({ ...settings, enabled: true, unit: "cm", displayUnit: "dm", unitFill: false, accumulation: "volume", accumulationCount: 0 })}>{en ? "Explore 1 dm³ = 1,000 cm³" : "演示 1 dm³ = 1000 cm³"}</Button>}
  </div>;
}
