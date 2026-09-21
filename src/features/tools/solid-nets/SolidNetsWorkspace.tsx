"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Box, FoldHorizontal, Hand, Hash, Orbit, Paintbrush, Redo2, RotateCcw, Ruler, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { SpatialAxisSnapButton, useSpatialAxisSnap } from "@/features/spatial-math/renderer-r3f/SpatialCameraControls";
import { CubeCanvasPanel, CubeColorPicker, CubeIconButton, CubeViewIcon } from "../spatial-lab/CubeWorkbenchControls";
import { CUBE_WORKBENCH_VIEWS } from "../spatial-lab/cube-workbench-camera";
import { cubeStructuresMessages } from "../spatial-lab/cube-structures-messages";
import type { CubeColor } from "../spatial-lab/cube-structures-contract";
import type { CubeNetFoldChange, CubeNetPaperSelection } from "../spatial-lab/cube-net-fold-drag";
import { useCubeNetPlayback } from "../spatial-lab/useCubeNetPlayback";
import { useToolSnapshot } from "../scenes/useToolSnapshot";
import styles from "../spatial-lab/CubeStructuresWorkbench.module.css";
import { createDefaultSolidNetsSnapshot, resizeSolidNet, SOLID_NETS_LIMITS, solidNetsSnapshotSchema, type SolidNetsSnapshot } from "./contract";
import { solidNetGeometry, type SolidNetDimensions } from "./geometry";
import { solidNetAllMotion, solidNetSnapshotTransition } from "./model";
import { solidNetsMessages } from "./messages";
import { useSpatialToolState } from "../spatial-interaction/useSpatialToolState";

const SolidNetsViewport = dynamic(() => import("./SolidNetsViewport").then((module) => module.SolidNetsViewport), { ssr: false });
export interface SolidNetsWorkspaceProps {
  locale: "zh" | "en"; initial?: SolidNetsSnapshot; onSnapshot?: (value: SolidNetsSnapshot | null) => void;
  runtime?: { state?: SolidNetsSnapshot; onChange?: (next: SolidNetsSnapshot) => Promise<void> };
  readOnly?: boolean; courseware?: boolean; workspaceSelector?: ReactNode;
}
const same = (a: SolidNetsSnapshot, b: SolidNetsSnapshot) => JSON.stringify(a) === JSON.stringify(b);

export function SolidNetsWorkspace({ locale, initial, runtime, onSnapshot, readOnly = false, courseware, workspaceSelector }: SolidNetsWorkspaceProps) {
  const [start] = useState(() => solidNetsSnapshotSchema.parse(initial ?? createDefaultSolidNetsSnapshot()));
  const [preview, setPreview] = useState<SolidNetsSnapshot | null>(null), pendingLocal = useRef<SolidNetsSnapshot | null>(null);
  const historyIntent = useRef<"undo" | "redo" | null>(null);
  const protectedRuntime = useMemo(() => runtime && { state: runtime.state, onChange: runtime.onChange ? async (next: SolidNetsSnapshot) => {
    try { await runtime.onChange!(next); } catch (error) { pendingLocal.current = null; historyIntent.current = null; setPreview(null); throw error; }
  } : undefined }, [runtime]);
  const state = useToolSnapshot(start, protectedRuntime), { snapshot, update, publishing } = state;
  const readonly = readOnly || (!!runtime && !runtime.onChange);
  const interrupt = useCallback(() => { historyIntent.current = null; setPreview(null); }, []);
  const playback = useCubeNetPlayback<SolidNetsSnapshot>({ essential: true, interactive: !readonly, onInterrupt: interrupt });
  const controls = useSpatialToolState<"fold" | "orbit" | "pan" | "select", "shape" | "style">({ defaultTool: "fold", onClearSelection: () => { setSelected(null); setActive(null); }, panels: { shape: "select", style: "select" } });
  const { tool, panel, chooseTool, togglePanel, closePanel } = controls;
  const [selected, setSelected] = useState<string | null>("base");
  const [active, setActive] = useState<CubeNetPaperSelection | null>(null), [dragging, setDragging] = useState(false), [cameraKey, setCameraKey] = useState(0);
  const [past, setPast] = useState<SolidNetsSnapshot[]>([]), [future, setFuture] = useState<SolidNetsSnapshot[]>([]), previous = useRef(snapshot);
  const m = solidNetsMessages(locale), shared = cubeStructuresMessages(locale), axisSnap = useSpatialAxisSnap();
  const busy = dragging || playback.playing || publishing, visible = playback.frame ?? preview ?? snapshot;
  const geometry = useMemo(() => solidNetGeometry(snapshot.kind, snapshot.dimensions), [snapshot.kind, snapshot.dimensions]);
  const flat = Object.values(snapshot.angles).every((angle) => angle === 0);
  const closed = geometry.hinges.every((hinge) => Math.abs(snapshot.angles[hinge.id] - hinge.closedDegrees) < 1e-8);
  const selectedSurface = selected ? snapshot.surfaces[selected] : null;
  const selectedHinge = geometry.hinges.find((hinge) => hinge.faceId === selected);
  const animationStart = playback.start;
  useLayoutEffect(() => {
    const old = previous.current; if (same(old, snapshot)) return; previous.current = snapshot;
    if (historyIntent.current === "undo") { setPast((values) => values.slice(0, -1)); setFuture((values) => [old, ...values].slice(0, SOLID_NETS_LIMITS.history)); }
    else if (historyIntent.current === "redo") { setFuture((values) => values.slice(1)); setPast((values) => [...values, old].slice(-SOLID_NETS_LIMITS.history)); }
    else { setPast((values) => [...values, old].slice(-SOLID_NETS_LIMITS.history)); setFuture([]); }
    historyIntent.current = null;
    const alreadyDisplayed = pendingLocal.current && same(pendingLocal.current, snapshot);
    pendingLocal.current = null; setPreview(null);
    if (runtime && !alreadyDisplayed) { const motion = solidNetSnapshotTransition(old, snapshot); if (motion) animationStart({ ...motion, onFinish: () => {} }); }
  }, [snapshot, runtime, animationStart]);
  useEffect(() => { onSnapshot?.(busy || preview ? null : snapshot); }, [busy, preview, snapshot, onSnapshot]);
  const commit = useCallback((next: SolidNetsSnapshot, displayed = false) => {
    if (readonly || publishing) return false;
    const parsed = solidNetsSnapshotSchema.safeParse(next);
    if (!parsed.success || same(parsed.data, snapshot)) { setPreview(null); return false; }
    if (displayed) pendingLocal.current = parsed.data;
    if (!update(parsed.data)) { pendingLocal.current = null; return false; }
    if (displayed && runtime) setPreview(parsed.data);
    return true;
  }, [readonly, publishing, update, snapshot, runtime]);
  const previewFold = useCallback((change: CubeNetFoldChange | null) => setPreview(change
    ? { ...snapshot, angles: { ...snapshot.angles, [change.edgeId]: change.degrees }, anchor: { ...change.anchor, vertices: [...change.anchor.vertices] } } : null), [snapshot]);
  const commitFold = useCallback((change: CubeNetFoldChange) => {
    commit({ ...snapshot, angles: { ...snapshot.angles, [change.edgeId]: change.degrees }, anchor: { ...change.anchor, vertices: [...change.anchor.vertices] } }, true);
  }, [snapshot, commit]);
  const beginFold = useCallback((selection: CubeNetPaperSelection) => { setActive(selection); setSelected(selection.faceId); }, []);
  const select = useCallback((id: string) => { setSelected(id); setActive(null); }, []);
  const animateTo = (next: SolidNetsSnapshot) => {
    const motion = solidNetSnapshotTransition(snapshot, next); setActive(null);
    if (!motion) { commit(next); return; }
    playback.start({ ...motion, onFinish: () => { commit(next, true); } });
  };
  const all = (folded: boolean) => {
    const motion = solidNetAllMotion(snapshot, folded); setActive(null); setPreview(null);
    playback.start({ ...motion, onFinish: () => { commit(motion.target, true); } });
  };
  const dimensionChange = (key: keyof SolidNetDimensions, raw: string) => {
    const value = Number(raw); if (!Number.isFinite(value) || value < SOLID_NETS_LIMITS.minDimension || value > SOLID_NETS_LIMITS.maxDimension) return;
    commit(resizeSolidNet(snapshot, { ...snapshot.dimensions, [key]: value })); setActive(null); setCameraKey((v) => v + 1);
  };
  const surfaceChange = (change: { color?: CubeColor; label?: string; opacity?: number }) => {
    if (selected && selectedSurface) commit({ ...snapshot, surfaces: { ...snapshot.surfaces, [selected]: { ...selectedSurface, ...change } } });
  };
  return <div className={styles.workspace} data-workbench-mode={courseware ? "courseware" : undefined} data-solid-nets-workbench aria-busy={busy} {...controls.bindings}>
    <div className={styles.viewport}><div className={styles.canvas} data-cube-workspace-frame="4:3">
      <SolidNetsViewport snapshot={visible} locale={locale} tool={tool} dragging={dragging} active={active} selected={selected}
        onPointerMissed={!readonly && !busy ? controls.onPointerMissed : undefined}
        axisSnapEnabled={axisSnap} cameraRequestKey={cameraKey} interactive={!readonly && !publishing && !playback.playing}
        onFoldStart={beginFold} onPreview={previewFold} onCommit={commitFold} onDraggingChange={setDragging} onFaceSelect={select} />
      {workspaceSelector && <div className={cn(styles.dock, styles.meta)}>{workspaceSelector}</div>}
      <div className={cn(styles.dock, styles.views)} role="toolbar" aria-label={shared.view}>
        {CUBE_WORKBENCH_VIEWS.map((view) => <CubeIconButton key={view} label={shared[view]} active={snapshot.view === view} disabled={readonly || busy}
          onClick={() => { commit({ ...snapshot, view }); setCameraKey((value) => value + 1); }}><CubeViewIcon view={view} /></CubeIconButton>)}
        <SpatialAxisSnapButton iconOnly className={styles.icon} messages={{ axisSnap: m.snap, enableAxisSnap: m.snapOn, disableAxisSnap: m.snapOff }} disabled={busy} />
      </div>
      <div className={cn(styles.dock, styles.tools)} role="toolbar" aria-label={shared.tools}>
        <CubeIconButton label={m.fold} active={tool === "fold"} disabled={readonly || busy} onClick={() => chooseTool("fold")}><FoldHorizontal aria-hidden /></CubeIconButton>
        <CubeIconButton label={shared.orbit} active={tool === "orbit"} disabled={readonly || busy} onClick={() => chooseTool("orbit")}><Orbit aria-hidden /></CubeIconButton>
        <CubeIconButton label={shared.pan} active={tool === "pan"} disabled={readonly || busy} onClick={() => chooseTool("pan")}><Hand aria-hidden /></CubeIconButton>
        <span className={styles.toolSeparator} aria-hidden />
        <CubeIconButton label={m.shape} active={panel === "shape"} disabled={readonly || busy} onClick={() => togglePanel("shape")}><Ruler aria-hidden /></CubeIconButton>
        <CubeIconButton label={m.style} active={panel === "style"} disabled={readonly || busy} onClick={() => togglePanel("style")}><Paintbrush aria-hidden /></CubeIconButton>
        <CubeIconButton label={m.labels} active={snapshot.labelsVisible} disabled={readonly || busy} onClick={() => commit({ ...snapshot, labelsVisible: !snapshot.labelsVisible })}><Hash aria-hidden /></CubeIconButton>
        <span className={styles.toolSeparator} aria-hidden />
        <CubeIconButton label={m.foldAll} disabled={readonly || busy || closed} onClick={() => all(true)}><Box aria-hidden /></CubeIconButton>
        <CubeIconButton label={m.unfold} disabled={readonly || busy || (flat && !snapshot.anchor)} onClick={() => all(false)}><FoldHorizontal className="rotate-90" aria-hidden /></CubeIconButton>
        <CubeIconButton label={m.undo} disabled={readonly || busy || !past.length} onClick={() => { historyIntent.current = "undo"; animateTo(past.at(-1)!); }}><Undo2 aria-hidden /></CubeIconButton>
        <CubeIconButton label={m.redo} disabled={readonly || busy || !future.length} onClick={() => { historyIntent.current = "redo"; animateTo(future[0]); }}><Redo2 aria-hidden /></CubeIconButton>
        <CubeIconButton label={m.reset} disabled={readonly || busy} onClick={() => { animateTo(start); setActive(null); setCameraKey((value) => value + 1); }}><RotateCcw aria-hidden /></CubeIconButton>
      </div>
      {panel && <CubeCanvasPanel title={panel === "shape" ? m.shape : m.style} closeLabel={shared.closePanel} onClose={closePanel}>
        <div className="space-y-3">
          {panel === "shape" && <>
            <div className="flex flex-wrap gap-1">{(["cuboid", "triangular-prism"] as const).map((kind) => <Button key={kind} size="sm" variant={snapshot.kind === kind ? "secondary" : "ghost"}
              aria-pressed={snapshot.kind === kind} disabled={readonly || busy} onClick={() => { if (kind === snapshot.kind) return; commit(createDefaultSolidNetsSnapshot(kind)); setSelected("base"); setActive(null); setCameraKey((value) => value + 1); }}>{kind === "cuboid" ? m.cuboid : m.prism}</Button>)}</div>
            {(["width", "height", "depth"] as const).map((key) => <Label key={key} className="grid gap-1 text-xs">
              {snapshot.kind === "cuboid" ? m[key] : key === "width" ? m.baseWidth : key === "height" ? m.baseHeight : m.prismLength}
              <Input type="number" min={SOLID_NETS_LIMITS.minDimension} max={SOLID_NETS_LIMITS.maxDimension} step={0.25}
                value={snapshot.dimensions[key]} disabled={readonly || busy || !flat} onKeyDown={(event) => event.stopPropagation()} onChange={(event) => dimensionChange(key, event.target.value)} />
            </Label>)}
            {!flat && <p className="text-xs text-muted">{m.sizeHelp}</p>}
          </>}
          {panel === "style" && <><p className="text-xs text-muted">{m.selectHelp}</p>
            <div className="flex flex-wrap gap-1">{geometry.faces.map((face) => <Button key={face.id} size="sm" variant={selected === face.id ? "secondary" : "ghost"} aria-pressed={selected === face.id}
              onClick={() => select(face.id)}>{snapshot.surfaces[face.id].label || face.id}</Button>)}</div>
            {selectedSurface && <>
              <p className="text-xs text-muted">{m.selected}: {selectedSurface.label || selected}</p>
              <CubeColorPicker value={selectedSurface.color} labels={shared.colors} label={shared.colorLabel} disabled={readonly || busy} onChange={(color) => surfaceChange({ color })} />
              <Label className="grid gap-1 text-xs">{m.label}<Input value={selectedSurface.label} maxLength={8} disabled={readonly || busy} onKeyDown={(event) => event.stopPropagation()} onChange={(event) => surfaceChange({ label: event.target.value })} /></Label>
              <Label className="grid gap-2 text-xs">{m.opacity}<Slider value={[Math.round(selectedSurface.opacity * 100)]} min={0} max={100} step={10} disabled={readonly || busy} aria-label={m.opacity} onValueChange={([value]) => surfaceChange({ opacity: value / 100 })} /></Label>
              {selectedHinge && <div className="flex flex-wrap gap-1">
                <Button variant="secondary" size="sm" disabled={readonly || busy} onClick={() => animateTo({ ...snapshot, angles: { ...snapshot.angles, [selectedHinge.id]: selectedHinge.closedDegrees } })}>{m.foldFace}</Button>
                <Button variant="secondary" size="sm" disabled={readonly || busy} onClick={() => animateTo({ ...snapshot, angles: { ...snapshot.angles, [selectedHinge.id]: 0 } })}>{m.openFace}</Button>
              </div>}
            </>}
          </>}
        </div>
      </CubeCanvasPanel>}
      {state.failed && <div className={styles.notice} role="status">{m.failed}</div>}
      <p className="sr-only">{m.help}</p>
    </div></div>
  </div>;
}
