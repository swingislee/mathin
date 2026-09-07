"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Boxes, Circle, Eraser, Eye, EyeOff, Hand, Layers3, Maximize, Minus, MousePointer2, Move, Orbit, Paintbrush, PaintBucket, Plus, Presentation, Redo2, RotateCcw, Settings2, Shapes, Trash2, Undo2, Ungroup, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { voxelKey, type Axis, type VoxelCoordinate, type VoxelFaceSelection } from "@/features/spatial-math/domain";
import { SpatialAxisSnapButton, useSpatialAxisSnap, type SpatialCameraControlMessages } from "@/features/spatial-math/renderer-r3f/SpatialCameraControls";
import type { VoxelRendererMessages } from "@/features/spatial-math/renderer-r3f/VoxelFallback";
import { SPATIAL_LAB_MEASUREMENT_PRESET_ID, SPATIAL_LAB_PRESET_ID, SPATIAL_LAB_PRESETS, createSpatialLabPresetDraft, type SpatialLabPresetId } from "./preset";
import { CUBE_AXIS_COLORS, CUBE_COLORS, CUBE_STRUCTURES_LIMITS, adjacentCube, applyCubeOperation, buildCubeStructureRenderModel, canPlaceCube, cubeFrame, cubeIsVisible, cubeLayerNumber, cubeLayerOperation, cubePaintGroups, cubeScopeIds, cubeStructureMetrics, exteriorPaintOperation, type CubeColor, type CubeOperation, type CubeTool, type CubeView } from "./cube-structures-contract";
import { createCubeDemo, createCubeSession, cubeResumeNeedsRestore, cubeSessionScene, editCubeRecording, finishCubeRecording, moveCubeRecordedStep, operateCubeSession, pauseCubeRecording, previewCubeSession, replaceCubeRecordedStep, resumeCubeRecording, startCubeRecording, undoCubeSession, type CubeWorkbenchSession } from "./cube-structures-session";
import { cubeStructuresMessages } from "./cube-structures-messages";
import { cubeToolCursor } from "./cube-structures-cursor";
import { CubeAxisIcon, CubeCanvasPanel, CubeIconButton, CubeViewIcon } from "./CubeWorkbenchControls";
import { CubeRecordingPanel } from "./CubeRecordingPanel";
import styles from "./CubeStructuresWorkbench.module.css";

const CubeStructuresViewport = dynamic(() => import("./CubeStructuresViewport").then((module) => module.CubeStructuresViewport), { ssr: false });
const TOOL_BUTTONS = [
  { id: "orbit", Icon: Orbit }, { id: "pan", Icon: Hand }, { id: "select", Icon: MousePointer2 },
  { id: "build", Icon: Plus }, { id: "remove", Icon: Eraser }, { id: "color", Icon: PaintBucket },
  { id: "face", Icon: Paintbrush }, { id: "move", Icon: Move }, { id: "layer", Icon: Layers3 },
] as const;
const VIEWS: readonly CubeView[] = ["angle", "front", "right", "top"];
const COLOR_MAP = Object.fromEntries(CUBE_COLORS.map((color) => [color, color]));
type Panel = "selection" | "color" | "move" | "layers" | "recording" | "model" | null;

export function CubeStructuresWorkbench({ locale, rendererMessages, cameraMessages, workspaceSelector }: {
  readonly locale: "zh" | "en"; readonly rendererMessages: VoxelRendererMessages;
  readonly cameraMessages: SpatialCameraControlMessages; readonly workspaceSelector?: ReactNode;
}) {
  const m = cubeStructuresMessages(locale);
  const [prepared, setPrepared] = useState(() => createCubeSession(createSpatialLabPresetDraft(SPATIAL_LAB_PRESET_ID).model.cells));
  const [demo, setDemo] = useState<CubeWorkbenchSession | null>(null);
  const [mode, setMode] = useState<"prepare" | "demonstrate">("prepare");
  const [tool, setTool] = useState<CubeTool>("orbit");
  const [panel, setPanel] = useState<Panel>(null);
  const [color, setColor] = useState<CubeColor>(CUBE_COLORS[1]);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [scopeId, setScopeId] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("");
  const [axis, setAxis] = useState<Axis>("y");
  const [moveDistance, setMoveDistance] = useState("1");
  const [hoverFace, setHoverFace] = useState<VoxelFaceSelection | null>(null);
  const [hoverGround, setHoverGround] = useState<VoxelCoordinate | null>(null);
  const [showMetrics, setShowMetrics] = useState(false);
  const [preset, setPreset] = useState<SpatialLabPresetId | "empty">(SPATIAL_LAB_PRESET_ID);
  const [confirmation, setConfirmation] = useState<"load" | "record" | "resume" | "demo" | null>(null);
  const [notice, setNotice] = useState("");
  const [playing, setPlaying] = useState(false);
  const [replacementStep, setReplacementStep] = useState<number | null>(null);
  const [cameraRequest, setCameraRequest] = useState(0);
  const [viewOverride, setViewOverride] = useState<CubeView | null>(null);
  const identity = useRef(0);
  const snap = useSpatialAxisSnap();
  const session = mode === "prepare" ? prepared : demo ?? prepared;
  const state = useMemo(() => cubeSessionScene(session), [session]);
  // 撤销编组或回放到编组之前时，失效的组 ID 自动回到整体范围。
  const activeGroup = state.groups.find((group) => group.id === scopeId);
  const activeGroupId = activeGroup?.id ?? null;
  const scopeIds = useMemo(() => cubeScopeIds(state, activeGroupId), [state, activeGroupId]);
  const selectedIds = useMemo(() => selected.filter((id) => scopeIds.includes(id)), [selected, scopeIds]);
  const targetIds = selectedIds.length ? selectedIds : scopeIds;
  const scopeLabel = activeGroup?.name ?? m.allGroups;
  const model = useMemo(() => buildCubeStructureRenderModel(viewOverride ? { ...state, view: viewOverride } : state, selectedIds, m.title, activeGroupId), [state, selectedIds, m.title, viewOverride, activeGroupId]);
  const paints = useMemo(() => cubePaintGroups(state), [state]);
  const metrics = useMemo(() => cubeStructureMetrics(state), [state]);
  // 包括已经隐藏的单位块，恢复入口始终保留。
  const layers = useMemo(() => [...new Set(state.cubes.filter((cube) => scopeIds.includes(cube.id)).map((cube) => cube.position[axis]))].sort((a, b) => a - b), [axis, state.cubes, scopeIds]);
  const editable = !playing && (session.preview === null || replacementStep !== null);
  const nextPosition = hoverFace ? adjacentCube(hoverFace) : hoverGround;
  const validBuild = Boolean(nextPosition && canPlaceCube(nextPosition) && state.cubes.length < CUBE_STRUCTURES_LIMITS.cubes && !state.cubes.some((cube) => voxelKey(cube.position) === voxelKey(nextPosition)));

  function updateSession(update: (current: CubeWorkbenchSession) => CubeWorkbenchSession) {
    if (mode === "prepare") setPrepared(update); else setDemo((current) => update(current ?? createCubeDemo(prepared)));
  }
  function clearPointer() { setHoverFace(null); setHoverGround(null); setNotice(""); }
  function resetTransient() {
    setPlaying(false); setReplacementStep(null); setSelected([]); setScopeId(null); setViewOverride(null);
    clearPointer(); setCameraRequest((value) => value + 1);
  }
  function seek(cursor: number | null) {
    updateSession((current) => previewCubeSession(current, cursor)); resetTransient();
  }
  function commit(operation: CubeOperation): boolean {
    if (!editable) { setNotice(m.previewHint); return false; }
    if (replacementStep !== null) {
      const result = replaceCubeRecordedStep(session, replacementStep, operation);
      if (result.issue) { setNotice(m.sequenceError + " (" + (result.issue.index + 1) + ")"); return false; }
      updateSession(() => ({ ...result.session, preview: replacementStep + 1 }));
      setReplacementStep(null); setNotice(""); return true;
    }
    if (session.recording === "recording" && (session.lesson?.cursor ?? 0) >= CUBE_STRUCTURES_LIMITS.steps) { setNotice(m.limit); return false; }
    if (applyCubeOperation(state, operation) === state) { if (operation.kind === "move") setNotice(m.invalidMove); return false; }
    updateSession((current) => operateCubeSession(current, operation)); setNotice(""); return true;
  }
  function build(position: VoxelCoordinate) {
    if (!canPlaceCube(position) || state.cubes.some((cube) => voxelKey(cube.position) === voxelKey(position))) { setNotice(m.blockedBuild); return; }
    if (state.cubes.length >= CUBE_STRUCTURES_LIMITS.cubes) { setNotice(m.limit); return; }
    commit({ kind: "build", id: "added-" + (++identity.current), groupId: activeGroupId ?? undefined, position, color: CUBE_COLORS[0] });
  }
  function clickFace(face: VoxelFaceSelection) {
    const cube = state.cubes.find((candidate) => voxelKey(candidate.position) === voxelKey(face.cell));
    if (!cube) return;
    if (!scopeIds.includes(cube.id)) { setNotice(m.groupProtected); return; }
    if (tool === "select") { setSelected((current) => current.includes(cube.id) ? current.filter((id) => id !== cube.id) : [...current, cube.id]); return; }
    switch (tool) {
      case "orbit": case "pan": break;
      case "build": build(adjacentCube(face)); break;
      case "remove": commit({ kind: "remove", ids: [cube.id] }); break;
      case "color": commit({ kind: "color", ids: [cube.id], color }); break;
      case "face": commit({ kind: "paint", faces: [{ id: cube.id, direction: face.direction }], color }); break;
      case "layer": commit(cubeLayerOperation(state, axis, cube.position[axis], false, scopeIds)); break;
      case "move": setSelected([cube.id]); break;
    }
  }
  function chooseTool(value: CubeTool) {
    setTool(value); clearPointer();
    if (value === "layer") setPanel("layers");
    else if (value === "color" || value === "face") setPanel("color");
    else if (value === "select") setPanel("selection");
    else if (value === "move") setPanel("move");
  }
  function chooseMode() {
    if (mode === "prepare" && !demo) setDemo(createCubeDemo(prepared));
    updateSession(pauseCubeRecording); setMode(mode === "prepare" ? "demonstrate" : "prepare"); resetTransient();
  }
  function createGroup() {
    if (!selectedIds.length) { setNotice(m.noSelection); return; }
    const id = "group-" + (++identity.current);
    if (commit({ kind: "group", id, name: groupName.trim() || m.newGroup + " " + (state.groups.length + 1), ids: selectedIds })) {
      setScopeId(id); setSelected([]); setGroupName("");
    }
  }
  function recordStart() {
    if (session.lesson?.operations.length) setConfirmation("record");
    else { updateSession(startCubeRecording); resetTransient(); }
  }
  function recordResume() {
    if (cubeResumeNeedsRestore(session)) setConfirmation("resume");
    else { updateSession(resumeCubeRecording); resetTransient(); }
  }
  function confirmChange() {
    if (confirmation === "load") updateSession(() => createCubeSession(preset === "empty" ? [] : createSpatialLabPresetDraft(preset).model.cells));
    else if (confirmation === "record") updateSession(startCubeRecording);
    else if (confirmation === "resume") updateSession(resumeCubeRecording);
    else if (confirmation === "demo") setDemo(createCubeDemo(prepared));
    setConfirmation(null); resetTransient();
  }
  function changeRecorded(result: ReturnType<typeof editCubeRecording>) {
    if (result.issue) { setNotice(m.sequenceError + " (" + (result.issue.index + 1) + ")"); return; }
    updateSession(() => result.session); resetTransient();
  }
  function chooseView(view: CubeView) {
    if (editable) { commit({ kind: "view", view, frame: cubeFrame(state.cubes) }); setViewOverride(null); }
    else setViewOverride(view);
    setCameraRequest((value) => value + 1);
  }

  useEffect(() => {
    if (!playing || !session.lesson) return;
    const cursor = session.preview ?? 0;
    const timer = window.setTimeout(() => {
      const update = (current: CubeWorkbenchSession) => ({ ...current, preview: Math.min(cursor + 1, current.lesson?.operations.length ?? 0) });
      if (mode === "prepare") setPrepared(update); else setDemo((current) => current ? update(current) : current);
      setViewOverride(null); setCameraRequest((value) => value + 1);
      if (cursor + 1 >= session.lesson!.operations.length) setPlaying(false);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [playing, session.lesson, session.preview, mode]);

  const panelTitle = panel === "selection" ? m.selectionPanel : panel === "color" ? m.colorLabel : panel === "move" ? m.move : panel === "layers" ? m.layers : panel === "recording" ? m.record : m.modelPanel;
  return <div className={styles.workspace} data-cube-structures-workbench="v2" data-workbench-mode={mode}>
    <div className={styles.viewport}>
      <div className={styles.canvas} aria-label={m.title + " · " + m[mode]} style={{ cursor: cubeToolCursor(tool) }} data-active-cube-tool={tool} data-cube-workspace-frame="4:3">
        <CubeStructuresViewport model={model} messages={rendererMessages} materialColors={COLOR_MAP}
          axisSnapEnabled={snap} cameraRequestKey={cameraRequest} paintedFaceGroups={paints}
          readOnly={playing || (!editable && tool !== "select")} cameraInteractive navigationMode={tool === "pan" ? "pan" : "orbit"}
          onFaceSelect={tool === "orbit" || tool === "pan" ? undefined : clickFace}
          onFaceHover={tool === "orbit" || tool === "pan" ? undefined : (face) => {
            const hit = face && state.cubes.find((cube) => voxelKey(cube.position) === voxelKey(face.cell));
            setHoverFace(hit && scopeIds.includes(hit.id) ? face : null); if (face) setHoverGround(null);
          }}
          scene={{ tool: editable ? tool : "orbit", face: hoverFace, ground: editable ? hoverGround : null, validBuild,
            origin: state.origin, axesVisible: state.axesVisible, axisLength: Math.max(3, state.frame.radius * 1.5),
            onGroundHover: (position) => { setHoverGround(position); if (position) setHoverFace(null); }, onGroundClick: build }} />

        <div className={cn(styles.dock, styles.meta)} role="toolbar" aria-label={m.modes}>
          <CubeIconButton label={m[mode] + " · " + (mode === "prepare" ? m.demonstrate : m.prepare)} onClick={chooseMode} active={mode === "demonstrate"}>{mode === "prepare" ? <Shapes aria-hidden /> : <Presentation aria-hidden />}</CubeIconButton>
          <CubeIconButton label={m.modelPanel} active={panel === "model"} onClick={() => setPanel(panel === "model" ? null : "model")}><Settings2 aria-hidden /></CubeIconButton>
        </div>
        <div className={cn(styles.dock, styles.views)} role="toolbar" aria-label={m.view} data-cube-view-toolbar>
          {VIEWS.map((view) => <CubeIconButton key={view} label={m[view]} active={(viewOverride ?? state.view) === view} onClick={() => chooseView(view)}><CubeViewIcon view={view} /></CubeIconButton>)}
          <CubeIconButton label={m.fit} onClick={() => chooseView(viewOverride ?? state.view)}><Maximize aria-hidden /></CubeIconButton>
          <SpatialAxisSnapButton messages={cameraMessages} iconOnly className={styles.icon} />
          <CubeIconButton label={state.axesVisible ? m.hideAxes : m.showAxes} active={state.axesVisible} disabled={!editable} onClick={() => commit({ kind: "axes", visible: !state.axesVisible })}>
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" aria-hidden><path d="M5 19h15" stroke={CUBE_AXIS_COLORS.x} /><path d="M5 19V3" stroke={CUBE_AXIS_COLORS.y} /><path d="m5 19 11-10" stroke={CUBE_AXIS_COLORS.z} /></svg>
          </CubeIconButton>
        </div>
        <div className={cn(styles.dock, styles.tools)} role="toolbar" aria-label={m.tools} data-cube-tools-toolbar>
          {TOOL_BUTTONS.map(({ id, Icon }) => <CubeIconButton key={id} label={m[id]} active={tool === id} onClick={() => chooseTool(id)} data-cube-tool={id}><Icon aria-hidden /></CubeIconButton>)}
          <CubeIconButton label={m.record} active={panel === "recording"} onClick={() => setPanel(panel === "recording" ? null : "recording")}><Circle aria-hidden className={session.recording === "recording" ? "fill-rose text-rose" : undefined} /></CubeIconButton>
          <span className="self-stretch border-t border-line" aria-hidden />
          <CubeIconButton label={m.previous} disabled={!editable || !session.work.cursor || replacementStep !== null} onClick={() => { updateSession((current) => undoCubeSession(current, -1)); clearPointer(); setCameraRequest((value) => value + 1); }}><Undo2 aria-hidden /></CubeIconButton>
          <CubeIconButton label={m.next} disabled={!editable || session.work.cursor >= session.work.operations.length || replacementStep !== null} onClick={() => { updateSession((current) => undoCubeSession(current, 1)); clearPointer(); setCameraRequest((value) => value + 1); }}><Redo2 aria-hidden /></CubeIconButton>
        </div>
        {session.recording !== "off" && <p className={styles.recordStatus} role="status">{session.recording === "recording" ? "● " : "Ⅱ "}{session.recording === "recording" ? m.recordingActive : m.recordingPaused}</p>}
        {state.groups.length > 0 && <div className={cn(styles.dock, styles.groups)} aria-label={m.groups} data-cube-group-scope>
          <Button size="sm" variant={activeGroupId === null ? "secondary" : "ghost"} className="h-7 px-2 py-0 text-xs" aria-pressed={activeGroupId === null} onClick={() => { setScopeId(null); setSelected([]); clearPointer(); }}>{m.allGroups}</Button>
          {state.groups.map((group) => <Button key={group.id} size="sm" variant={activeGroupId === group.id ? "secondary" : "ghost"} className="h-7 max-w-36 gap-1.5 px-2 py-0 text-xs" aria-pressed={activeGroupId === group.id} title={group.name} onClick={() => { setScopeId(group.id); setSelected([]); clearPointer(); }}><span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: group.color }} aria-hidden /><span className="truncate">{group.name}</span></Button>)}
        </div>}

        {panel && <CubeCanvasPanel title={panelTitle} closeLabel={m.closePanel} onClose={() => setPanel(null)}>
          {panel === "selection" && <div className="space-y-3 text-xs">
            <p className="leading-5 text-muted">{m.selectHint}</p><p>{m.selected}: {selectedIds.length} · {m.currentScope}: {scopeLabel}</p>
            <div className="flex flex-wrap gap-1">
              <CubeIconButton label={m.selectScope} onClick={() => setSelected(scopeIds)}><Boxes aria-hidden /></CubeIconButton>
              <CubeIconButton label={m.clearSelection} onClick={() => setSelected([])}><X aria-hidden /></CubeIconButton>
              <CubeIconButton label={m.removeSelected} disabled={!editable || !selectedIds.length} onClick={() => commit({ kind: "remove", ids: selectedIds })}><Trash2 aria-hidden /></CubeIconButton>
            </div>
            <label className="block" htmlFor="cube-group-name">{m.groupName}</label>
            <div className="flex gap-1"><Input id="cube-group-name" maxLength={40} value={groupName} placeholder={m.newGroup + " " + (state.groups.length + 1)} onChange={(event) => setGroupName(event.target.value)} className="h-8 min-w-0 text-xs" />
              <CubeIconButton label={m.createGroup} disabled={!editable || !selectedIds.length} onClick={createGroup}><Boxes aria-hidden /></CubeIconButton>
              <CubeIconButton label={m.ungroup} disabled={!editable || !activeGroupId} onClick={() => { if (activeGroupId && commit({ kind: "ungroup", id: activeGroupId })) { setScopeId(null); setSelected([]); } }}><Ungroup aria-hidden /></CubeIconButton>
            </div>
            {activeGroupId && <p className="leading-5 text-muted">{m.groupProtected}</p>}
          </div>}
          {panel === "color" && <div className="space-y-3 text-xs">
            <p className="leading-5 text-muted">{tool === "face" ? m.faceHint : m.colorHint}</p>
            <div className="flex flex-wrap gap-1" aria-label={m.colorLabel}>{CUBE_COLORS.map((value, index) => <CubeIconButton key={value} label={m.colors[index]} active={color === value} onClick={() => setColor(value)}><svg viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="9" fill={value} stroke="currentColor" strokeWidth=".5" /></svg></CubeIconButton>)}</div>
            <p>{m.currentScope}: {scopeLabel} · {targetIds.length} {m.cubeUnit}</p>
            <div className="flex flex-wrap gap-1">
              <CubeIconButton label={m.batchColor} disabled={!editable || !targetIds.length} onClick={() => commit({ kind: "color", ids: targetIds, color })}><PaintBucket aria-hidden /></CubeIconButton>
              <CubeIconButton label={m.batchPaint} disabled={!editable || !targetIds.length} onClick={() => commit(exteriorPaintOperation(state, targetIds, color))}><Paintbrush aria-hidden /></CubeIconButton>
              <CubeIconButton label={m.clearPaint} disabled={!editable || !targetIds.length} onClick={() => commit({ kind: "clear-paint", ids: targetIds })}><Eraser aria-hidden /></CubeIconButton>
            </div>
          </div>}
          {panel === "move" && <div className="space-y-3 text-xs">
            <p className="leading-5 text-muted">{m.moveHint}</p><p>{m.currentScope}: {scopeLabel} · {targetIds.length} {m.cubeUnit}</p>
            <div className="flex items-center gap-2"><label htmlFor="cube-move-distance" className="flex-1">{m.moveDistance}</label><Input id="cube-move-distance" className="h-8 w-20 text-xs" type="number" min={1} max={12} value={moveDistance} onChange={(event) => setMoveDistance(event.target.value)} /></div>
            {(["x", "y", "z"] as const).map((value) => <div key={value} className="flex items-center justify-between"><span className="font-bold" style={{ color: CUBE_AXIS_COLORS[value] }}>{value.toUpperCase()}</span><div className="flex gap-2">{([-1, 1] as const).map((sign) => <CubeIconButton key={sign} label={m.move + " " + value.toUpperCase() + " " + (sign > 0 ? "+" : "−") + moveDistance} disabled={!editable || !targetIds.length || !Number.isInteger(Number(moveDistance)) || Number(moveDistance) < 1 || Number(moveDistance) > 12} onClick={() => commit({ kind: "move", ids: targetIds, axis: value, distance: sign * Number(moveDistance) })}>{sign > 0 ? <Plus aria-hidden /> : <Minus aria-hidden />}</CubeIconButton>)}</div></div>)}
          </div>}
          {panel === "layers" && <div className="space-y-2 text-xs" data-cube-layer-panel>
            <div className="flex items-center gap-1" role="toolbar" aria-label={m.layerAxis}>{(["x", "y", "z"] as const).map((value) => <CubeIconButton key={value} label={m.layerAxis + " " + value.toUpperCase()} active={axis === value} onClick={() => setAxis(value)}><CubeAxisIcon axis={value} /></CubeIconButton>)}
              <CubeIconButton label={m.showAll} disabled={!editable || !state.hiddenCubeIds.some((id) => scopeIds.includes(id))} onClick={() => commit({ kind: "show-all", ids: scopeIds })}><Eye aria-hidden /></CubeIconButton>
            </div>
            <p className="leading-5 text-muted">{m.layerHint}</p>
            {layers.map((index) => {
              const members = state.cubes.filter((cube) => scopeIds.includes(cube.id) && cube.position[axis] === index);
              const hidden = members.every((cube) => !cubeIsVisible(state, cube));
              const number = cubeLayerNumber(state, axis, index);
              return <div key={index} className="flex items-center gap-2"><span className="flex-1" style={{ color: CUBE_AXIS_COLORS[axis] }}>{axis.toUpperCase()} {number} {m.layerUnit}{showMetrics ? " · " + members.length : ""}</span>
                <CubeIconButton label={(hidden ? m.show : m.hide) + " " + axis.toUpperCase() + " " + number + " " + m.layerUnit} active={!hidden} disabled={!editable} onClick={() => commit(cubeLayerOperation(state, axis, index, hidden, scopeIds))}>{hidden ? <EyeOff aria-hidden /> : <Eye aria-hidden />}</CubeIconButton>
                <CubeIconButton label={m.selectLayer + " " + axis.toUpperCase() + " " + number} onClick={() => setSelected(members.map((cube) => cube.id))}><MousePointer2 aria-hidden /></CubeIconButton>
              </div>;
            })}
          </div>}
          {panel === "recording" && <CubeRecordingPanel locale={locale} session={session} playing={playing} replacementStep={replacementStep}
            onStart={recordStart} onPause={() => updateSession(pauseCubeRecording)} onResume={recordResume} onStop={() => { updateSession(finishCubeRecording); setPlaying(false); }}
            onSeek={seek} onPlay={() => { if (playing) setPlaying(false); else { const cursor = session.preview !== null && session.preview < (session.lesson?.operations.length ?? 0) ? session.preview : 0; seek(cursor); setPlaying(true); } }}
            onReplace={(index) => { seek(index); setReplacementStep(index); setTool("select"); }} onCancelReplace={() => setReplacementStep(null)}
            onDelete={(index) => changeRecorded(editCubeRecording(session, session.lesson!.operations.filter((_, cursor) => cursor !== index)))}
            onMove={(from, to) => changeRecorded(moveCubeRecordedStep(session, from, to))} />}
          {panel === "model" && <div className="space-y-3 text-xs">
            <p className="leading-5 text-muted">{m.prepareNote} {m.scope}</p>
            {workspaceSelector}
            <label className="block">{m.library}</label>
            <div className="flex gap-1"><Select value={preset} onValueChange={(value) => setPreset(value as SpatialLabPresetId | "empty")}><SelectTrigger className="min-w-0 flex-1" aria-label={m.library}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="empty">{m.empty}</SelectItem>{SPATIAL_LAB_PRESETS.filter((item) => item.id !== SPATIAL_LAB_MEASUREMENT_PRESET_ID).map((item) => <SelectItem key={item.id} value={item.id}>{m[item.messageKey as "layeredCounting" | "hiddenCubes" | "threeViews" | "surfacePainting" | "hollowing"]}</SelectItem>)}</SelectContent></Select>
              <CubeIconButton label={m.loadPreset} onClick={() => setConfirmation("load")}><RotateCcw aria-hidden /></CubeIconButton>
            </div>
            <p className="leading-5 text-muted">{m.edgeNote}</p><p className="leading-5 text-muted">{m.axisNote}</p>
            <div className="flex items-center justify-between"><span>{m.metrics}</span><CubeIconButton label={showMetrics ? m.hideMetrics : m.showMetrics} active={showMetrics} onClick={() => setShowMetrics((value) => !value)}>{showMetrics ? <EyeOff aria-hidden /> : <Eye aria-hidden />}</CubeIconButton></div>
            {showMetrics && <><dl className="grid grid-cols-[1fr_auto] gap-1 tabular-nums"><dt>{m.volume}</dt><dd>{metrics.volume}</dd><dt>{m.totalArea}</dt><dd>{metrics.totalUnitFaces}</dd><dt>{m.exteriorArea}</dt><dd>{metrics.exteriorUnitFaces}</dd><dt>{m.interiorArea}</dt><dd>{metrics.interiorUnitFaces}</dd></dl><p>{m.paintHistogram}</p><p className="font-mono">{metrics.paintedHistogram.map((count, faces) => faces + "→" + count).join(" · ")}</p><p className="leading-5 text-muted">{m.geometryNote}</p></>}
            {mode === "demonstrate" && <CubeIconButton label={m.restartDemo} onClick={() => setConfirmation("demo")}><RotateCcw aria-hidden /></CubeIconButton>}
            <p className="leading-5 text-muted">{m.pending}</p>
          </div>}
        </CubeCanvasPanel>}
        {(notice || (session.preview !== null && panel !== "recording")) && <div className={styles.notice} role="status"><div className="flex items-center gap-2"><p className="flex-1">{notice || (replacementStep !== null ? m.editingStep : m.previewHint)}</p><CubeIconButton label={notice ? m.closePanel : m.exitPreview} onClick={() => { if (notice) setNotice(""); else seek(null); }}><X aria-hidden /></CubeIconButton></div></div>}
      </div>
    </div>
    <AlertDialog open={confirmation !== null} onOpenChange={(open) => { if (!open) setConfirmation(null); }}><AlertDialogContent><AlertDialogHeader>
      <AlertDialogTitle>{confirmation === "load" ? m.loadTitle : confirmation === "resume" ? m.resumeTitle : confirmation === "demo" ? m.restartDemo : m.recordNewTitle}</AlertDialogTitle>
      <AlertDialogDescription>{confirmation === "load" ? m.loadDescription : confirmation === "resume" ? m.resumeDescription : confirmation === "demo" ? m.demoNote : m.recordNewDescription}</AlertDialogDescription>
    </AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{m.cancel}</AlertDialogCancel><AlertDialogAction onClick={confirmChange}>{m.confirm}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}
