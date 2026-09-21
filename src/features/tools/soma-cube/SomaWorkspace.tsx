"use client";

import { SpatialActionButton } from "../spatial-interaction/SpatialActionButton";
import { SpatialViewButtons } from "../spatial-interaction/SpatialViewButtons";
import { SpatialAxisSteps } from "../spatial-interaction/SpatialAxisSteps";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Skeleton } from "@/components/ui/skeleton";
import type { Axis } from "@/features/spatial-math/domain";
import type { VoxelRendererMessages } from "@/features/spatial-math/renderer-r3f/VoxelFallback";
import { SpatialAxisSnapButton, useSpatialAxisSnap } from "@/features/spatial-math/renderer-r3f/SpatialCameraControls";
import { SpatialCanvasPanel } from "../spatial-interaction/SpatialWorkbenchControls";
import { CUBE_WORKBENCH_VIEWS } from "../spatial-lab/cube-workbench-camera";
import { useToolSnapshot } from "../scenes/useToolSnapshot";
import { useSceneCapture } from "../courseware/useSceneCapture";
import styles from "../spatial-lab/CubeStructuresWorkbench.module.css";
import { somaSnapshotSchema, somaLegacySnapshotSchema, type SomaSnapshot } from "./contract";
import { createSomaInitial, SOMA_CUBE_EXAMPLE, somaApart, somaChoose, somaDrag, somaFit, somaMove, somaRotate } from "./model";
import { SOMA_IDS, SOMA_PIECES, somaDefinition, type SomaId } from "./pieces";
import { somaMessages } from "./messages";
import { SomaPieceIcon } from "./SomaPieceIcon";
import { somaRigidPoses } from "./motion";
import { useSpatialDirectCommit } from "../spatial-interaction/useSpatialDirectCommit";
import { useSpatialToolState } from "../spatial-interaction/useSpatialToolState";

import { SPATIAL_ROLL_DIRECTIONS, planSpatialRoll, unitCubeCorners } from "../spatial-interaction/rolling";
import { SpatialRollButtons, type SpatialRollAction } from "../spatial-interaction/SpatialRollButtons";
import { spatialActionMessages } from "../spatial-interaction/messages";
import { somaRoll } from "./model";
import { somaCells } from "./pieces";
import { DEFAULT_SPATIAL_ROTATION_SNAP, SPATIAL_ROTATION_SNAP_DEGREES, SPATIAL_ROTATION_SNAP_LEVELS, type SpatialRotationSnapLevel } from "../spatial-interaction/rotation-snap";

const Canvas = dynamic(() => import("./SomaCanvas"), { ssr: false, loading: () => <Skeleton className="size-full" /> });
type Panel = "pieces" | "move" | "rotate" | "roll" | "settings" | null;
export interface SomaWorkspaceProps {
  initial?: SomaSnapshot; onSnapshot?: (snapshot: SomaSnapshot | null) => void; readOnly?: boolean;
  classroom?: { state?: SomaSnapshot; onChange?: (next: SomaSnapshot) => Promise<void> };
  freeRotation?: boolean;
}
export function SomaWorkspace({ initial, onSnapshot, readOnly = false, classroom, freeRotation = true }: SomaWorkspaceProps) {
  const locale = useLocale(), m = { ...somaMessages(locale), ...spatialActionMessages(locale) }, spatial = useTranslations("tools.spatialLab");
  const origin = useMemo(() => initial ?? createSomaInitial(), [initial]);
  const host = useToolSnapshot(origin, classroom), snapshot = host.snapshot;
  const controls = useSpatialToolState<"orbit" | "pan" | "move" | "rotate", Exclude<Panel, null>>({ defaultTool: "orbit", panels: { pieces: "orbit", move: "move", rotate: "rotate", roll: "orbit", settings: "orbit" } }, { tool: "move" });
  const { panel, tool: navigation, setTool: setNavigation, setPanel, selectionActive, activateSelection } = controls;
  const [axis, setAxis] = useState<Axis>("x"), [notice, setNotice] = useState("");
  const [rotationAxis, setRotationAxis] = useState<Axis>("y");
  const [rotationStyle, setRotationStyle] = useState<"axis" | "free">("axis");
  const [rotationSnap, setRotationSnap] = useState<SpatialRotationSnapLevel>(DEFAULT_SPATIAL_ROTATION_SNAP);
  const [dragging, setDragging] = useState(false), [history, setHistory] = useState<{ past: SomaSnapshot[]; future: SomaSnapshot[] }>({ past: [], future: [] });
  const [moving, setMoving] = useState(false);
  const directMove = useSpatialDirectCommit(snapshot, host.failed);
  const viewer = readOnly || Boolean(classroom && !classroom.onChange), busy = viewer || host.publishing, disabled = busy || dragging || moving;
  const snap = useSpatialAxisSnap();
  const capture = useSceneCapture(disabled ? null : snapshot, onSnapshot);
  const messages = useMemo<VoxelRendererMessages>(() => ({
    webglUnavailable: spatial("renderer.webglUnavailable"), contextLost: spatial("renderer.contextLost"), unrevealedCount: spatial("renderer.unrevealedCount"),
    formatProjection: (view) => spatial(`renderer.projections.${view}`),
    formatLayerCount: (label, count, visible) => count === null ? spatial("renderer.layerCountUnrevealed", { label }) : spatial("renderer.layerCount", { label, count, visibility: visible ? spatial("renderer.visible") : spatial("renderer.hidden") }),
    formatTotalCount: (count) => spatial("renderer.totalCount", { count }), formatHiddenByLayerCount: (count) => spatial("renderer.hiddenByLayer", { count }),
    formatProjectedCell: (u, v, count) => count === null ? spatial("renderer.projectedCellUnrevealed", { u, v }) : spatial("renderer.projectedCell", { u, v, count }),
  }), [spatial]);
  const commit = useCallback((next: SomaSnapshot | null, record = true, direct = false) => {
    if (busy) return false;
    const parsed = (freeRotation ? somaSnapshotSchema : somaLegacySnapshotSchema).safeParse(next);
    if (!parsed.success) { setNotice(m.blocked); return false; }
    if (!next || !host.update(next)) return false;
    if (direct) { directMove.hold(next); activateSelection(); } else directMove.clear();
    if (record && !classroom) setHistory((value) => ({ past: [...value.past, snapshot].slice(-60), future: [] }));
    setNotice(""); return true;
  }, [busy, host, classroom, snapshot, m.blocked, directMove, freeRotation, activateSelection]);
  const select = useCallback((id: SomaId) => {
    activateSelection();
    if (id === snapshot.selectedId && snapshot.mode === "assemble") return;
    const next = { ...snapshot, selectedId: id };
    commit(snapshot.mode === "observe" ? somaFit(next) : next, false);
  }, [snapshot, commit, activateSelection]);
  const choose = (ids: readonly SomaId[]) => commit(somaChoose(snapshot, ids));
  const count = (size: number) => {
    const ids = snapshot.pieces.map((piece) => piece.id);
    choose([...ids, ...SOMA_IDS.filter((id) => !ids.includes(id))].slice(0, size));
  };
  const mode = (value: SomaSnapshot["mode"]) => {
    if (commit(somaFit({ ...snapshot, mode: value }), false)) setNavigation(value === "observe" ? "orbit" : "move");
  };
  const open = (value: Exclude<Panel, null>) => { if (["move", "rotate", "roll"].includes(value)) activateSelection(); controls.togglePanel(value); };
  const travel = (direction: "past" | "future") => {
    const values = history[direction], next = values.at(-1); if (!next) return;
    if (commit({ ...next, cameraRevision: (snapshot.cameraRevision + 1) % 1_000_001 }, false)) setHistory((value) => direction === "past"
      ? { past: value.past.slice(0, -1), future: [...value.future, snapshot] }
      : { past: [...value.past, snapshot], future: value.future.slice(0, -1) });
  };
  const selected = somaDefinition(snapshot.selectedId), assembling = snapshot.mode === "assemble";
  const rollPlans = useMemo(() => panel === "roll" ? Object.fromEntries(SPATIAL_ROLL_DIRECTIONS.flatMap((direction) => {
    const piece = snapshot.pieces.find((piece) => piece.id === snapshot.selectedId);
    const plan = piece && somaRoll(snapshot, direction) && planSpatialRoll(unitCubeCorners(somaCells(piece)), direction);
    return plan ? [[direction, plan]] : [];
  })) : {}, [panel, snapshot]);
  const rollAction: SpatialRollAction = { label: m.roll, disabled, plans: rollPlans, onRoll: (direction) => { if (!disabled) commit(somaRoll(snapshot, direction)); } };
  const freePiece = !!snapshot.pieces.find((piece) => piece.id === snapshot.selectedId)?.quaternion;
  return <section className={styles.workspace} data-workbench-mode="courseware" data-soma-workspace={freeRotation ? "v2" : "v1"} aria-label={m.title} {...capture} {...controls.bindings}>
    <div className={styles.viewport}><div className={styles.canvas} data-has-cube-groups="true">
      <Canvas snapshot={directMove.displayed} messages={messages} title={m.title} readOnly={busy} cameraInteractive={!viewer} axisSnap={snap} navigation={navigation} moveAxis={axis}
        selectionActive={selectionActive} onPointerMissed={disabled ? undefined : controls.onPointerMissed}
        rotationAxis={rotationAxis} onRotationAxis={setRotationAxis}
        freeRotation={freeRotation} rotationStyle={rotationStyle} rotationSnap={rotationSnap} onToggleRotation={() => open("rotate")}
        onPoseCommit={(next) => commit(next, true, true)} onPlaneUnavailable={() => setNotice(m.planeEdgeOn)} onGestureBlocked={() => setNotice(m.gestureBlocked)}
        instantKey={directMove.target ? JSON.stringify(somaRigidPoses(directMove.target.pieces)) : null} locale={locale} onMoving={setMoving}
        rollAction={panel === "roll" ? rollAction : undefined}
        onRotate={(axis, turn) => { if (!disabled) commit(somaRotate(snapshot, axis, turn, freeRotation, rotationSnap)); }}
        onMoveAxis={setAxis} onSelect={select} onMove={(operation) => commit(somaDrag(snapshot, operation), true, true)} onUnavailable={() => setNotice(m.hiddenAxis)} onDragging={setDragging} />
      <div className={`${styles.dock} ${styles.meta}`}>
        <SpatialActionButton action="observe" label={m.observe} active={!assembling} disabled={disabled} onClick={() => mode("observe")} />
        <SpatialActionButton action="assemble" label={m.assemble} active={assembling} disabled={disabled} onClick={() => mode("assemble")} />
        <SpatialActionButton action="pieces" label={m.pieces} active={panel === "pieces"} disabled={disabled} onClick={() => open("pieces")} />
      </div>
      <div className={`${styles.dock} ${styles.views}`} aria-label={m.fit}>
        <SpatialViewButtons views={CUBE_WORKBENCH_VIEWS} value={snapshot.view} labels={m.views} disabled={disabled}
          onChange={(view) => commit({ ...snapshot, view, cameraRevision: (snapshot.cameraRevision + 1) % 1_000_001 }, false)} fit={{ label: m.fit, onClick: () => commit(somaFit(snapshot), false) }} />
        <SpatialAxisSnapButton messages={m} disabled={disabled} iconOnly className={styles.icon} />
      </div>
      <div className={`${styles.dock} ${styles.tools}`} role="toolbar" aria-label={m.title}>
        <SpatialActionButton action="orbit" label={m.orbit} active={navigation === "orbit"} disabled={disabled} onClick={() => controls.chooseTool("orbit")} />
        <SpatialActionButton action="pan" label={m.pan} active={navigation === "pan"} disabled={disabled} onClick={() => controls.chooseTool("pan")} />
        <SpatialActionButton action="move" label={m.move} active={navigation === "move" && assembling} disabled={disabled || !assembling} onClick={() => open("move")} />
        <SpatialActionButton action="rotate" label={m.rotate} active={panel === "rotate"} disabled={disabled || !assembling} onClick={() => open("rotate")} />
        <SpatialActionButton action="roll" label={m.roll} active={panel === "roll"} disabled={disabled || !assembling} onClick={() => open("roll")} />
        <span className={styles.toolSeparator} />
        <SpatialActionButton action="separate" label={m.apart} disabled={disabled} onClick={() => commit(somaFit({ ...snapshot, pieces: somaApart(snapshot.pieces.map((piece) => piece.id)), mode: "assemble" }))} />
        <SpatialActionButton action="settings" label={m.settings} active={panel === "settings"} disabled={disabled} onClick={() => open("settings")} />
        <SpatialActionButton action="undo" label={m.undo} disabled={disabled || !history.past.length} onClick={() => travel("past")} />
        <SpatialActionButton action="redo" label={m.redo} disabled={disabled || !history.future.length} onClick={() => travel("future")} />
        <SpatialActionButton action="reset" label={m.reset} disabled={disabled} onClick={() => { if (commit({ ...structuredClone(origin), cameraRevision: (snapshot.cameraRevision + 1) % 1_000_001 })) { setPanel(null); setNavigation(origin.mode === "observe" ? "orbit" : "move"); } }} />
      </div>
      {panel && <SpatialCanvasPanel title={m[panel]} closeLabel={m.close} onClose={() => setPanel(null)} anchor={panel === "pieces" ? "meta" : "tool"}>
        <div className="space-y-3 text-xs">
          {panel === "roll" && <><p className="text-muted">{m.rollHint}</p><SpatialRollButtons action={{ ...rollAction, disabled: disabled || !selectionActive }} /><p className="text-muted">{freePiece ? m.snapForRoll : m.rollBlocked}</p></>}
          {panel === "pieces" && <>
            <p>{m.count}</p><div className="flex flex-wrap gap-1">{SOMA_IDS.map((id, index) => <Button key={id} size="sm" variant={snapshot.pieces.length === index + 1 ? "secondary" : "ghost"}
              aria-label={`${index + 1} ${m.countUnit}`} aria-pressed={snapshot.pieces.length === index + 1} disabled={disabled} onClick={() => count(index + 1)}>{index + 1}</Button>)}</div>
            <p className="leading-5 text-muted">{m.selectHint}</p>
            <div className="grid grid-cols-2 gap-1">{SOMA_PIECES.map((piece) => {
              const included = snapshot.pieces.some((item) => item.id === piece.id);
              return <label key={piece.id} className="flex items-center gap-1 rounded px-1 py-0.5">
                <Checkbox aria-label={`${included ? m.remove : m.add} ${piece.name}`} checked={included} disabled={disabled || (included && snapshot.pieces.length === 1)}
                  onCheckedChange={(checked) => choose(checked ? [...snapshot.pieces.map((item) => item.id), piece.id] : snapshot.pieces.filter((item) => item.id !== piece.id).map((item) => item.id))} />
                <SomaPieceIcon id={piece.id} /><span>{piece.name}</span>
              </label>;
            })}</div>
            <Button size="sm" variant="secondary" disabled={disabled} onClick={() => { if (commit(somaFit({ ...snapshot, pieces: structuredClone([...SOMA_CUBE_EXAMPLE]), mode: "assemble" }))) { setPanel(null); setNavigation("move"); } }}>{m.example}</Button>
          </>}
          {(panel === "move" || panel === "rotate") && <>
            <p>{m.selected} · {selected.name}</p>
            {panel === "rotate" && <ToggleGroup type="single" value={rotationStyle} onValueChange={(value) => { if (value) setRotationStyle(value as "axis" | "free"); }} variant="outline" size="sm" disabled={disabled} aria-label={m.rotationStyle} className="grid grid-cols-2">
              <ToggleGroupItem value="axis" className="min-h-11 px-2 text-xs">{m.axisRotation}</ToggleGroupItem>
              <ToggleGroupItem value="free" className="min-h-11 px-2 text-xs">{m.freeRotation}</ToggleGroupItem>
            </ToggleGroup>}
            <SpatialAxisSteps label={m[panel]} step={panel === "rotate" ? 90 : 1} unit={panel === "rotate" ? "°" : ""} disabled={disabled || !assembling || !selectionActive}
              axis={panel === "rotate" ? rotationAxis : axis} onAxisChange={panel === "rotate" ? setRotationAxis : setAxis}
              onStep={(value, direction) => commit(panel === "rotate" ? somaRotate(snapshot, value, direction, freeRotation, rotationSnap) : somaMove(snapshot, snapshot.selectedId, value, direction))} />
            <p className="leading-5 text-muted">{panel === "move" ? m.moveHint : freeRotation ? m.rotateHint : m.legacyRotateHint}</p>
            {panel === "rotate" && freeRotation && <div className="space-y-1">
              <p>{m.rotationSnap}</p>
              <ToggleGroup type="single" value={rotationSnap} onValueChange={(value) => { if (value) setRotationSnap(value as SpatialRotationSnapLevel); }}
                variant="outline" size="sm" disabled={disabled} aria-label={m.rotationSnap} className="grid grid-cols-2">
                {SPATIAL_ROTATION_SNAP_LEVELS.map((level) => <ToggleGroupItem key={level} value={level} className="min-h-11 px-2 text-xs">
                  {m.rotationSnapLevels[level]}{SPATIAL_ROTATION_SNAP_DEGREES[level] === null ? "" : ` ${SPATIAL_ROTATION_SNAP_DEGREES[level]}°`}
                </ToggleGroupItem>)}
              </ToggleGroup>
            </div>}
          </>}
          {panel === "settings" && (["grid", "axes", "labels"] as const).map((key) => <label key={key} className="flex items-center gap-2">
            <Checkbox aria-label={m[key]} checked={snapshot[key]} disabled={disabled} onCheckedChange={(checked) => commit({ ...snapshot, [key]: checked === true }, false)} />{m[key]}
          </label>)}
        </div>
      </SpatialCanvasPanel>}
      <div className={styles.cutStatus}>
        <strong>{assembling ? m.assemble : m.observe} · {assembling ? `${snapshot.pieces.length} ${m.countUnit}` : selected.name}</strong>
        <span className="ml-2 text-muted">{assembling ? snapshot.pieces.reduce((sum, piece) => sum + somaDefinition(piece.id).cells.length, 0) : selected.cells.length} {m.cubes}</span>
        <p className="mt-1 text-muted">{assembling ? m.assembleHint : m.observeHint}</p>
      </div>
      <div className={`${styles.dock} ${styles.groups}`} role="toolbar" aria-label={m.selected}>
        {snapshot.pieces.map((piece) => <Button key={piece.id} size="sm" variant={selectionActive && snapshot.selectedId === piece.id ? "secondary" : "ghost"} className="h-9 shrink-0 gap-1 px-2"
          aria-label={`${m.choose} ${somaDefinition(piece.id).name}`} aria-pressed={selectionActive && snapshot.selectedId === piece.id} disabled={disabled} onClick={() => select(piece.id)}>
          <span className="size-3 rounded-sm border border-ink/30" style={{ backgroundColor: somaDefinition(piece.id).color }} />{somaDefinition(piece.id).name}
        </Button>)}
      </div>
      {(notice || host.failed) && <p className={styles.notice} role="status">{host.failed ? m.syncError : notice}</p>}
    </div></div>
  </section>;
}
