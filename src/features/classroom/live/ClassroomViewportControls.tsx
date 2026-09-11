"use client";

import { useId } from "react";
import { ChevronDown, ChevronUp, Minus, MoveVertical, Plus, ZoomIn } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

export type ClassroomViewportControl = "size" | "position";

export interface ClassroomViewportControlsProps {
  height: number;
  value: number;
  min: number;
  max: number;
  verticalPosition: number | null;
  onResize: (percent: number) => void;
  onPan: (position: number) => void;
  onCommit: () => void;
  open: Record<ClassroomViewportControl, boolean>;
  onToggle: (control: ClassroomViewportControl) => void;
}

/** 大小与位置图标保持上下排列，竖向滑块按需从工具组向左展开。 */
export function ClassroomViewportControls({ height, value, min, max, verticalPosition, onResize, onPan, onCommit, open, onToggle }: ClassroomViewportControlsProps) {
  const t = useTranslations("classroom.live");
  const id = useId();
  const controls = [
    { key: "size" as const, icon: ZoomIn, startIcon: Plus, endIcon: Minus,
      label: t("coursewareDisplaySize"), toggleLabel: t(open.size ? "hideCoursewareSizeSlider" : "showCoursewareSizeSlider"),
      value, min, max, disabled: min === max, valueText: t("displayWidthPercent", { value: Math.round(value) }), onChange: onResize },
    { key: "position" as const, icon: MoveVertical, startIcon: ChevronUp, endIcon: ChevronDown,
      label: t("displayVerticalPosition"), toggleLabel: t(open.position ? "hideVerticalPositionSlider" : "showVerticalPositionSlider"),
      value: 100 - (verticalPosition ?? 50), min: 0, max: 100, disabled: verticalPosition === null,
      valueText: t("displayPositionPercent", { value: Math.round(verticalPosition ?? 50) }), onChange: (next: number) => onPan(100 - next) },
  ];
  const railHeight = Math.max(44, Math.min(128, height - 240));
  return (
    <div className="relative flex w-11 flex-col gap-1" data-classroom-viewport-controls>
      {controls.map((control) => (
        <Button key={control.key} type="button" variant="ghost"
          className="pointer-events-auto size-11 shrink-0 rounded-xl p-0 text-muted hover:bg-paper/40 data-[expanded=true]:bg-paper/50 data-[expanded=true]:text-ink focus-visible:ring-inset focus-visible:ring-offset-0"
          data-expanded={open[control.key]} data-classroom-viewport-control={control.key}
          aria-label={control.toggleLabel} aria-expanded={open[control.key]} aria-controls={`${id}-${control.key}`} onClick={() => onToggle(control.key)}>
          <control.icon aria-hidden size={18} strokeWidth={1.75} />
        </Button>
      ))}
      <div className="pointer-events-none absolute bottom-0 right-[calc(100%+36px)] z-20 flex items-end gap-2">
        {controls.filter((control) => open[control.key]).map((control) => (
          <div key={control.key} id={`${id}-${control.key}`}
            className="pointer-events-auto flex w-13 shrink-0 flex-col items-center justify-center gap-1.5 rounded-2xl bg-paper/80 py-2 shadow-sm ring-1 ring-inset ring-paper/30 backdrop-blur-xl motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-2 motion-safe:duration-150"
            onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onToggle(control.key); } }}>
            <control.startIcon aria-hidden size={12} className="shrink-0 text-muted" />
            <Slider orientation="vertical" aria-label={control.label} aria-valuetext={control.valueText}
              value={[control.value]} min={control.min} max={control.max} step={1} disabled={control.disabled}
              onValueChange={([next]) => control.onChange(next)} onValueCommit={onCommit}
              style={{ height: railHeight }} className="w-11 shrink-0 data-[disabled]:opacity-35 [&>span:first-child]:w-0.5 [&>span:first-child]:bg-crater/45 [&>span:first-child>span]:bg-transparent"
              thumbClassName="relative h-2.5 w-5 cursor-ns-resize rounded-sm border border-crater/60 bg-paper after:absolute after:left-1/2 after:top-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']" />
            <control.endIcon aria-hidden size={12} className="shrink-0 text-muted" />
            <output className="h-3 shrink-0 text-[10px] leading-none tabular-nums text-muted" aria-hidden>{control.key === "size" ? control.disabled ? "—" : `${Math.round(value)}%` : ""}</output>
          </div>
        ))}
      </div>
    </div>
  );
}
