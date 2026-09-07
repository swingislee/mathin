"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { Box, Eraser, Eye, EyeOff, Layers3, Maximize, MousePointer2, Orbit, Paintbrush, PaintBucket, Pause, Play, Plus, Presentation, Redo2, RotateCcw, Shapes, SkipBack, SkipForward, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { voxelKey, type Axis, type VoxelCoordinate, type VoxelFaceSelection } from "@/features/spatial-math/domain";
import { SpatialAxisSnapButton, useSpatialAxisSnap, type SpatialCameraControlMessages } from "@/features/spatial-math/renderer-r3f/SpatialCameraControls";
import type { VoxelRendererMessages } from "@/features/spatial-math/renderer-r3f/VoxelFallback";
import { SPATIAL_LAB_MEASUREMENT_PRESET_ID, SPATIAL_LAB_PRESET_ID, SPATIAL_LAB_PRESETS, createSpatialLabPresetDraft, type SpatialLabPresetId } from "./preset";
import { CUBE_COLORS, CUBE_STRUCTURES_LIMITS, adjacentCube, appendCubeOperation, buildCubeStructureRenderModel, canPlaceCube, createCubeHistory, cubeFrame, cubeIsVisible, cubePaintGroups, cubeStructureMetrics, exteriorPaintOperation, replayCubeHistory, type CubeColor, type CubeHistory, type CubeOperation, type CubeTool, type CubeView } from "./cube-structures-contract";
import { cubeOperationLabel, cubeStructuresMessages } from "./cube-structures-messages";
import { cubeToolCursor } from "./cube-structures-cursor";

const CubeStructuresViewport = dynamic(() => import("./CubeStructuresViewport").then((module) => module.CubeStructuresViewport), { ssr: false });
const TOOL_BUTTONS = [
  { id: "orbit", Icon: Orbit }, { id: "select", Icon: MousePointer2 }, { id: "build", Icon: Plus },
  { id: "remove", Icon: Eraser }, { id: "color", Icon: PaintBucket }, { id: "face", Icon: Paintbrush }, { id: "layer", Icon: Layers3 },
] as const;
const VIEWS: readonly CubeView[] = ["angle", "front", "right", "top"];
const COLOR_MAP = Object.fromEntries(CUBE_COLORS.map((color) => [color, color]));

export function CubeStructuresWorkbench({ locale, rendererMessages, cameraMessages }: {
  readonly locale: "zh" | "en";
  readonly rendererMessages: VoxelRendererMessages;
  readonly cameraMessages: SpatialCameraControlMessages;
}) {
  const m = cubeStructuresMessages(locale);
  const [prepared, setPrepared] = useState(() => createCubeHistory(createSpatialLabPresetDraft(SPATIAL_LAB_PRESET_ID).model.cells));
  const [demo, setDemo] = useState<CubeHistory | null>(null);
  const [mode, setMode] = useState<"prepare" | "demonstrate">("prepare");
  const [tool, setTool] = useState<CubeTool>("orbit");
  const [color, setColor] = useState<CubeColor>(CUBE_COLORS[1]);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [axis, setAxis] = useState<Axis>("y");
  const [hoverFace, setHoverFace] = useState<VoxelFaceSelection | null>(null);
  const [hoverGround, setHoverGround] = useState<VoxelCoordinate | null>(null);
  const [showMetrics, setShowMetrics] = useState(false);
  const [preset, setPreset] = useState<SpatialLabPresetId | "empty">(SPATIAL_LAB_PRESET_ID);
  const [confirmation, setConfirmation] = useState<"load" | "start" | "branch" | null>(null);
  const [notice, setNotice] = useState("");
  const [playing, setPlaying] = useState(false);
  const [cameraRequest, setCameraRequest] = useState(0);
  const snap = useSpatialAxisSnap();
  const history = mode === "prepare" ? prepared : demo ?? prepared;
  const state = useMemo(() => replayCubeHistory(history), [history]);
  const selectedIds = useMemo(() => selected.filter((id) => state.cubes.some((cube) => cube.id === id)), [selected, state.cubes]);
  const model = useMemo(() => buildCubeStructureRenderModel(state, selectedIds, m.title), [state, selectedIds, m.title]);
  const paints = useMemo(() => cubePaintGroups(state), [state]);
  const metrics = useMemo(() => cubeStructureMetrics(state), [state]);
  const layers = useMemo(() => [...new Set(state.cubes.map((cube) => cube.position[axis]))].sort((a, b) => b - a), [axis, state.cubes]);
  const reviewing = history.cursor < history.operations.length;
  const editable = !reviewing && !playing;
  const nextPosition = hoverFace ? adjacentCube(hoverFace) : hoverGround;
  const validBuild = Boolean(nextPosition && canPlaceCube(nextPosition) && state.cubes.length < CUBE_STRUCTURES_LIMITS.cubes
    && !state.cubes.some((cube) => voxelKey(cube.position) === voxelKey(nextPosition)));

  function updateHistory(update: (current: CubeHistory) => CubeHistory) {
    if (mode === "prepare") setPrepared(update);
    else setDemo((current) => update(current ?? prepared));
  }
  function clearPointer() { setHoverFace(null); setHoverGround(null); setNotice(""); }
  function moveCursor(cursor: number) {
    setPlaying(false);
    updateHistory((current) => ({ ...current, cursor: Math.max(0, Math.min(cursor, current.operations.length)) }));
    setCameraRequest((value) => value + 1);
    clearPointer();
  }
  function commit(operation: CubeOperation) {
    if (!editable) return;
    if (history.cursor >= CUBE_STRUCTURES_LIMITS.steps) { setNotice(m.limit); return; }
    updateHistory((current) => appendCubeOperation(current, operation));
    if (operation.kind === "view") setCameraRequest((value) => value + 1);
    setNotice("");
  }
  function build(position: VoxelCoordinate) {
    if (!canPlaceCube(position) || state.cubes.some((cube) => voxelKey(cube.position) === voxelKey(position))) {
      setNotice(m.blockedBuild); return;
    }
    if (state.cubes.length >= CUBE_STRUCTURES_LIMITS.cubes) { setNotice(m.limit); return; }
    commit({ kind: "build", position, color: CUBE_COLORS[0] });
  }
  function clickFace(face: VoxelFaceSelection) {
    if (!editable) return;
    const cube = state.cubes.find((candidate) => voxelKey(candidate.position) === voxelKey(face.cell));
    if (!cube) return;
    switch (tool) {
      case "orbit": break;
      case "select": setSelected((current) => current.includes(cube.id) ? current.filter((id) => id !== cube.id) : [...current, cube.id]); break;
      case "build": build(adjacentCube(face)); break;
      case "remove": commit({ kind: "remove", ids: [cube.id] }); break;
      case "color": commit({ kind: "color", ids: [cube.id], color }); break;
      case "face": commit({ kind: "paint", faces: [{ id: cube.id, direction: face.direction }], color }); break;
      case "layer": commit({ kind: "layer", axis, index: cube.position[axis], visible: false }); break;
    }
  }
  function chooseMode(value: string) {
    if (value !== "prepare" && value !== "demonstrate") return;
    if (value === "demonstrate" && !demo) setDemo({ ...prepared, cursor: 0 });
    setMode(value); setPlaying(false); setSelected([]); clearPointer();
    setCameraRequest((request) => request + 1);
  }
  function confirmChange() {
    if (confirmation === "load") {
      const next = createCubeHistory(preset === "empty" ? [] : createSpatialLabPresetDraft(preset).model.cells);
      if (mode === "prepare") setPrepared(next); else setDemo(next);
    } else if (confirmation === "start") {
      updateHistory((current) => ({ ...current, initial: replayCubeHistory(current), operations: [], cursor: 0 }));
    } else if (confirmation === "branch") {
      updateHistory((current) => ({ ...current, operations: current.operations.slice(0, current.cursor) }));
    }
    setConfirmation(null); setPlaying(false); setSelected([]); clearPointer();
    setCameraRequest((request) => request + 1);
  }

  useEffect(() => {
    if (!playing || history.cursor >= history.operations.length) return;
    const timer = window.setTimeout(() => {
      const update = (current: CubeHistory) => ({ ...current, cursor: Math.min(current.cursor + 1, current.operations.length) });
      if (mode === "prepare") setPrepared(update); else setDemo((current) => current ? update(current) : current);
      setCameraRequest((request) => request + 1);
      if (history.cursor + 1 >= history.operations.length) setPlaying(false);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [history.cursor, history.operations.length, mode, playing]);

  const toolHint = m[`${tool}Hint`];
  return <div className="min-h-0 flex-1 overflow-auto" data-cube-structures-workbench="v1" data-workbench-mode={mode}>
    <div className="mx-auto max-w-[1500px] p-3 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
        <div><h2 className="flex items-center gap-2 text-lg font-semibold"><Box className="size-5 text-leaf-deep" aria-hidden />{m.title}</h2><p className="mt-1 text-xs text-muted">{m.subtitle}</p></div>
        <ToggleGroup type="single" value={mode} onValueChange={chooseMode} aria-label={m.modes} className="flex-wrap justify-start">
          <ToggleGroupItem value="prepare" className="gap-2"><Shapes className="size-4" aria-hidden />{m.prepare}</ToggleGroupItem>
          <ToggleGroupItem value="demonstrate" className="gap-2"><Presentation className="size-4" aria-hidden />{m.demonstrate}</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <p className="pb-3 text-xs leading-5 text-muted">{mode === "prepare" ? m.prepareNote : m.demoNote} {m.scope}</p>
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_270px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1 border-b border-line pb-2" role="toolbar" aria-label={m.tools}>
            {TOOL_BUTTONS.map(({ id, Icon }) => <Button key={id} type="button" variant={tool === id ? "secondary" : "ghost"}
              aria-pressed={tool === id} title={m[id]} onClick={() => { setTool(id); clearPointer(); }}
              className="h-auto min-h-12 min-w-12 flex-col gap-1 px-2 py-1.5" data-cube-tool={id}>
              <Icon aria-hidden className="size-5" /><span className="text-[10px]">{m[id]}</span>
            </Button>)}
            <span className="mx-2 hidden h-7 border-l border-line sm:block" aria-hidden />
            <Button size="sm" variant="ghost" className="size-8 p-0" title={m.previous} aria-label={m.previous} disabled={!history.cursor} onClick={() => moveCursor(history.cursor - 1)}><Undo2 className="size-4" aria-hidden /></Button>
            <Button size="sm" variant="ghost" className="size-8 p-0" title={m.next} aria-label={m.next} disabled={!reviewing} onClick={() => moveCursor(history.cursor + 1)}><Redo2 className="size-4" aria-hidden /></Button>
          </div>
          <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2 py-2">
            <p className="min-w-40 flex-1 text-xs leading-5 text-muted">{toolHint}</p>
            {(tool === "color" || tool === "face") && <div className="flex items-center gap-1" role="group" aria-label={m.colorLabel}>
              {CUBE_COLORS.map((value, index) => <Button key={value} size="sm" variant="ghost" title={m.colors[index]} aria-label={m.colors[index]} aria-pressed={color === value}
                className={cn("size-8 rounded-full border-2 p-0", color === value ? "border-ink" : "border-transparent")} onClick={() => setColor(value)}>
                <span className="size-5 rounded-full border border-ink/15" style={{ backgroundColor: value }} />
              </Button>)}
            </div>}
          </div>
          <div className="relative aspect-[4/3] min-h-64 overflow-hidden border border-line" style={{ cursor: editable ? cubeToolCursor(tool) : "grab" }} data-active-cube-tool={tool}>
            <CubeStructuresViewport model={model} messages={rendererMessages} materialColors={COLOR_MAP}
              axisSnapEnabled={snap} cameraRequestKey={cameraRequest} paintedFaceGroups={paints}
              readOnly={!editable} cameraInteractive onFaceSelect={tool === "orbit" ? undefined : clickFace}
              onFaceHover={tool === "orbit" || !editable ? undefined : (face) => { setHoverFace(face); if (face) setHoverGround(null); }}
              scene={{ tool: editable ? tool : "orbit", face: editable ? hoverFace : null, ground: editable ? hoverGround : null, validBuild,
                selectedPositions: state.cubes.filter((cube) => selectedIds.includes(cube.id) && cubeIsVisible(state, cube)).map((cube) => cube.position),
                onGroundHover: (position) => { setHoverGround(position); if (position) setHoverFace(null); }, onGroundClick: build }} />
            <div className="absolute bottom-2 left-2 right-2 flex flex-wrap items-center justify-between gap-2 rounded-md bg-paper/95 p-1.5 shadow-sm">
              <div className="flex flex-wrap items-center gap-1" role="group" aria-label={m.view}>
                {VIEWS.map((view) => <Button key={view} size="sm" variant={state.view === view ? "secondary" : "ghost"} className="h-7 px-2 text-xs"
                  disabled={!editable} onClick={() => commit({ kind: "view", view, frame: cubeFrame(state.cubes) })} aria-pressed={state.view === view}>{m[view]}</Button>)}
                <Button size="sm" variant="ghost" className="size-7 p-0" title={m.fit} aria-label={m.fit} disabled={!editable}
                  onClick={() => commit({ kind: "view", view: state.view, frame: cubeFrame(state.cubes) })}><Maximize className="size-3.5" aria-hidden /></Button>
              </div>
              <SpatialAxisSnapButton messages={cameraMessages} />
            </div>
          </div>
          {notice && <p className="mt-2 text-xs text-rose-deep" role="status">{notice}</p>}
          {reviewing && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <p className="text-muted">{m.replayNote}</p>
            <Button size="sm" variant="secondary" onClick={() => moveCursor(history.operations.length)}>{m.returnEnd}</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmation("branch")}>{m.branch}</Button>
          </div>}
          <div className="flex flex-wrap items-center gap-2 border-b border-line py-3" aria-label={m.selected}>
            <span className="mr-1 text-xs tabular-nums">{m.selected} {selectedIds.length}</span>
            <Button size="sm" variant="ghost" disabled={!editable} onClick={() => setSelected(state.cubes.filter((cube) => cubeIsVisible(state, cube)).map((cube) => cube.id))}>{m.selectVisible}</Button>
            <Button size="sm" variant="ghost" disabled={!selectedIds.length} onClick={() => setSelected([])}>{m.clearSelection}</Button>
            <Button size="sm" variant="secondary" disabled={!editable || !selectedIds.length} onClick={() => commit({ kind: "color", ids: selectedIds, color })}>{m.batchColor}</Button>
            <Button size="sm" variant="secondary" disabled={!editable || !selectedIds.length} onClick={() => commit(exteriorPaintOperation(state, selectedIds, color))}>{m.batchPaint}</Button>
            <Button size="sm" variant="ghost" disabled={!editable || !selectedIds.length} onClick={() => commit({ kind: "clear-paint", ids: selectedIds })}>{m.clearPaint}</Button>
          </div>
          <p className="pt-3 text-xs leading-5 text-muted">{m.pending}</p>
        </div>

        <aside className="min-w-0 space-y-5 xl:border-l xl:border-line xl:pl-4">
          <section aria-label={m.library}>
            <h3 className="mb-2 text-xs font-semibold">{m.library}</h3>
            <Select value={preset} onValueChange={(value) => setPreset(value as SpatialLabPresetId | "empty")}>
              <SelectTrigger className="w-full" aria-label={m.library}><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="empty">{m.empty}</SelectItem>
                {SPATIAL_LAB_PRESETS.filter((item) => item.id !== SPATIAL_LAB_MEASUREMENT_PRESET_ID).map((item) => <SelectItem key={item.id} value={item.id}>{m[item.messageKey as "layeredCounting" | "hiddenCubes" | "threeViews" | "surfacePainting" | "hollowing"]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" variant="ghost" className="mt-1" onClick={() => setConfirmation("load")}><RotateCcw className="mr-1 size-3.5" aria-hidden />{m.loadPreset}</Button>
          </section>
          <section aria-label={m.layers}>
            <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-xs font-semibold">{m.layers}</h3>
              <ToggleGroup type="single" value={axis} onValueChange={(value) => { if (value) setAxis(value as Axis); }} size="sm" aria-label={m.layerAxis}>
                {(["x", "y", "z"] as const).map((value) => <ToggleGroupItem key={value} value={value} className="h-7 w-7 text-xs">{value.toUpperCase()}</ToggleGroupItem>)}
              </ToggleGroup>
            </div>
            <div className="mt-2 max-h-44 overflow-auto">
              {layers.map((index) => {
                const hidden = state.hiddenLayers.some((layer) => layer.axis === axis && layer.index === index);
                const layerCubes = state.cubes.filter((cube) => cube.position[axis] === index);
                return <div key={index} className="flex items-center justify-between gap-1 py-0.5">
                  <Button size="sm" variant="ghost" className="h-8 flex-1 justify-start gap-2 text-xs" disabled={!editable}
                    aria-label={`${hidden ? m.show : m.hide} ${axis.toUpperCase()} = ${index}`} aria-pressed={!hidden}
                    onClick={() => commit({ kind: "layer", axis, index, visible: hidden })}>
                    {hidden ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
                    {axis.toUpperCase()} = {index}{showMetrics && <span className="ml-auto tabular-nums text-muted">{layerCubes.length}</span>}
                  </Button>
                  <Button variant="ghost" size="sm" className="size-7 p-0" disabled={!editable} title={m.selectLayer} aria-label={`${m.selectLayer} ${axis.toUpperCase()} = ${index}`}
                    onClick={() => setSelected(layerCubes.map((cube) => cube.id))}><MousePointer2 className="size-3" aria-hidden /></Button>
                </div>;
              })}
            </div>
            <Button size="sm" variant="ghost" className="mt-1 h-7 text-xs" disabled={!editable || !state.hiddenLayers.length} onClick={() => commit({ kind: "show-all" })}>{m.showAll}</Button>
          </section>
          <section aria-label={m.metrics}>
            <Button size="sm" variant="ghost" className="h-7 px-0 text-xs" onClick={() => setShowMetrics((value) => !value)} aria-expanded={showMetrics}>{showMetrics ? m.hideMetrics : m.showMetrics}</Button>
            {showMetrics && <div className="mt-2 space-y-2 text-xs">
              <dl className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-1.5 tabular-nums">
                <dt>{m.volume}</dt><dd>{metrics.volume}</dd><dt>{m.totalArea}</dt><dd>{metrics.totalUnitFaces}</dd>
                <dt>{m.exteriorArea}</dt><dd>{metrics.exteriorUnitFaces}</dd><dt>{m.interiorArea}</dt><dd>{metrics.interiorUnitFaces}</dd>
              </dl><p className="pt-1 font-medium">{m.paintHistogram}</p>
              <p className="font-mono">{metrics.paintedHistogram.map((count, faces) => `${faces}→${count}`).join(" · ")}</p>
              <p className="leading-5 text-muted">{m.geometryNote}</p>
            </div>}
            <Button size="sm" variant="secondary" className="mt-2 w-full" disabled={!editable || !state.cubes.length} onClick={() => commit(exteriorPaintOperation(state, state.cubes.map((cube) => cube.id), color))}>{m.paintAll}</Button>
          </section>
          <section aria-label={m.steps}>
            <div className="flex items-center justify-between gap-2"><h3 className="text-xs font-semibold">{m.steps}</h3><span className="text-xs tabular-nums text-muted">{history.cursor} / {history.operations.length}</span></div>
            <div className="my-2 flex items-center gap-1">
              <Button size="sm" variant="ghost" className="size-8 p-0" title={m.initial} aria-label={m.initial} disabled={!history.cursor} onClick={() => moveCursor(0)}><SkipBack className="size-4" aria-hidden /></Button>
              <Button size="sm" variant="secondary" className="size-8 p-0" title={playing ? m.pause : m.play} aria-label={playing ? m.pause : m.play} disabled={!history.operations.length}
                onClick={() => { if (playing) setPlaying(false); else { if (!reviewing) moveCursor(0); setPlaying(true); } }}>
                {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}</Button>
              <Button size="sm" variant="ghost" className="size-8 p-0" title={m.next} aria-label={m.next} disabled={!reviewing} onClick={() => moveCursor(history.cursor + 1)}><SkipForward className="size-4" aria-hidden /></Button>
              <Button size="sm" variant="ghost" className="ml-auto h-8 px-1 text-xs" onClick={() => {
                if (mode === "prepare") setConfirmation("start");
                else { setDemo({ ...prepared, cursor: 0 }); setPlaying(false); clearPointer(); setCameraRequest((request) => request + 1); }
              }}>{mode === "prepare" ? m.setStart : m.restartDemo}</Button>
            </div>
            <ol className="max-h-64 space-y-0.5 overflow-auto" data-cube-operation-timeline>
              <li><Button variant="ghost" size="sm" className={cn("h-8 w-full justify-start text-xs", history.cursor === 0 && "bg-moon/40")} aria-current={history.cursor === 0 ? "step" : undefined} onClick={() => moveCursor(0)}>0 · {m.initial}</Button></li>
              {history.operations.map((operation, index) => <li key={index}><Button variant="ghost" size="sm"
                className={cn("h-auto min-h-8 w-full justify-start gap-2 py-1.5 text-left text-xs", history.cursor === index + 1 && "bg-moon/40")}
                title={cubeOperationLabel(operation, locale)} aria-current={history.cursor === index + 1 ? "step" : undefined} onClick={() => moveCursor(index + 1)}>
                <span className="w-4 shrink-0 tabular-nums text-muted">{index + 1}</span><span className="min-w-0 whitespace-normal">{cubeOperationLabel(operation, locale)}</span>
                {"color" in operation && <span className="ml-auto size-3 shrink-0 rounded-full border border-ink/15" style={{ backgroundColor: operation.color }} />}
              </Button></li>)}
            </ol>
            {!history.operations.length && <p className="mt-2 text-xs leading-5 text-muted">{m.emptySteps}</p>}
          </section>
        </aside>
      </div>
    </div>
    <AlertDialog open={confirmation !== null} onOpenChange={(open) => { if (!open) setConfirmation(null); }}>
      <AlertDialogContent><AlertDialogHeader>
        <AlertDialogTitle>{confirmation === "load" ? m.loadTitle : confirmation === "branch" ? m.branchTitle : m.startTitle}</AlertDialogTitle>
        <AlertDialogDescription>{confirmation === "load" ? m.loadDescription : confirmation === "branch" ? m.branchDescription : m.startDescription}</AlertDialogDescription>
      </AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{m.cancel}</AlertDialogCancel><AlertDialogAction onClick={confirmChange}>{m.confirm}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </div>;
}
