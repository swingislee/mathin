"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { SpatialAxisSnapButton, useSpatialAxisSnap } from "@/features/spatial-math/renderer-r3f/SpatialCameraControls";
import { SpatialActionButton } from "../spatial-interaction/SpatialActionButton";
import { SpatialActionIcon } from "../spatial-interaction/SpatialActionIcon";
import { SpatialViewButtons, SPATIAL_ALL_VIEWS } from "../spatial-interaction/SpatialViewButtons";
import { SpatialCanvasPanel } from "../spatial-interaction/SpatialWorkbenchControls";
import { useSpatialToolState } from "../spatial-interaction/useSpatialToolState";
import { useSpatialDirectCommit } from "../spatial-interaction/useSpatialDirectCommit";
import { useToolSnapshot } from "../scenes/useToolSnapshot";
import { useSceneCapture } from "../courseware/useSceneCapture";
import { createDefaultSolidRevolutionInitial, SOLID_REVOLUTION_SHAPES, SOLID_REVOLUTION_SPEEDS, solidRevolutionInitial, solidRevolutionSnapshot, solidRevolutionSnapshotSchema, type SolidRevolutionInitial, type SolidRevolutionSnapshot } from "./contract";
import { normalizeRevolutionAngle, pauseRevolution, planRevolution, resumeRevolution } from "./model";
import { solidRevolutionMessages } from "./messages";
import { useRevolutionPresentation } from "./useRevolutionPresentation";
import styles from "../spatial-lab/CubeStructuresWorkbench.module.css";

const Viewport = dynamic(() => import("./SolidRevolutionCanvas").then((module) => module.SolidRevolutionCanvas), { ssr: false, loading: () => <Skeleton className="size-full" /> });
function AngleInput({ angle, label, disabled, onCommit }: { angle: number; label: string; disabled: boolean; onCommit: (angle: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return <Input aria-label={label} className="h-8 w-20" type="number" min={0} max={360} step={15} value={draft ?? Math.round(angle * 10) / 10} disabled={disabled}
    onChange={(event) => setDraft(event.target.value)}
    onBlur={() => { if (draft === null) return; const value = Number(draft); setDraft(null); if (draft.trim() && Number.isFinite(value) && value >= 0 && value <= 360) onCommit(value); }}
    onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />;
}
export interface SolidRevolutionWorkspaceProps {
  initial?: SolidRevolutionInitial; onSnapshot?: (initial: SolidRevolutionInitial | null) => void; readOnly?: boolean;
  classroom?: { state?: SolidRevolutionSnapshot; onChange?: (next: SolidRevolutionSnapshot) => Promise<void> };
}
export function SolidRevolutionWorkspace({ initial, onSnapshot, readOnly = false, classroom }: SolidRevolutionWorkspaceProps) {
  const locale = useLocale() === "en" ? "en" : "zh", m = solidRevolutionMessages(locale);
  const origin = useMemo(() => solidRevolutionSnapshot(initial ?? createDefaultSolidRevolutionInitial()), [initial]);
  const host = useToolSnapshot(origin, classroom), direct = useSpatialDirectCommit(host.snapshot, host.failed), snapshot = direct.displayed;
  const [preview, setPreview] = useState<number | null>(null), [dragging, setDragging] = useState(false);
  const [edgeOn, setEdgeOn] = useState(false);
  const presentation = useRevolutionPresentation(snapshot);
  const readOnlyView = readOnly || !!(classroom && !classroom.onChange), publishing = readOnlyView || host.publishing;
  const controls = useSpatialToolState<"orbit" | "pan", "shape" | "rotation" | "settings">({ defaultTool: "orbit", panels: { shape: "orbit", rotation: "orbit", settings: "orbit" }, onClearSelection: () => { setPreview(null); setEdgeOn(false); } });
  const axisSnap = useSpatialAxisSnap();
  const update = (next: SolidRevolutionSnapshot) => {
    if (publishing) return false;
    const parsed = solidRevolutionSnapshotSchema.safeParse(next); return parsed.success && host.update(parsed.data);
  };
  const frozen = () => pauseRevolution(snapshot);
  const directAngle = (angle: number) => {
    const next = { ...frozen(), angle: normalizeRevolutionAngle(angle) };
    if (!update(next)) return false;
    direct.hold(next); setPreview(null); return true;
  };
  const animatedAngle = (angle: number) => { direct.clear(); update(planRevolution(snapshot, angle, Date.now(), 650)); };
  const configure = (patch: Partial<SolidRevolutionInitial>) => { direct.clear(); setPreview(null); update({ ...frozen(), ...patch }); };
  const captureValue = useMemo(() => solidRevolutionInitial(snapshot), [snapshot]);
  const capture = useSceneCapture(publishing || dragging || presentation.playing || preview !== null ? null : captureValue, onSnapshot);
  const angle = preview ?? presentation.angle, disabledShape = publishing || dragging;
  return <section className={styles.workspace} data-workbench-mode="courseware" data-solid-revolution-workspace="v1" aria-label={m.title} {...capture} {...controls.bindings}>
    <div className={styles.viewport}><div className={styles.canvas}>
      <Viewport snapshot={snapshot} angle={angle} locale={locale} navigation={controls.tool} axisSnap={axisSnap} interactive={!readOnlyView}
        gestureEnabled={!publishing && !presentation.playing} selected={controls.selectionActive} onSelect={controls.activateSelection}
        onPreview={(value) => { setPreview(value); if (value !== null) setEdgeOn(false); }} onCommit={directAngle} onDragging={setDragging} onPointerMissed={controls.onPointerMissed} onUnavailable={() => setEdgeOn(true)} />
      <div className={`${styles.dock} ${styles.meta}`}>
        <SpatialActionButton action="settings" label={m.settings} active={controls.panel === "settings"} disabled={readOnlyView} onClick={() => controls.togglePanel("settings")} />
        <SpatialActionButton action="reset" label={m.reset} disabled={publishing || dragging} onClick={() => { direct.clear(); setPreview(null); update({ ...structuredClone(origin), cameraRevision: snapshot.cameraRevision + 1 }); controls.closePanel(); }} />
      </div>
      <div className={`${styles.dock} ${styles.views}`}>
        <SpatialViewButtons views={SPATIAL_ALL_VIEWS} value={snapshot.view} labels={m.views} disabled={publishing || dragging}
          onChange={(view) => update({ ...snapshot, view, cameraRevision: snapshot.cameraRevision + 1 })}
          fit={{ label: m.fit, onClick: () => update({ ...snapshot, cameraRevision: snapshot.cameraRevision + 1 }) }} />
        <SpatialAxisSnapButton messages={m} disabled={readOnlyView} iconOnly className={styles.icon} />
      </div>
      <div className={`${styles.dock} ${styles.tools}`} role="toolbar" aria-label={m.tools}>
        <SpatialActionButton action="orbit" label={m.orbit} active={controls.tool === "orbit"} disabled={readOnlyView} onClick={() => controls.chooseTool("orbit")} />
        <SpatialActionButton action="pan" label={m.pan} active={controls.tool === "pan"} disabled={readOnlyView} onClick={() => controls.chooseTool("pan")} />
        <span className={styles.toolSeparator} />
        <SpatialActionButton action="dimensions" label={m.shape} active={controls.panel === "shape"} disabled={readOnlyView} onClick={() => controls.togglePanel("shape")} />
        <SpatialActionButton action="rotate" label={m.rotation} active={controls.panel === "rotation"} disabled={readOnlyView} onClick={() => controls.togglePanel("rotation")} />
        <SpatialActionButton action={presentation.playing ? "pause" : "play"} label={presentation.playing ? m.pause : m.play} disabled={publishing || dragging}
          onClick={() => { direct.clear(); update(presentation.playing ? frozen() : resumeRevolution(snapshot)); }} />
        <SpatialActionButton action="firstStep" label={m.restart} disabled={publishing || dragging} onClick={() => animatedAngle(0)} />
        <span className={styles.toolSeparator} />
        <SpatialActionButton action="sweep" label={m.sweep} active={snapshot.showSweep} disabled={publishing} onClick={() => update({ ...snapshot, showSweep: !snapshot.showSweep })} />
        <SpatialActionButton action="paperLayout" label={m.start} active={snapshot.showStart} disabled={publishing} onClick={() => update({ ...snapshot, showStart: !snapshot.showStart })} />
        <SpatialActionButton action="measure" label={m.measures} active={snapshot.showMeasures} disabled={publishing} onClick={() => update({ ...snapshot, showMeasures: !snapshot.showMeasures })} />
      </div>
      {controls.panel && <SpatialCanvasPanel title={m[controls.panel]} closeLabel={m.close} anchor={controls.panel === "settings" ? "meta" : "tool"} onClose={controls.closePanel}>
        <div className="space-y-3 text-xs">
          {controls.panel === "shape" && <>
            <div className="grid grid-cols-2 gap-1">{SOLID_REVOLUTION_SHAPES.map((shape) => <Button key={shape} size="sm" variant={snapshot.shape === shape ? "secondary" : "ghost"} aria-pressed={snapshot.shape === shape} disabled={disabledShape} onClick={() => configure({ shape, angle: 0 })}>{m[shape]}</Button>)}</div>
            {(["width", "height"] as const).map((key) => <Label key={key} className="flex items-center justify-between gap-2 text-xs">{m[key]}<Input className="h-8 w-20" type="number" min={0.5} max={6} step={0.5} value={snapshot[key]} disabled={disabledShape} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value) && value >= 0.5 && value <= 6) configure({ [key]: value, angle: 0 }); }} /></Label>)}
            <Label className="text-xs">{m.axis}</Label><div className="grid grid-cols-2 gap-1">{(["height", "width"] as const).map((axis) => <Button key={axis} size="sm" variant={snapshot.axis === axis ? "secondary" : "ghost"} aria-pressed={snapshot.axis === axis} disabled={disabledShape} onClick={() => configure({ axis, angle: 0 })}>{axis === "height" ? m.axisHeight : m.axisWidth}</Button>)}</div>
            <p className="text-muted">{m.axisHint}</p>
          </>}
          {controls.panel === "rotation" && <>
            <Label className="flex items-center justify-between text-xs">{m.angle}<AngleInput label={m.angle} angle={angle} disabled={publishing || dragging || presentation.playing} onCommit={animatedAngle} /></Label>
            <Slider aria-label={m.angle} min={0} max={360} step={1} value={[angle]} disabled={publishing || dragging || presentation.playing} onValueChange={([value]) => setPreview(value)} onValueCommit={([value]) => { directAngle(value); }} onPointerCancel={() => setPreview(null)} />
            <div className="grid grid-cols-4 gap-1">{[0, 90, 180, 360].map((value) => <Button key={value} size="sm" variant="secondary" disabled={publishing || dragging} onClick={() => animatedAngle(value)}>{value}°</Button>)}</div>
            <Label className="text-xs">{m.speed}</Label><div className="grid grid-cols-3 gap-1">{SOLID_REVOLUTION_SPEEDS.map((speed, index) => <Button key={speed} size="sm" variant={snapshot.speed === speed ? "secondary" : "ghost"} aria-pressed={snapshot.speed === speed} disabled={publishing || dragging}
              onClick={() => { const next = { ...frozen(), speed }; direct.clear(); update(presentation.playing ? resumeRevolution(next) : next); }}>{[m.slow, m.normal, m.fast][index]}</Button>)}</div>
          </>}
          {controls.panel === "settings" && <div className="flex flex-wrap gap-1">{(["axes", "grid"] as const).map((key) => <Button key={key} size="sm" variant={snapshot[key] ? "secondary" : "ghost"} aria-pressed={snapshot[key]} disabled={publishing} onClick={() => update({ ...snapshot, [key]: !snapshot[key] })}><SpatialActionIcon action={key} className="size-3.5" />{m[key]}</Button>)}</div>}
        </div>
      </SpatialCanvasPanel>}
      <div className={styles.cutStatus}><strong>{m[snapshot.shape === "rectangle" ? "cylinder" : "cone"]} · {Math.round(angle)}°</strong><p>{m.gesture}</p></div>
      {(host.failed || edgeOn) && <p className={styles.notice} role={host.failed ? "alert" : "status"}>{host.failed ? m.failed : m.edgeOn}</p>}
    </div></div>
  </section>;
}
