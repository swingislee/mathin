"use client";

import { SpatialActionIcon } from "../spatial-interaction/SpatialActionIcon";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SolidEntity } from "../solid-geometry/solid-geometry-contract";
import { createSolidSectionSettings, supportsSolidSection, type SolidSectionSettings } from "./solid-sections-contract";
import { solidSectionsMessages } from "./solid-sections-messages";

function SectionNumber({ label, value, min, max, step, suffix, disabled, decrease, increase, onChange }: {
  label: string; value: number; min: number; max: number; step: number; suffix: string; disabled: boolean; decrease: string; increase: string; onChange: (value: number) => void;
}) {
  const commit = (value: number) => onChange(Math.max(min, Math.min(max, Math.round(value * 1000) / 1000)));
  return <div className="space-y-1"><Label className="text-xs">{label}</Label><div className="flex items-center gap-1">
    <Button size="sm" variant="ghost" className="size-8 p-0" aria-label={`${decrease} ${label}`} disabled={disabled || value <= min} onClick={() => commit(value - step)}><SpatialActionIcon action="decrease" className="size-3.5" /></Button>
    <Input key={value} type="number" aria-label={label} defaultValue={Math.round(value * 1000) / 1000} min={min} max={max} step={step} disabled={disabled} className="h-8 min-w-0 flex-1"
      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} onBlur={(event) => {
        const next = Number(event.currentTarget.value);
        if (event.currentTarget.value.trim() && Number.isFinite(next) && next >= min && next <= max) commit(next); else event.currentTarget.value = String(value);
      }} />
    <span className="w-4 text-muted">{suffix}</span>
    <Button size="sm" variant="ghost" className="size-8 p-0" aria-label={`${increase} ${label}`} disabled={disabled || value >= max} onClick={() => commit(value + step)}><SpatialActionIcon action="increase" className="size-3.5" /></Button>
  </div></div>;
}
export function SolidSectionControls({ entity, settings, locale, disabled, onChange }: {
  entity: SolidEntity | null; settings: SolidSectionSettings; locale: string; disabled: boolean; onChange: (next: SolidSectionSettings) => void;
}) {
  const [precise, setPrecise] = useState(false);
  const m = solidSectionsMessages(locale), supported = !!entity && supportsSolidSection(entity.kind);
  const update = (patch: Partial<SolidSectionSettings>) => onChange({ ...settings, ...patch });
  const tiltAxes = settings.axis === "x" ? ["Y", "Z"] : settings.axis === "y" ? ["X", "Z"] : ["X", "Y"];
  return <div className="space-y-3 text-xs" data-solid-section-controls>
    <p className="leading-5 text-muted">{m.selectedOnly}</p>
    {!supported ? <p className="leading-5 text-muted">{m.unsupported}</p> : <>
      <div className="flex flex-wrap gap-1"><Button size="sm" variant={settings.enabled ? "secondary" : "ghost"} aria-pressed={settings.enabled} disabled={disabled} onClick={() => update({ enabled: !settings.enabled })}>{m.enabled}</Button>
        <Button size="sm" variant={settings.showPlane ? "secondary" : "ghost"} aria-pressed={settings.showPlane} disabled={disabled || !settings.enabled} onClick={() => update({ showPlane: !settings.showPlane })}>{m.showPlane}</Button></div>
      <p className="leading-5 text-muted">{m.hint}</p>
      <div className="space-y-1"><Label className="text-xs">{m.normal}</Label><div className="flex flex-wrap gap-1">
        {(["x", "y", "z"] as const).map((axis) => <Button key={axis} size="sm" variant={settings.axis === axis && settings.tiltA === 0 && settings.tiltB === 0 ? "secondary" : "ghost"} disabled={disabled} onClick={() => update({ enabled: true, axis, tiltA: 0, tiltB: 0 })}>{m.planeNames[axis]}</Button>)}
        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => update({ enabled: true, axis: "y", tiltA: 45, tiltB: -Math.asin(1 / Math.sqrt(3)) * 180 / Math.PI })}>{m.diagonal}</Button>
      </div></div>
      <div className="space-y-1"><Label className="text-xs">{m.removedSide}</Label><div className="flex flex-wrap gap-1">
        {(["none", "positive", "negative"] as const).map((side) => <Button key={side} size="sm" variant={settings.removedSide === side ? "secondary" : "ghost"} disabled={disabled} onClick={() => update({ enabled: true, removedSide: side })}>{side === "none" ? m.keep : side === "positive" ? m.removePositive : m.removeNegative}</Button>)}
      </div></div>
      <Button size="sm" variant="ghost" aria-expanded={precise} onClick={() => setPrecise(!precise)}><SpatialActionIcon action="expand" className={`mr-1 size-3.5 ${precise ? "rotate-180" : ""}`} />{m.precise}</Button>
      {precise && <div className="space-y-3">
        <SectionNumber label={m.offset} value={settings.offset * 100} min={-120} max={120} step={10} suffix="%" disabled={disabled} decrease={m.decrease} increase={m.increase} onChange={(value) => update({ enabled: true, offset: value / 100 })} />
        {(["tiltA", "tiltB"] as const).map((key, index) => <SectionNumber key={key} label={`${m.tilt} ${tiltAxes[index]}`} value={settings[key]} min={-90} max={90} step={5} suffix="°" disabled={disabled} decrease={m.decrease} increase={m.increase} onChange={(value) => update({ enabled: true, [key]: value })} />)}
      </div>}
      <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange({ ...createSolidSectionSettings(), enabled: true })}><SpatialActionIcon action="reset" className="mr-1 size-3.5" />{m.reset}</Button>
    </>}
  </div>;
}
