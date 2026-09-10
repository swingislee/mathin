"use client";

import { useId, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Minus, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

/** 大小在上、位置在下；各自向右收起，保留贴边标签和原来的纵向位置。 */
export function ClassroomViewportControls({ focused, height, value, min, max, verticalPosition, onResize, onPan, onCommit }: {
  focused: boolean;
  height: number;
  value: number;
  min: number;
  max: number;
  verticalPosition: number | null;
  onResize: (percent: number) => void;
  onPan: (position: number) => void;
  onCommit: () => void;
}) {
  const t = useTranslations("classroom.live");
  const id = useId();
  const [sizeOpen, setSizeOpen] = useState(true);
  const [positionOpen, setPositionOpen] = useState(true);
  const controls = [
    { key: "size", visible: true, open: sizeOpen, toggle: () => setSizeOpen((open) => !open),
      startIcon: Plus, endIcon: Minus,
      shortLabel: t("coursewareSizeShort"), label: t("coursewareDisplaySize"), toggleLabel: t(sizeOpen ? "hideCoursewareSizeSlider" : "showCoursewareSizeSlider"),
      value, min, max, disabled: min === max, valueText: t("displayWidthPercent", { value: Math.round(value) }), onChange: onResize },
    { key: "position", visible: focused, open: positionOpen, toggle: () => setPositionOpen((open) => !open),
      startIcon: ChevronUp, endIcon: ChevronDown,
      shortLabel: t("verticalPositionShort"), label: t("displayVerticalPosition"), toggleLabel: t(positionOpen ? "hideVerticalPositionSlider" : "showVerticalPositionSlider"),
      value: 100 - (verticalPosition ?? 50), min: 0, max: 100, disabled: verticalPosition === null,
      valueText: t("displayPositionPercent", { value: Math.round(verticalPosition ?? 50) }), onChange: (next: number) => onPan(100 - next) },
  ];
  const visible = controls.filter((control) => control.visible);
  const gapHeight = (visible.length - 1) * 4;
  const railHeight = Math.max(44, Math.min(128, (height - 88 - gapHeight) / visible.length - 72));
  const panelHeight = visible.length * (railHeight + 72) + gapHeight;
  return (
    <div className="pointer-events-none absolute right-0 z-50 flex w-[92px] flex-col gap-1 overflow-hidden"
      style={{ top: Math.max(4, (height - 80 - panelHeight) / 2) }} data-classroom-viewport-controls>
      {visible.map((control) => (
        <div key={control.key} className="flex w-[92px] items-center transition-transform duration-200 data-[expanded=false]:translate-x-12 motion-reduce:transition-none"
          style={{ height: railHeight + 72 }} data-expanded={control.open} data-classroom-viewport-control={control.key}>
          <Button key={control.key} type="button" variant="ghost"
            className="pointer-events-auto h-11 w-11 shrink-0 flex-col gap-0.5 rounded-l-lg rounded-r-none border border-r-0 border-line/70 bg-paper/90 px-0 text-[11px] text-muted shadow-sm backdrop-blur-sm hover:bg-paper data-[expanded=true]:text-ink focus-visible:ring-inset focus-visible:ring-offset-0"
            data-expanded={control.open} aria-label={control.toggleLabel} title={control.toggleLabel} aria-expanded={control.open} aria-controls={`${id}-${control.key}`} onClick={control.toggle}>
            <span>{control.shortLabel}</span>
            {control.open ? <ChevronRight aria-hidden size={10} /> : <ChevronLeft aria-hidden size={10} />}
          </Button>
          <div id={`${id}-${control.key}`} inert={!control.open} aria-hidden={!control.open}
            className="pointer-events-auto flex h-full w-12 shrink-0 flex-col items-center justify-center gap-1.5 rounded-l-lg border border-r-0 border-line/70 bg-paper/90 py-2 shadow-sm backdrop-blur-sm">
            <control.startIcon aria-hidden size={12} className="shrink-0 text-muted" />
            <Slider orientation="vertical" aria-label={control.label} aria-valuetext={control.valueText}
              value={[control.value]} min={control.min} max={control.max} step={1} disabled={control.disabled}
              onValueChange={([next]) => control.onChange(next)} onValueCommit={onCommit}
              style={{ height: railHeight }} className="w-11 shrink-0 data-[disabled]:opacity-35 [&>span:first-child]:w-0.5 [&>span:first-child]:bg-crater/45 [&>span:first-child>span]:bg-transparent"
              thumbClassName="relative h-2.5 w-5 cursor-ns-resize rounded-sm border border-crater/60 bg-paper after:absolute after:left-1/2 after:top-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']" />
            <control.endIcon aria-hidden size={12} className="shrink-0 text-muted" />
            <output className="h-3 shrink-0 text-[10px] leading-none tabular-nums text-muted" aria-hidden>{control.key === "size" ? control.disabled ? "—" : `${Math.round(value)}%` : ""}</output>
          </div>
        </div>
      ))}
    </div>
  );
}
