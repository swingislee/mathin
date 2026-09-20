"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Boxes, Eye, Grid2X2, Hand, Maximize, Move3D, Orbit, Redo2, Rotate3D, RotateCcw, Settings2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Skeleton } from "@/components/ui/skeleton";
import type { Axis } from "@/features/spatial-math/domain";
import type { VoxelRendererMessages } from "@/features/spatial-math/renderer-r3f/VoxelFallback";
import { SpatialAxisSnapButton, useSpatialAxisSnap } from "@/features/spatial-math/renderer-r3f/SpatialCameraControls";
import { CubeAxisIcon, CubeCanvasPanel, CubeIconButton, CubeViewIcon } from "../spatial-lab/CubeWorkbenchControls";
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
import { Footprints } from "lucide-react";
import { SPATIAL_ROLL_DIRECTIONS, planSpatialRoll, unitCubeCorners } from "../spatial-interaction/rolling";
import { SpatialRollButtons, type SpatialRollAction } from "../spatial-interaction/SpatialRollButtons";
import { spatialActionMessages } from "../spatial-interaction/messages";
import { somaRoll } from "./model";
import { somaCells } from "./pieces";
import { SPATIAL_MOVE_PLANES, type SpatialMovePlane } from "../spatial-interaction/object-gesture-math";
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
  const { panel, tool: navigation, setTool: setNavigation, setPanel } = controls;
  const [axis, setAxis] = useState<Axis>("x"), [notice, setNotice] = useState("");
  const [rotationAxis, setRotationAxis] = useState<Axis>("y");
  const [movePlane, setMovePlane] = useState<SpatialMovePlane>("table");
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
    if (direct) directMove.hold(next); else directMove.clear();
    if (record && !classroom) setHistory((value) => ({ past: [...value.past, snapshot].slice(-60), future: [] }));
    setNotice(""); return true;
  }, [busy, host, classroom, snapshot, m.blocked, directMove, freeRotation]);
  const select = useCallback((id: SomaId) => {
    const next = { ...snapshot, selectedId: id };
    commit(snapshot.mode === "observe" ? somaFit(next) : next, false);
  }, [snapshot, commit]);
  const choose = (ids: readonly SomaId[]) => commit(somaChoose(snapshot, ids));
  const count = (size: number) => {
    const ids = snapshot.pieces.map((piece) => piece.id);
    choose([...ids, ...SOMA_IDS.filter((id) => !ids.includes(id))].slice(0, size));
  };
  const mode = (value: SomaSnapshot["mode"]) => {
    if (commit(somaFit({ ...snapshot, mode: value }), false)) setNavigation(value === "observe" ? "orbit" : "move");
  };
  const open = (value: Exclude<Panel, null>) => controls.togglePanel(value);
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
        movePlane={movePlane} preciseAxes={panel === "move"} rotationAxis={rotationAxis} onRotationAxis={setRotationAxis}
        freeRotation={freeRotation} rotationSnap={rotationSnap} onToggleRotation={() => open("rotate")}
        onPoseCommit={(next) => commit(next, true, true)} onPlaneUnavailable={() => setNotice(m.planeEdgeOn)} onGestureBlocked={() => setNotice(m.gestureBlocked)}
        instantKey={directMove.target ? JSON.stringify(somaRigidPoses(directMove.target.pieces)) : null} locale={locale} onMoving={setMoving}
        rollAction={panel === "roll" ? rollAction : undefined}
        onRotate={(axis, turn) => { if (!disabled) commit(somaRotate(snapshot, axis, turn, freeRotation, rotationSnap)); }}
        onMoveAxis={setAxis} onSelect={select} onMove={(operation) => commit(somaDrag(snapshot, operation), true, true)} onUnavailable={() => setNotice(m.hiddenAxis)} onDragging={setDragging} />
      <div className={`${styles.dock} ${styles.meta}`}>
        <CubeIconButton label={m.observe} active={!assembling} disabled={disabled} onClick={() => mode("observe")}><Eye aria-hidden /></CubeIconButton>
        <CubeIconButton label={m.assemble} active={assembling} disabled={disabled} onClick={() => mode("assemble")}><Boxes aria-hidden /></CubeIconButton>
        <CubeIconButton label={m.pieces} active={panel === "pieces"} disabled={disabled} onClick={() => open("pieces")}><Grid2X2 aria-hidden /></CubeIconButton>
      </div>
      <div className={`${styles.dock} ${styles.views}`} aria-label={m.fit}>
        {CUBE_WORKBENCH_VIEWS.map((view) => <CubeIconButton key={view} label={m.views[view]} active={snapshot.view === view} disabled={disabled}
          onClick={() => commit({ ...snapshot, view, cameraRevision: (snapshot.cameraRevision + 1) % 1_000_001 }, false)}><CubeViewIcon view={view} /></CubeIconButton>)}
        <CubeIconButton label={m.fit} disabled={disabled} onClick={() => commit(somaFit(snapshot), false)}><Maximize aria-hidden /></CubeIconButton>
        <SpatialAxisSnapButton messages={m} disabled={disabled} iconOnly className={styles.icon} />
      </div>
      <div className={`${styles.dock} ${styles.tools}`} role="toolbar" aria-label={m.title}>
        <CubeIconButton label={m.orbit} active={navigation === "orbit"} disabled={disabled} onClick={() => controls.chooseTool("orbit")}><Orbit aria-hidden /></CubeIconButton>
        <CubeIconButton label={m.pan} active={navigation === "pan"} disabled={disabled} onClick={() => controls.chooseTool("pan")}><Hand aria-hidden /></CubeIconButton>
        <CubeIconButton label={m.move} active={navigation === "move" && assembling} disabled={disabled || !assembling} onClick={() => open("move")}><Move3D aria-hidden /></CubeIconButton>
        <CubeIconButton label={m.rotate} active={panel === "rotate"} disabled={disabled || !assembling} onClick={() => open("rotate")}><Rotate3D aria-hidden /></CubeIconButton>
        <CubeIconButton label={m.roll} active={panel === "roll"} disabled={disabled || !assembling} onClick={() => open("roll")}><Footprints aria-hidden /></CubeIconButton>
        <span className={styles.toolSeparator} />
        <CubeIconButton label={m.apart} disabled={disabled} onClick={() => commit(somaFit({ ...snapshot, pieces: somaApart(snapshot.pieces.map((piece) => piece.id)), mode: "assemble" }))}><Boxes aria-hidden /></CubeIconButton>
        <CubeIconButton label={m.settings} active={panel === "settings"} disabled={disabled} onClick={() => open("settings")}><Settings2 aria-hidden /></CubeIconButton>
        <CubeIconButton label={m.undo} disabled={disabled || !history.past.length} onClick={() => travel("past")}><Undo2 aria-hidden /></CubeIconButton>
        <CubeIconButton label={m.redo} disabled={disabled || !history.future.length} onClick={() => travel("future")}><Redo2 aria-hidden /></CubeIconButton>
        <CubeIconButton label={m.reset} disabled={disabled} onClick={() => { if (commit({ ...structuredClone(origin), cameraRevision: (snapshot.cameraRevision + 1) % 1_000_001 })) { setPanel(null); setNavigation(origin.mode === "observe" ? "orbit" : "move"); } }}><RotateCcw aria-hidden /></CubeIconButton>
      </div>
      {panel && <CubeCanvasPanel title={m[panel]} closeLabel={m.close} onClose={() => setPanel(null)} anchor={panel === "pieces" ? "meta" : "tool"}>
        <div className="space-y-3 text-xs">
          {panel === "roll" && <><p className="text-muted">{m.rollHint}</p><SpatialRollButtons action={rollAction} /><p className="text-muted">{freePiece ? m.snapForRoll : m.rollBlocked}</p></>}
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
            {panel === "move" && <div className="space-y-1"><p className="text-muted">{m.moveFeel}</p>
              <ToggleGroup type="single" value={movePlane} onValueChange={(value) => { if (value) setMovePlane(value as SpatialMovePlane); }}
                variant="outline" size="sm" disabled={disabled} aria-label={m.moveFeel} className="grid grid-cols-2">
                {SPATIAL_MOVE_PLANES.map((plane) => <ToggleGroupItem key={plane} value={plane} className="min-h-11 px-2 text-xs">
                  {{ table: m.tableMove, xy: m.xyMove, yz: m.yzMove, screen: m.screenMove }[plane]}
                </ToggleGroupItem>)}
              </ToggleGroup>
            </div>}
            {(["x", "y", "z"] as const).map((value) => <div key={value} className="flex items-center gap-2">
              <CubeIconButton label={`${value.toUpperCase()} ${m[panel]}`} active={(panel === "rotate" ? rotationAxis : axis) === value} disabled={disabled}
                onClick={() => panel === "rotate" ? setRotationAxis(value) : setAxis(value)}><CubeAxisIcon axis={value} /></CubeIconButton>
              {([-1, 1] as const).map((direction) => <Button key={direction} size="sm" variant="secondary" disabled={disabled || !assembling}
                aria-label={`${m[panel]} ${value.toUpperCase()} ${direction > 0 ? "+" : "−"}${panel === "rotate" ? "90°" : "1"}`}
                onClick={() => commit(panel === "rotate" ? somaRotate(snapshot, value, direction, freeRotation, rotationSnap) : somaMove(snapshot, snapshot.selectedId, value, direction))}>
                {direction > 0 ? "+" : "−"}{panel === "rotate" ? "90°" : "1"}
              </Button>)}
            </div>)}<p className="leading-5 text-muted">{panel === "move" ? m.moveHint : freeRotation ? m.rotateHint : m.legacyRotateHint}</p>
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
      </CubeCanvasPanel>}
      <div className={styles.cutStatus}>
        <strong>{assembling ? m.assemble : m.observe} · {assembling ? `${snapshot.pieces.length} ${m.countUnit}` : selected.name}</strong>
        <span className="ml-2 text-muted">{assembling ? snapshot.pieces.reduce((sum, piece) => sum + somaDefinition(piece.id).cells.length, 0) : selected.cells.length} {m.cubes}</span>
        <p className="mt-1 text-muted">{assembling ? m.assembleHint : m.observeHint}</p>
      </div>
      <div className={`${styles.dock} ${styles.groups}`} role="toolbar" aria-label={m.selected}>
        {snapshot.pieces.map((piece) => <Button key={piece.id} size="sm" variant={snapshot.selectedId === piece.id ? "secondary" : "ghost"} className="h-9 shrink-0 gap-1 px-2"
          aria-label={`${m.choose} ${somaDefinition(piece.id).name}`} aria-pressed={snapshot.selectedId === piece.id} disabled={disabled} onClick={() => select(piece.id)}>
          <span className="size-3 rounded-sm border border-ink/30" style={{ backgroundColor: somaDefinition(piece.id).color }} />{somaDefinition(piece.id).name}
        </Button>)}
      </div>
      {(notice || host.failed) && <p className={styles.notice} role="status">{host.failed ? m.syncError : notice}</p>}
    </div></div>
  </section>;
}
