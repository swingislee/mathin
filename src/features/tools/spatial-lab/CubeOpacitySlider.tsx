"use client";

import { useEffect, useRef, useState } from "react";
import { Slider } from "@/components/ui/slider";

/** 滑块读数独立更新；场景预览每帧至多一次，松手只提交一个语义操作。 */
export function CubeOpacitySlider({ value, label, disabled, onPreview, onCommit }: {
  readonly value: number; readonly label: string; readonly disabled: boolean;
  readonly onPreview: (value: number | null) => void; readonly onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  const frame = useRef(0);
  const latest = useRef(value);
  const preview = useRef(onPreview);
  useEffect(() => { preview.current = onPreview; }, [onPreview]);
  useEffect(() => () => { cancelAnimationFrame(frame.current); preview.current(null); }, []);
  function change(next: number) {
    setDraft(next); latest.current = next;
    if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; preview.current(latest.current); });
  }
  function finish(next: number) {
    cancelAnimationFrame(frame.current); frame.current = 0;
    setDraft(next); onPreview(null); onCommit(next);
  }
  return <div className="space-y-1" data-cube-opacity-slider>
    <div className="flex items-center justify-between gap-2"><span>{label}</span><output className="tabular-nums">{draft}%</output></div>
    <Slider className="h-11 cursor-ew-resize [&_[role=slider]]:h-6 [&_[role=slider]]:w-6" aria-label={label} aria-valuetext={draft + "%"}
      value={[draft]} min={0} max={100} step={1} disabled={disabled}
      onValueChange={([next]) => change(next)} onValueCommit={([next]) => finish(next)}
      onPointerCancel={() => { cancelAnimationFrame(frame.current); frame.current = 0; setDraft(value); onPreview(null); }} />
  </div>;
}
