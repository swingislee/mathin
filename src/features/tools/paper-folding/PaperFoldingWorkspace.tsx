"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { FoldHorizontal, Grid2X2, Hand, Hash, Orbit, Paintbrush, Redo2, RotateCcw, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { createDefaultPaperFoldingSnapshot, editPaperLayout, PAPER_FOLDING_LIMITS, paperFoldingSnapshotSchema, type PaperFoldingSnapshot } from "./contract";
import { paperSnapshotTransition, paperUnfoldMotion } from "./model";
import { PaperLayoutEditor } from "./PaperLayoutEditor";
import { paperFoldingMessages } from "./messages";
import { useSpatialToolState } from "../spatial-interaction/useSpatialToolState";

const PaperFoldingViewport = dynamic(() => import("./PaperFoldingViewport").then((module) => module.PaperFoldingViewport), { ssr: false });

export interface PaperFoldingWorkspaceProps {
  locale: "zh" | "en"; initial?: PaperFoldingSnapshot; onSnapshot?: (value: PaperFoldingSnapshot | null) => void;
  runtime?: { state?: PaperFoldingSnapshot; onChange?: (next: PaperFoldingSnapshot) => Promise<void> };
  readOnly?: boolean; courseware?: boolean; workspaceSelector?: ReactNode;
}
const same = (left: PaperFoldingSnapshot, right: PaperFoldingSnapshot) => JSON.stringify(left) === JSON.stringify(right);

export function PaperFoldingWorkspace({ locale, initial, runtime, onSnapshot, readOnly = false, courseware, workspaceSelector }: PaperFoldingWorkspaceProps) {
  const [start] = useState(() => paperFoldingSnapshotSchema.parse(initial ?? createDefaultPaperFoldingSnapshot()));
  const [preview, setPreview] = useState<PaperFoldingSnapshot | null>(null);
  const pendingLocal = useRef<PaperFoldingSnapshot | null>(null), historyIntent = useRef<"undo" | "redo" | null>(null);
  const protectedRuntime = useMemo(() => runtime && { state: runtime.state, onChange: runtime.onChange ? async (next: PaperFoldingSnapshot) => {
    try { await runtime.onChange!(next); }
    catch (error) { pendingLocal.current = null; historyIntent.current = null; setPreview(null); throw error; }
  } : undefined }, [runtime]);
  const state = useToolSnapshot(start, protectedRuntime), snapshot = state.snapshot;
  const { update, publishing } = state;
  const m = paperFoldingMessages(locale), shared = cubeStructuresMessages(locale);
  const playback = useCubeNetPlayback<PaperFoldingSnapshot>({ essential: true, interactive: !readOnly });
  const controls = useSpatialToolState<"fold" | "orbit" | "pan" | "select", "layout" | "style">({ defaultTool: "fold", onClearSelection: () => { setSelected(null); setActive(null); }, panels: { layout: "select", style: "select" } });
  const { tool, panel, chooseTool, togglePanel, closePanel } = controls;
  const [selected, setSelected] = useState<string | null>(snapshot.squares[0].id);
  const [active, setActive] = useState<CubeNetPaperSelection | null>(null);
  const [dragging, setDragging] = useState(false), [cameraKey, setCameraKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [past, setPast] = useState<PaperFoldingSnapshot[]>([]), [future, setFuture] = useState<PaperFoldingSnapshot[]>([]);
  const previous = useRef(snapshot);
  const axisSnap = useSpatialAxisSnap();
  const readonly = readOnly || (!!runtime && !runtime.onChange);
  const busy = dragging || playback.playing || state.publishing;
  const visible = playback.frame ?? preview ?? snapshot;
  const selectedFace = snapshot.squares.find((square) => square.id === selected) ?? null;
  const animationStart = playback.start;
  useLayoutEffect(() => {
    const old = previous.current;
    if (same(old, snapshot)) return;
    previous.current = snapshot;
    if (historyIntent.current === "undo") {
      setPast((values) => values.slice(0, -1)); setFuture((values) => [old, ...values].slice(0, PAPER_FOLDING_LIMITS.history));
    } else if (historyIntent.current === "redo") {
      setFuture((values) => values.slice(1)); setPast((values) => [...values, old].slice(-PAPER_FOLDING_LIMITS.history));
    } else {
      setPast((values) => [...values, old].slice(-PAPER_FOLDING_LIMITS.history)); setFuture([]);
    }
    historyIntent.current = null;
    const locallyDisplayed = pendingLocal.current && same(pendingLocal.current, snapshot);
    pendingLocal.current = null; setPreview(null);
    if (runtime && !locallyDisplayed) {
      const motion = paperSnapshotTransition(old, snapshot);
      if (motion) animationStart({ ...motion, onFinish: () => {} });
    }
  }, [snapshot, runtime, animationStart]);
  useEffect(() => { onSnapshot?.(busy || preview ? null : snapshot); }, [busy, preview, snapshot, onSnapshot]);

  const commit = useCallback((next: PaperFoldingSnapshot, displayed = false) => {
    if (readonly || publishing) return false;
    const parsed = paperFoldingSnapshotSchema.safeParse(next);
    if (!parsed.success || same(snapshot, parsed.data)) { setPreview(null); return false; }
    if (displayed) pendingLocal.current = parsed.data;
    if (!update(parsed.data)) { pendingLocal.current = null; return false; }
    if (displayed && runtime) setPreview(parsed.data);
    setNotice(null); return true;
  }, [readonly, publishing, update, snapshot, runtime]);
  const previewFold = useCallback((change: CubeNetFoldChange | null) => {
    setPreview(change ? { ...snapshot, angles: { ...snapshot.angles, [change.edgeId]: change.degrees }, anchor: { ...change.anchor, vertices: [...change.anchor.vertices] } } : null);
  }, [snapshot]);
  const commitFold = useCallback((change: CubeNetFoldChange) => {
    commit({ ...snapshot, angles: { ...snapshot.angles, [change.edgeId]: change.degrees }, anchor: { ...change.anchor, vertices: [...change.anchor.vertices] } }, true);
  }, [commit, snapshot]);
  const beginFold = useCallback((selection: CubeNetPaperSelection) => { setActive(selection); setSelected(selection.faceId); setNotice(null); }, []);
  const unfold = () => {
    const motion = paperUnfoldMotion(snapshot); setActive(null); setPreview(null); setNotice(null);
    playback.start({ ...motion, onFinish: () => { commit(motion.target, true); } });
  };
  const edit = (change: Parameters<typeof editPaperLayout>[1]) => {
    const result = editPaperLayout(snapshot, change);
    if (!result.ok) { setNotice(m[result.reason]); return; }
    commit(result.snapshot);
    if (change.kind === "add") setSelected(result.snapshot.squares.at(-1)!.id);
    else if (selected === change.id) setSelected(result.snapshot.squares[0].id);
  };
  const setSurface = (change: { color?: CubeColor; label?: string }) => {
    if (!selectedFace) return;
    commit({ ...snapshot, squares: snapshot.squares.map((square) => square.id === selectedFace.id ? { ...square, ...change } : square) });
  };
  const select = useCallback((id: string) => { setSelected(id); setActive(null); }, []);
  const viewportProps = useMemo(() => ({ snapshot: visible, locale, tool, dragging, active, axisSnapEnabled: axisSnap, cameraRequestKey: cameraKey,
    interactive: !readonly && !state.publishing && !playback.playing, onFoldStart: beginFold, onPreview: previewFold, onCommit: commitFold, onDraggingChange: setDragging, onFaceSelect: select }),
  [visible, locale, tool, dragging, active, axisSnap, cameraKey, readonly, state.publishing, playback.playing, beginFold, previewFold, commitFold, select]);

  return <div className={styles.workspace} data-workbench-mode={courseware ? "courseware" : undefined} data-paper-folding-workbench aria-busy={busy} {...controls.bindings}>
    <div className={styles.viewport}><div className={styles.canvas} data-cube-workspace-frame="4:3">
      <PaperFoldingViewport {...viewportProps} onPointerMissed={!readonly && !busy ? controls.onPointerMissed : undefined} />
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
        <CubeIconButton label={m.layout} active={panel === "layout"} disabled={readonly || busy} onClick={() => togglePanel("layout")}><Grid2X2 aria-hidden /></CubeIconButton>
        <CubeIconButton label={m.style} active={panel === "style"} disabled={readonly || busy} onClick={() => togglePanel("style")}><Paintbrush aria-hidden /></CubeIconButton>
        <CubeIconButton label={m.labels} active={snapshot.labelsVisible} disabled={readonly || busy} onClick={() => commit({ ...snapshot, labelsVisible: !snapshot.labelsVisible })}><Hash aria-hidden /></CubeIconButton>
        <span className={styles.toolSeparator} aria-hidden />
        <CubeIconButton label={m.unfold} disabled={readonly || busy || (!snapshot.anchor && Object.values(snapshot.angles).every((angle) => angle === 0))} onClick={unfold}><FoldHorizontal className="rotate-90" aria-hidden /></CubeIconButton>
        <CubeIconButton label={m.undo} disabled={readonly || busy || !past.length} onClick={() => { historyIntent.current = "undo"; if (!commit(past.at(-1)!)) historyIntent.current = null; }}><Undo2 aria-hidden /></CubeIconButton>
        <CubeIconButton label={m.redo} disabled={readonly || busy || !future.length} onClick={() => { historyIntent.current = "redo"; if (!commit(future[0])) historyIntent.current = null; }}><Redo2 aria-hidden /></CubeIconButton>
        <CubeIconButton label={m.reset} disabled={readonly || busy} onClick={() => { commit(start); setActive(null); setCameraKey((value) => value + 1); }}><RotateCcw aria-hidden /></CubeIconButton>
      </div>
      {panel && <CubeCanvasPanel title={panel === "layout" ? m.layout : m.style} closeLabel={shared.closePanel} onClose={closePanel}>
        <div className="space-y-3">
          {panel === "layout" && <><p className="text-xs text-muted">{m.layoutHelp}</p><PaperLayoutEditor snapshot={snapshot} locale={locale} selected={selected} disabled={busy || readonly} onSelect={select} onAdd={(x, z) => edit({ kind: "add", x, z })} />
            <Button variant="secondary" size="sm" disabled={!selectedFace || busy || readonly} onClick={() => selected && edit({ kind: "remove", id: selected })}><Trash2 className="size-3.5" aria-hidden />{m.remove}</Button></>}
          {selectedFace && <><p className="text-xs text-muted">{m.selected}: {selectedFace.label || selectedFace.id}</p>
            <CubeColorPicker value={selectedFace.color} labels={shared.colors} label={shared.colorLabel} disabled={busy || readonly} onChange={(color) => setSurface({ color })} />
            <Label className="grid gap-1 text-xs">{m.label}<Input value={selectedFace.label} maxLength={8} disabled={busy || readonly} onKeyDown={(event) => event.stopPropagation()} onChange={(event) => setSurface({ label: event.target.value })} /></Label>
          </>}
        </div>
      </CubeCanvasPanel>}
      {(notice || state.failed) && <div className={styles.notice} role="status">{state.failed ? m.failed : notice}</div>}
      <p className="sr-only">{m.help}</p>
    </div></div>
  </div>;
}
