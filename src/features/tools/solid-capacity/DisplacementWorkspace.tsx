"use client";

import dynamic from "next/dynamic";
import { useCallback, useId, useMemo, useState, type ReactNode } from "react";
import { useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { SpatialAxisSnapButton, useSpatialAxisSnap } from "@/features/spatial-math/renderer-r3f/SpatialCameraControls";
import { SpatialActionButton } from "../spatial-interaction/SpatialActionButton";
import { SpatialActionIcon } from "../spatial-interaction/SpatialActionIcon";
import { SpatialCanvasPanel } from "../spatial-interaction/SpatialWorkbenchControls";
import { SPATIAL_ALL_VIEWS, SpatialViewButtons } from "../spatial-interaction/SpatialViewButtons";
import { useSpatialToolState } from "../spatial-interaction/useSpatialToolState";
import { useSceneCapture } from "../courseware/useSceneCapture";
import { useToolSnapshot } from "../scenes/useToolSnapshot";
import { createSolidGeometryInitial } from "../solid-geometry/solid-geometry-contract";
import styles from "../spatial-lab/CubeStructuresWorkbench.module.css";
import { createDefaultDisplacementInitial, displacementInitial, displacementSnapshot, displacementSnapshotSchema, type DisplacementInitial, type DisplacementSnapshot } from "./displacement-contract";
import { displacementBottomAtFraction, placeDisplacementBody, solveDisplacement, type DisplacementLimit } from "./displacement-math";
import { displacementMessages } from "./displacement-messages";
import { useDisplacementPresentation } from "./useDisplacementPresentation";
import { DisplacementScene } from "./DisplacementScene";

const Canvas = dynamic(() => import("../solid-geometry/SolidGeometryCanvas"), { ssr: false, loading: () => <Skeleton className="size-full" /> });
const noop = () => {}, emptyEntities: [] = [];
type Panel = "move" | "liquid" | "dimensions" | "settings";
export interface DisplacementWorkspaceProps {
  initial?: DisplacementInitial; onSnapshot?: (initial: DisplacementInitial | null) => void; readOnly?: boolean; workspaceSelector?: ReactNode;
  classroom?: { state?: DisplacementSnapshot; onChange?: (next: DisplacementSnapshot) => Promise<void> };
}
const number = (value: number) => Number(value.toFixed(2)).toString();
export function DisplacementWorkspace({ initial, onSnapshot, classroom, readOnly = false, workspaceSelector }: DisplacementWorkspaceProps) {
  const locale = useLocale() === "en" ? "en" : "zh", m = displacementMessages(locale), inputId = useId();
  const origin = useMemo(() => displacementSnapshot(initial ?? createDefaultDisplacementInitial()), [initial]);
  const host = useToolSnapshot(origin, classroom), snapshot = host.snapshot;
  const presentation = useDisplacementPresentation(snapshot, host.failed);
  const [dragging, setDragging] = useState(false), [limit, setLimit] = useState<DisplacementLimit | "invalid">(null);
  const readOnlyView = readOnly || Boolean(classroom && !classroom.onChange);
  const interactionDisabled = readOnlyView || host.publishing || presentation.animating;
  const disabled = interactionDisabled || dragging;
  const controls = useSpatialToolState<"orbit" | "pan", Panel>({ defaultTool: "orbit", panels: { move: "orbit", liquid: "orbit", dimensions: "orbit", settings: "orbit" } });
  const axisSnap = useSpatialAxisSnap(), result = solveDisplacement(presentation.frame);
  const frame = useMemo(() => ({ center: { x: 0, y: (snapshot.tank.height + snapshot.body.height + 0.4) / 2, z: 0 }, radius: Math.hypot(snapshot.tank.width, snapshot.tank.depth, snapshot.tank.height + snapshot.body.height + 1) / 2 }), [snapshot.tank.width, snapshot.tank.depth, snapshot.tank.height, snapshot.body.height]);
  const canvasState = useMemo(() => ({ ...createSolidGeometryInitial(), entities: [], selectedId: null, axes: snapshot.axes, grid: snapshot.grid, view: snapshot.view }), [snapshot.axes, snapshot.grid, snapshot.view]);
  const captureValue = useMemo(() => displacementInitial(snapshot), [snapshot]);
  const capture = useSceneCapture(disabled ? null : captureValue, onSnapshot);
  const update = useCallback((next: DisplacementSnapshot, direct = false) => {
    if (interactionDisabled) return false;
    const parsed = displacementSnapshotSchema.safeParse(next);
    if (!parsed.success) { setLimit("invalid"); return false; }
    const accepted = host.update(parsed.data);
    if (accepted && direct) presentation.acceptDirect(parsed.data);
    return accepted;
  }, [interactionDisabled, host, presentation]);
  const commitDirect = useCallback((next: DisplacementSnapshot) => update(next, true), [update]);
  const move = (bottom: number) => { const placed = placeDisplacementBody(snapshot, bottom); setLimit(placed.limit); controls.activateSelection(); update(placed.state); };
  const configure = (next: DisplacementSnapshot) => {
    const raised = { ...next, body: { ...next.body, bottom: next.tank.height + 0.4 } };
    if (update(raised)) { setLimit(null); controls.activateSelection(); }
  };
  const dimensionInput = (group: "tank" | "body", key: "width" | "height" | "depth") => <div key={`${group}-${key}`} className="flex items-center gap-2">
    <Label className="w-12 text-xs" htmlFor={`${inputId}-${group}-${key}`}>{m[key]}</Label>
    <Input id={`${inputId}-${group}-${key}`} aria-label={`${m[group === "tank" ? "tank" : "object"]} ${m[key]}`} key={snapshot[group][key]} type="number" min={group === "tank" ? 2 : 0.25} max={group === "tank" ? 12 : 5} step={0.25} className="h-8 w-24" defaultValue={snapshot[group][key]} disabled={disabled}
      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} onBlur={(event) => {
        const value = Number(event.currentTarget.value);
        if (event.currentTarget.value.trim() && Number.isFinite(value) && value !== snapshot[group][key]) configure({ ...snapshot, [group]: { ...snapshot[group], [key]: value } });
        event.currentTarget.value = String(snapshot[group][key]);
      }} /><span>{m.units}</span>
  </div>;
  return <section className={styles.workspace} data-workbench-mode="courseware" data-capacity-displacement-workspace aria-label={m.title} {...capture} {...controls.bindings}>
    <div className={styles.viewport}><div className={styles.canvas}>
      <Canvas state={canvasState} entities={emptyEntities} selectedId={null} frame={frame} cameraRevision={snapshot.cameraRevision} axisSnap={axisSnap} moveSnap={false}
        onPointerMissed={!disabled ? controls.onPointerMissed : undefined} navigationMode={controls.tool} moveAxis="y" onMoveAxis={noop} onMove={noop} onDragging={noop} readOnly={readOnlyView} fallback={m.fallback}
        renderScene={() => <DisplacementScene snapshot={snapshot} frame={presentation.frame} locale={locale} disabled={interactionDisabled} selectionActive={controls.selectionActive}
          onSelect={controls.activateSelection} onPreview={presentation.preview} onDragging={setDragging} onCommit={commitDirect} onLimit={setLimit} />} />
      <div className={`${styles.dock} ${styles.meta}`}>
        {workspaceSelector}
        <SpatialActionButton action="settings" label={m.settings} active={controls.panel === "settings"} disabled={readOnlyView} onClick={() => controls.togglePanel("settings")} />
        <SpatialActionButton action="reset" label={m.reset} disabled={disabled} onClick={() => { setLimit(null); update({ ...structuredClone(origin), cameraRevision: snapshot.cameraRevision + 1 }); controls.closePanel(); }} />
      </div>
      <div className={`${styles.dock} ${styles.views}`} aria-label={m.fit}>
        <SpatialViewButtons views={SPATIAL_ALL_VIEWS} value={snapshot.view} labels={m.views} disabled={disabled}
          onChange={(view) => update({ ...snapshot, view, cameraRevision: snapshot.cameraRevision + 1 })} fit={{ label: m.fit, onClick: () => update({ ...snapshot, cameraRevision: snapshot.cameraRevision + 1 }) }} />
        <SpatialAxisSnapButton messages={m} disabled={readOnlyView} iconOnly className={styles.icon} />
      </div>
      <div className={`${styles.dock} ${styles.tools}`} role="toolbar" aria-label={m.tools} data-displacement-tools-toolbar>
        <SpatialActionButton action="orbit" label={m.orbit} active={controls.tool === "orbit"} disabled={readOnlyView} onClick={() => controls.chooseTool("orbit")} />
        <SpatialActionButton action="pan" label={m.pan} active={controls.tool === "pan"} disabled={readOnlyView} onClick={() => controls.chooseTool("pan")} />
        <span className={styles.toolSeparator} />
        <SpatialActionButton action="move" label={m.move} active={controls.panel === "move"} disabled={readOnlyView} onClick={() => { controls.activateSelection(); controls.togglePanel("move"); }} />
        <SpatialActionButton action="liquid" label={m.liquid} active={controls.panel === "liquid"} disabled={readOnlyView} onClick={() => controls.togglePanel("liquid")} />
        <SpatialActionButton action="dimensions" label={m.dimensions} active={controls.panel === "dimensions"} disabled={readOnlyView} onClick={() => controls.togglePanel("dimensions")} />
        <SpatialActionButton action="amounts" label={m.amounts} active={snapshot.showAmounts} disabled={disabled} onClick={() => update({ ...snapshot, showAmounts: !snapshot.showAmounts })} />
      </div>
      {controls.panel && <SpatialCanvasPanel title={m[controls.panel]} closeLabel={m.close} anchor={controls.panel === "settings" ? "meta" : "tool"} onClose={controls.closePanel}>
        <div className="space-y-3 text-xs">
          {controls.panel === "move" && <>
            <div className="flex flex-wrap gap-1"><Button size="sm" variant="secondary" disabled={disabled} onClick={() => move(displacementBottomAtFraction(snapshot, 1))}>{m.immerse}</Button>
              <Button size="sm" variant="secondary" disabled={disabled} onClick={() => move(displacementBottomAtFraction(snapshot, 0.5))}>{m.halfway}</Button>
              <Button size="sm" variant="ghost" disabled={disabled} onClick={() => move(snapshot.tank.height + 0.4)}>{m.lift}</Button></div>
            <Label htmlFor={`${inputId}-bottom`} className="text-xs">{m.bottom}</Label>
            <div className="flex items-center gap-2"><Input key={snapshot.body.bottom} id={`${inputId}-bottom`} className="h-8 w-28" type="number" min={0} max={snapshot.tank.height + 1} step={0.1} defaultValue={number(snapshot.body.bottom)} disabled={disabled}
              onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} onBlur={(event) => { const value = Number(event.currentTarget.value); if (event.currentTarget.value.trim() && Number.isFinite(value)) move(value); else event.currentTarget.value = number(snapshot.body.bottom); }} /><span>{m.units}</span></div>
            <p className="leading-5 text-muted">{m.hint}</p>
          </>}
          {controls.panel === "liquid" && <>
            <Label htmlFor={`${inputId}-water`} className="text-xs">{m.initialWater}</Label>
            <div className="flex items-center gap-2"><Input key={snapshot.tank.waterHeight} id={`${inputId}-water`} type="number" min={0.1} max={snapshot.tank.height} step={0.1} className="h-8 w-28" defaultValue={snapshot.tank.waterHeight} disabled={disabled}
              onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} onBlur={(event) => { const value = Number(event.currentTarget.value); if (event.currentTarget.value.trim() && Number.isFinite(value)) configure({ ...snapshot, tank: { ...snapshot.tank, waterHeight: value } }); event.currentTarget.value = String(snapshot.tank.waterHeight); }} /><span>{m.units}</span></div>
            <p className="leading-5 text-muted">{m.waterHint}</p>
          </>}
          {controls.panel === "dimensions" && <>
            <div className="flex flex-wrap gap-1">{(["cuboid", "stepped"] as const).map((kind) => <Button key={kind} size="sm" variant={snapshot.body.kind === kind ? "secondary" : "ghost"} disabled={disabled} onClick={() => configure({ ...snapshot, body: { ...snapshot.body, kind } })}>{m[kind]}</Button>)}</div>
            {(["tank", "body"] as const).map((group) => <div key={group} className="space-y-2"><p>{m[group === "tank" ? "tank" : "object"]}</p>{(["width", "depth", "height"] as const).map((key) => dimensionInput(group, key))}</div>)}
            <p className="leading-5 text-muted">{m.dimensionsHint}</p>{snapshot.body.kind === "stepped" && <p className="leading-5 text-muted">{m.steppedHint}</p>}
          </>}
          {controls.panel === "settings" && <div className="flex flex-wrap gap-1">{([
            ["showInitialLevel", "baseline", "measure"], ["showDimensions", "labels", "dimensions"], ["axes", "axes", "axes"], ["grid", "grid", "grid"],
          ] as const).map(([key, label, action]) => <Button key={key} size="sm" variant={snapshot[key] ? "secondary" : "ghost"} aria-pressed={snapshot[key]} disabled={disabled} onClick={() => update({ ...snapshot, [key]: !snapshot[key] })}><SpatialActionIcon action={action} className="size-4" />{m[label]}</Button>)}</div>}
        </div>
      </SpatialCanvasPanel>}
      <div className={styles.cutStatus} data-displacement-readout>
        <p>{result.dry ? m.dry : result.fullySubmerged ? m.full : m.partial}</p>
        {snapshot.showAmounts ? <><p>{m.displaced}：{number(result.displacedVolume)} {m.volumeUnits}</p><p>{m.objectVolume}：{number(result.bodyVolume)} {m.volumeUnits}</p>
          <p>{m.initialWater} {number(snapshot.tank.waterHeight)} → {m.currentLevel} {number(result.waterHeight)} {m.units}</p><p>{m.water}：{number(result.waterVolume)} {m.volumeUnits}</p></> : <p className="text-muted">{m.hint}</p>}
      </div>
      {(limit || host.failed) && <p role="status" className={styles.notice}>{host.failed ? m.syncError : m[limit!]}</p>}
    </div></div>
  </section>;
}
