"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { newId } from "@/lib/uuid";
import { SpatialAxisSnapButton, useSpatialAxisSnap } from "@/features/spatial-math/renderer-r3f/SpatialCameraControls";
import { SpatialActionButton } from "../spatial-interaction/SpatialActionButton";
import { SPATIAL_ACTIONS } from "../spatial-interaction/actions";
import { SpatialViewButtons } from "../spatial-interaction/SpatialViewButtons";
import { SpatialCanvasPanel, SpatialColorPicker } from "../spatial-interaction/SpatialWorkbenchControls";
import { useSpatialToolState } from "../spatial-interaction/useSpatialToolState";
import { useSpatialDirectCommit } from "../spatial-interaction/useSpatialDirectCommit";
import { cubeStructuresMessages } from "../spatial-lab/cube-structures-messages";
import { CUBE_WORKBENCH_VIEWS } from "../spatial-lab/cube-workbench-camera";
import { useCubeNetPlayback } from "../spatial-lab/useCubeNetPlayback";
import { useToolSnapshot } from "../scenes/useToolSnapshot";
import styles from "../spatial-lab/CubeStructuresWorkbench.module.css";
import { curvedNetSnapshotSchema, type CurvedNetSnapshot, type CurvedPart, type CurvedProgress } from "./curved-contract";
import { curvedClosedProgress, curvedMotionOrder, curvedNetAt, curvedParts, curvedSectorAngle, curvedSlant } from "./curved-model";

const Viewport = dynamic(() => import("./CurvedNetsViewport").then((m) => m.CurvedNetsViewport), { ssr: false });
export function CurvedNetsWorkspace({ locale, initial, runtime, readOnly, onSnapshot, shapeSelector, onReset }: {
  locale: "zh" | "en"; initial: CurvedNetSnapshot; runtime?: { state?: CurvedNetSnapshot; onChange?: (next: CurvedNetSnapshot) => Promise<void> };
  readOnly?: boolean; onSnapshot?: (next: CurvedNetSnapshot | null) => void; shapeSelector?: ReactNode; onReset?: () => void;
}) {
  const [start] = useState(() => curvedNetSnapshotSchema.parse(initial));
  const state = useToolSnapshot(start, runtime), { snapshot, publishing, failed, update } = state;
  const direct = useSpatialDirectCommit(snapshot, failed);
  const [preview, setPreview] = useState<CurvedNetSnapshot | null>(null), [dragging, setDragging] = useState(false), [selected, setSelected] = useState<CurvedPart | null>(null), [cameraKey, setCameraKey] = useState(0);
  const [past, setPast] = useState<CurvedNetSnapshot[]>([]), [future, setFuture] = useState<CurvedNetSnapshot[]>([]), intent = useRef<"undo" | "redo" | null>(null), previous = useRef(snapshot);
  const readonly = Boolean(readOnly || runtime && !runtime.onChange), zh = locale === "zh", m = cubeStructuresMessages(locale), axisSnap = useSpatialAxisSnap();
  const playback = useCubeNetPlayback<CurvedNetSnapshot>({ essential: true, interactive: false });
  const [finishedMotion, setFinishedMotion] = useState<string | null>(null);
  const { start: play, seekFrom, cancel: cancelPlayback } = playback;
  useLayoutEffect(() => {
    if (!snapshot.motion) { cancelPlayback(); return; }
    const motion = snapshot.motion; seekFrom(motion.startedAt);
    play({ durationMs: motion.durationMs, sample: (elapsed) => curvedNetAt(snapshot, motion.startedAt + elapsed), onFinish: () => setFinishedMotion(motion.id) });
    return cancelPlayback;
  }, [snapshot, play, seekFrom, cancelPlayback]);
  const playing = Boolean(snapshot.motion && snapshot.motion.id !== finishedMotion);
  const resting = snapshot.motion ? curvedNetAt(snapshot, snapshot.motion.startedAt + (playing ? 0 : snapshot.motion.durationMs)) : snapshot;
  const visible = preview ?? (direct.displayed !== snapshot ? direct.displayed : playback.frame ?? resting);
  const busy = dragging || playing || publishing;
  const controls = useSpatialToolState<"fold" | "orbit" | "pan" | "select", "shape" | "style">({ defaultTool: "fold", panels: { shape: "fold", style: "select" }, onClearSelection: () => setSelected(null) });
  useEffect(() => { onSnapshot?.(busy || preview ? null : curvedNetAt(snapshot, Date.now())); }, [snapshot, busy, preview, onSnapshot]);
  useEffect(() => {
    const old = previous.current; if (old === snapshot) return; previous.current = snapshot;
    if (intent.current === "undo") { setPast((v) => v.slice(0, -1)); setFuture((v) => [curvedNetAt(old, Date.now()), ...v].slice(0, 30)); }
    else if (intent.current === "redo") { setFuture((v) => v.slice(1)); setPast((v) => [...v, curvedNetAt(old, Date.now())].slice(-30)); }
    else { setPast((v) => [...v, curvedNetAt(old, snapshot.motion?.startedAt ?? Date.now())].slice(-30)); setFuture([]); }
    intent.current = null;
  }, [snapshot]);
  const commit = useCallback((next: CurvedNetSnapshot, displayed = false) => {
    if (readonly || publishing) return;
    const parsed = curvedNetSnapshotSchema.safeParse(next); if (!parsed.success) return;
    if (displayed) direct.hold(parsed.data);
    if (update(parsed.data)) setPreview(null);
  }, [readonly, publishing, direct, update]);
  const animate = (progress: CurvedProgress) => {
    const from = curvedNetAt(snapshot, Date.now()), steps = curvedMotionOrder(from.progress, progress);
    if (!steps.length) return;
    commit({ ...from, progress, motion: { id: newId(), from: from.progress, startedAt: Date.now(), durationMs: steps.length * 1250 } });
  };
  const stop = () => { const next = curvedNetAt(snapshot, Date.now()); playback.cancel(); commit(next, true); };
  const previewPart = useCallback((part: CurvedPart, value: number | null) => setPreview(value === null ? null : { ...snapshot, motion: null, progress: { ...snapshot.progress, [part]: value } }), [snapshot]);
  const commitPart = useCallback((part: CurvedPart, value: number) => commit({ ...snapshot, motion: null, progress: { ...snapshot.progress, [part]: value } }, true), [snapshot, commit]);
  const names = zh ? { side: "侧面", lower: "底面", upper: "另一底面" } : { side: "Side", lower: "Base", upper: "Other base" };
  const shapeTitle = zh ? "立体与尺寸" : "Solid and dimensions", styleTitle = zh ? "纸面样式" : "Paper appearance";
  const flat = Object.values(snapshot.progress).every((v) => v === 0), closed = curvedParts(snapshot).every((p) => snapshot.progress[p] === 1);
  return <div className={styles.workspace} data-workbench-mode="courseware" data-curved-nets-workbench aria-busy={busy} {...controls.bindings}>
    <div className={styles.viewport}><div className={styles.canvas} data-cube-workspace-frame="4:3">
      <Viewport snapshot={visible} locale={locale} interactive={!readonly && !publishing && !playing} cameraInteractive={!readonly} dragging={dragging} tool={controls.tool} selected={selected} axisSnap={axisSnap} cameraKey={cameraKey}
        onSelect={setSelected} onPreview={previewPart} onCommit={commitPart} onDragging={setDragging} onPointerMissed={!busy ? controls.onPointerMissed : undefined} />
      <div className={cn(styles.dock, styles.views)} role="toolbar" aria-label={m.view}>
        <SpatialViewButtons views={CUBE_WORKBENCH_VIEWS} value={snapshot.view} labels={m} disabled={readonly || busy} onChange={(view) => { commit({ ...visible, view }); setCameraKey((v) => v + 1); }} fit={{ label: SPATIAL_ACTIONS.fit[locale], onClick: () => setCameraKey((v) => v + 1) }} />
        <SpatialAxisSnapButton iconOnly className={styles.icon} disabled={busy} messages={{ axisSnap: zh ? "视角吸附" : "Camera snap", enableAxisSnap: zh ? "开启视角吸附" : "Enable camera snap", disableAxisSnap: zh ? "关闭视角吸附" : "Disable camera snap" }} />
      </div>
      <div className={cn(styles.dock, styles.tools)} role="toolbar" aria-label={m.tools}>
        <SpatialActionButton action="fold" label={SPATIAL_ACTIONS.fold[locale]} active={controls.tool === "fold"} disabled={readonly || busy} onClick={() => controls.chooseTool("fold")} />
        <SpatialActionButton action="orbit" label={SPATIAL_ACTIONS.orbit[locale]} active={controls.tool === "orbit"} disabled={readonly || busy} onClick={() => controls.chooseTool("orbit")} />
        <SpatialActionButton action="pan" label={SPATIAL_ACTIONS.pan[locale]} active={controls.tool === "pan"} disabled={readonly || busy} onClick={() => controls.chooseTool("pan")} />
        <span className={styles.toolSeparator} />
        <SpatialActionButton action="dimensions" label={shapeTitle} active={controls.panel === "shape"} disabled={readonly || busy} onClick={() => controls.togglePanel("shape")} />
        <SpatialActionButton action="faceColor" label={styleTitle} active={controls.panel === "style"} disabled={readonly || busy} onClick={() => controls.togglePanel("style")} />
        <SpatialActionButton action="labels" label={SPATIAL_ACTIONS.labels[locale]} active={snapshot.labelsVisible} disabled={readonly || busy} onClick={() => commit({ ...visible, labelsVisible: !snapshot.labelsVisible })} />
        <span className={styles.toolSeparator} />
        <SpatialActionButton action="foldAll" label={SPATIAL_ACTIONS.foldAll[locale]} disabled={readonly || busy || closed} onClick={() => animate(curvedClosedProgress(snapshot))} />
        <SpatialActionButton action="unfold" label={SPATIAL_ACTIONS.unfold[locale]} disabled={readonly || busy || flat} onClick={() => animate({ side: 0, lower: 0, upper: 0 })} />
        <SpatialActionButton action="pause" label={SPATIAL_ACTIONS.pause[locale]} disabled={readonly || !playing || publishing} onClick={stop} />
        <SpatialActionButton action="undo" label={SPATIAL_ACTIONS.undo[locale]} disabled={readonly || busy || !past.length} onClick={() => { intent.current = "undo"; commit(past.at(-1)!); }} />
        <SpatialActionButton action="redo" label={SPATIAL_ACTIONS.redo[locale]} disabled={readonly || busy || !future.length} onClick={() => { intent.current = "redo"; commit(future[0]); }} />
        <SpatialActionButton action="reset" label={SPATIAL_ACTIONS.reset[locale]} disabled={readonly || publishing || dragging} onClick={() => { playback.cancel(); if (onReset) onReset(); else commit(start); setCameraKey((v) => v + 1); }} />
      </div>
      {controls.panel && <SpatialCanvasPanel title={controls.panel === "shape" ? shapeTitle : styleTitle} closeLabel={m.closePanel} onClose={controls.closePanel}>
        <div className="space-y-3">{controls.panel === "shape" ? <>
          {shapeSelector}
          {(["radius", "height"] as const).map((key) => <Label className="grid gap-1 text-xs" key={key}>{key === "radius" ? zh ? "底面半径 r" : "Base radius r" : zh ? "高 h" : "Height h"}
            <Input type="number" min={0.25} max={key === "radius" ? 4 : 8} step={0.25} value={snapshot[key]} disabled={readonly || busy || !flat} onChange={(e) => { const value = Number(e.target.value); if (value >= 0.25 && value <= (key === "radius" ? 4 : 8)) { commit({ ...visible, [key]: value }); setCameraKey((v) => v + 1); } }} />
          </Label>)}
          <p className="text-xs text-muted">{zh ? "对应的圆周和侧面边界用同色表示。拖动纸面卷起或展开；改变尺寸前先全部展开。" : "Matching rim and side edges share a color. Drag paper to roll or unroll; unfold before resizing."}</p>
          <p className="text-xs">{snapshot.kind === "cylinder" ? `2πr = ${(2 * Math.PI * snapshot.radius).toFixed(2)} · h = ${snapshot.height}` : `${zh ? "母线" : "Slant"} = ${curvedSlant(snapshot).toFixed(2)} · ${zh ? "扇形圆心角" : "Sector angle"} = ${(curvedSectorAngle(snapshot) * 180 / Math.PI).toFixed(1)}°`}</p>
          {curvedParts(snapshot).map((part) => <Label className="grid gap-1 text-xs" key={part}>{names[part]} · {zh ? "卷合进度" : "Fold progress"} %
            <Input key={`${part}-${Math.round(visible.progress[part] * 100)}`} type="number" min={0} max={100} step={10} disabled={readonly || busy} defaultValue={Math.round(visible.progress[part] * 100)} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} onBlur={(e) => { const value = Number(e.target.value); if (e.target.value.trim() && value >= 0 && value <= 100) animate({ ...snapshot.progress, [part]: value / 100 }); }} />
          </Label>)}
        </> : <>
          <div className="flex flex-wrap gap-1">{curvedParts(snapshot).map((part) => <Button size="sm" variant={selected === part ? "secondary" : "ghost"} key={part} onClick={() => setSelected(part)}>{names[part]}</Button>)}</div>
          {selected && <><SpatialColorPicker value={snapshot.surfaces[selected].color} labels={m.colors} label={m.colorLabel} disabled={readonly || busy} onChange={(color) => commit({ ...visible, surfaces: { ...snapshot.surfaces, [selected]: { ...snapshot.surfaces[selected], color } } })} />
            <Label className="grid gap-1 text-xs">{zh ? "不透明度 %" : "Opacity %"}<Input type="number" min={0} max={100} step={10} value={Math.round(snapshot.surfaces[selected].opacity * 100)} disabled={readonly || busy} onChange={(e) => { const n = Number(e.target.value); if (n >= 0 && n <= 100) commit({ ...visible, surfaces: { ...snapshot.surfaces, [selected]: { ...snapshot.surfaces[selected], opacity: n / 100 } } }); }} /></Label></>}
        </>}</div>
      </SpatialCanvasPanel>}
      {failed && <div className={styles.notice} role="status">{zh ? "同步未成功，请重试。" : "Sync failed. Please retry."}</div>}
    </div></div>
  </div>;
}
