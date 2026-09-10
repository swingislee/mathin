"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Minus, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

/** 大小与位置合成贴边面板；标题分别控制显隐，位置轨道只表达上下。 */
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
  const [sizeOpen, setSizeOpen] = useState(true);
  const [positionOpen, setPositionOpen] = useState(true);
  const railHeight = Math.max(44, Math.min(128, height * 0.2, height - 188));
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
  const expanded = visible.filter((control) => control.open);
  return (
    <div className="pointer-events-auto absolute right-0 z-50 rounded-l-lg border border-r-0 border-line/70 bg-paper/90 shadow-sm backdrop-blur-sm"
      style={{ width: visible.length * 44 + 3, top: Math.max(4, (height - 80 - railHeight - 112) / 2) }} data-classroom-viewport-controls>
      <div className="flex px-px">
        {visible.map((control) => (
          <Button key={control.key} type="button" variant="ghost"
            className="h-11 min-w-0 flex-1 flex-col gap-0.5 rounded-none px-0 text-[11px] text-muted hover:bg-moon/25 data-[expanded=true]:text-ink"
            data-expanded={control.open} aria-label={control.toggleLabel} title={control.toggleLabel} aria-expanded={control.open} onClick={control.toggle}>
            <span>{control.shortLabel}</span>
            {control.open ? <ChevronUp aria-hidden size={10} /> : <ChevronDown aria-hidden size={10} />}
          </Button>
        ))}
      </div>
      {expanded.length > 0 && (
        <div className="flex justify-around border-t border-line/50 pb-3 pt-2">
          {expanded.map((control) => (
            <div key={control.key} className="flex w-11 flex-col items-center gap-1.5" data-classroom-viewport-control={control.key}>
              <control.startIcon aria-hidden size={12} className="text-muted" />
              <Slider orientation="vertical" aria-label={control.label} aria-valuetext={control.valueText}
                value={[control.value]} min={control.min} max={control.max} step={1} disabled={control.disabled}
                onValueChange={([next]) => control.onChange(next)} onValueCommit={onCommit}
                style={{ height: railHeight }} className="w-11 data-[disabled]:opacity-35 [&>span:first-child]:w-0.5 [&>span:first-child]:bg-crater/45 [&>span:first-child>span]:bg-transparent"
                thumbClassName="relative h-2.5 w-5 cursor-ns-resize rounded-sm border border-crater/60 bg-paper after:absolute after:left-1/2 after:top-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']" />
              <control.endIcon aria-hidden size={12} className="text-muted" />
              <output className="h-3 text-[10px] leading-none tabular-nums text-muted" aria-hidden>{control.key === "size" ? control.disabled ? "—" : `${Math.round(value)}%` : ""}</output>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
