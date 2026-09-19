"use client";

import { Minus, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SolidEntity } from "../solid-geometry/solid-geometry-contract";
import type { SolidSectionFrame } from "./solid-sections-motion";
import { createSolidSectionSettings, supportsSolidSection, type SolidSectionSettings } from "./solid-sections-contract";
import { intersectSolidSection, sectionFlatPoints, solidSectionPlane } from "./solid-sections";
import { solidSectionsMessages } from "./solid-sections-messages";

function SectionNumber({ label, value, min, max, step, suffix, disabled, decrease, increase, onChange }: {
  label: string; value: number; min: number; max: number; step: number; suffix: string; disabled: boolean; decrease: string; increase: string; onChange: (value: number) => void;
}) {
  const commit = (value: number) => onChange(Math.max(min, Math.min(max, Math.round(value * 1000) / 1000)));
  return <div className="space-y-1"><Label className="text-xs">{label}</Label><div className="flex items-center gap-1">
    <Button size="sm" variant="ghost" className="size-8 p-0" aria-label={`${decrease} ${label}`} disabled={disabled || value <= min} onClick={() => commit(value - step)}><Minus className="size-3.5" /></Button>
    <Input key={value} type="number" aria-label={label} defaultValue={Math.round(value * 1000) / 1000} min={min} max={max} step={step} disabled={disabled} className="h-8 min-w-0 flex-1"
      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} onBlur={(event) => {
        const next = Number(event.currentTarget.value);
        if (event.currentTarget.value.trim() && Number.isFinite(next) && next >= min && next <= max) commit(next); else event.currentTarget.value = String(value);
      }} />
    <span className="w-4 text-muted">{suffix}</span>
    <Button size="sm" variant="ghost" className="size-8 p-0" aria-label={`${increase} ${label}`} disabled={disabled || value >= max} onClick={() => commit(value + step)}><Plus className="size-3.5" /></Button>
  </div></div>;
}
/** 平视预览只显示计算所得截口，不移动 3D 相机，也不提供答案或判定。 */
export function SolidSectionPreview({ entity, frame, locale }: { entity: SolidEntity; frame: SolidSectionFrame; locale: string }) {
  const m = solidSectionsMessages(locale), result = intersectSolidSection(entity, solidSectionPlane(entity, frame.normal, frame.offset));
  const flat = sectionFlatPoints(result, frame.normal), extent = Math.max(0.2, ...flat.flatMap((point) => [Math.abs(point.x), Math.abs(point.y)]));
  const points = flat.map((point) => `${60 + point.x / extent * 48},${60 - point.y / extent * 48}`).join(" ");
  const label = result.kind === "polygon" ? `${result.points.length} ${m.polygon}${result.crossesInterior ? "" : ` · ${m.boundary}`}` : m[result.kind];
  return <figure className="m-0 space-y-1" data-solid-section-preview>
    <figcaption className="text-muted">{m.preview} · {label}</figcaption>
    {!!flat.length && <svg role="img" aria-label={`${m.preview} · ${label}`} viewBox="0 0 120 120" className="mx-auto h-24 w-24 text-rose">
      {result.kind === "polygon" ? <polygon points={points} fill="currentColor" fillOpacity=".16" stroke="currentColor" strokeWidth="2" />
        : result.kind === "segment" ? <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" /> : <circle cx="60" cy="60" r="3" fill="currentColor" />}
    </svg>}
  </figure>;
}
export function SolidSectionControls({ entity, settings, frame, locale, disabled, onChange }: {
  entity: SolidEntity | null; settings: SolidSectionSettings; frame: SolidSectionFrame; locale: string; disabled: boolean; onChange: (next: SolidSectionSettings) => void;
}) {
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
      <SectionNumber label={m.offset} value={settings.offset * 100} min={-120} max={120} step={10} suffix="%" disabled={disabled} decrease={m.decrease} increase={m.increase} onChange={(value) => update({ enabled: true, offset: value / 100 })} />
      {(["tiltA", "tiltB"] as const).map((key, index) => <SectionNumber key={key} label={`${m.tilt} ${tiltAxes[index]}`} value={settings[key]} min={-90} max={90} step={5} suffix="°" disabled={disabled} decrease={m.decrease} increase={m.increase} onChange={(value) => update({ enabled: true, [key]: value })} />)}
      <div className="space-y-1"><Label className="text-xs">{m.removedSide}</Label><div className="flex flex-wrap gap-1">
        {(["none", "positive", "negative"] as const).map((side) => <Button key={side} size="sm" variant={settings.removedSide === side ? "secondary" : "ghost"} disabled={disabled} onClick={() => update({ enabled: true, removedSide: side })}>{side === "none" ? m.keep : side === "positive" ? m.removePositive : m.removeNegative}</Button>)}
      </div></div>
      {settings.enabled && <SolidSectionPreview entity={entity} frame={frame} locale={locale} />}
      <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange({ ...createSolidSectionSettings(), enabled: true })}><RotateCcw className="mr-1 size-3.5" />{m.reset}</Button>
    </>}
  </div>;
}
