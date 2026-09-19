"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useLocale } from "next-intl";
import { Axis3d, Box, CircleDot, Droplets, Grid2X2, Hand, Magnet, Maximize, Move, Orbit, PaintBucket, Plus, RotateCcw, RotateCw, Scissors, Settings2, Spline, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { newId } from "@/lib/uuid";
import { SpatialAxisSnapButton, useSpatialAxisSnap } from "@/features/spatial-math/renderer-r3f/SpatialCameraControls";
import type { Axis } from "@/features/spatial-math/domain";
import { CubeCanvasPanel, CubeColorPicker, CubeIconButton, CubeViewIcon } from "../spatial-lab/CubeWorkbenchControls";
import { useToolSnapshot } from "../scenes/useToolSnapshot";
import { useSceneCapture } from "../courseware/useSceneCapture";
import type { CubeMoveOperation } from "../spatial-lab/cube-structures-drag";
import styles from "../spatial-lab/CubeStructuresWorkbench.module.css";
import { createSolidEntity, createSolidGeometryInitial, resizeSolidEntity, solidDimensionKeys, solidGeometryInitial, solidGeometrySnapshot, solidGeometrySnapshotSchema, SOLID_KINDS, SOLID_LIMITS, type SolidEntity, type SolidFeatureSelection, type SolidGeometryInitial, type SolidGeometrySnapshot, type SolidKind } from "./solid-geometry-contract";
import { getSolidsFrame, getSolidTopology } from "./solid-geometry";
import { solidGeometryMessages } from "./solid-geometry-messages";
import type { SolidGeometrySceneProps } from "./SolidGeometryScene";
import { moveSolidByDrag } from "./solid-geometry-drag";
import { solidEntitiesKey, useSolidPresentation } from "./useSolidPresentation";
import { SolidSectionControls } from "../solid-sections/SolidSectionControls";
import { useSolidSectionPresentation } from "../solid-sections/useSolidSectionPresentation";
import { solidSectionsMessages } from "../solid-sections/solid-sections-messages";
import { supportsSolidSection, type SolidSectionSettings } from "../solid-sections/solid-sections-contract";
import { MeasurementButton, MeasurementPanel } from "../solid-measurement/MeasurementControls";
import { MeasurementOverlay } from "../solid-measurement/MeasurementOverlay";
import { measurementDisplayEntity } from "../solid-measurement/measurement-model";

const Canvas = dynamic(() => import("./SolidGeometryCanvas"), { ssr: false, loading: () => <Skeleton className="size-full" /> });
type Tool = "orbit" | "pan" | "move" | "face" | "edge" | "vertex" | "section";
type Panel = "add" | "objects" | "move" | "turn" | "color" | "transparent" | "face" | "edge" | "vertex" | "settings" | "section" | "measurement" | null;
export interface SolidWorkspaceContext {
  snapshot: SolidGeometrySnapshot; selected: SolidEntity | null; disabled: boolean; locale: string;
  update: (next: SolidGeometrySnapshot) => boolean; closePanel: () => void;
}
export interface SolidGeometryWorkspaceProps {
  initial?: SolidGeometryInitial; onSnapshot?: (initial: SolidGeometryInitial | null) => void; readOnly?: boolean;
  classroom?: { state?: SolidGeometrySnapshot; onChange?: (next: SolidGeometrySnapshot) => Promise<void> };
  renderScene?: SolidGeometrySceneProps["renderScene"];
  renderToolbar?: (context: SolidWorkspaceContext) => ReactNode;
  renderPanel?: (context: SolidWorkspaceContext) => ReactNode;
  onToolChange?: () => void;
}
/** 共用备课/课堂宿主只管理离散参数；截面、测量通过三个扩展槽接入同一空间。 */
export function SolidGeometryWorkspace({ initial, onSnapshot, classroom, readOnly = false, renderScene, renderToolbar, renderPanel, onToolChange }: SolidGeometryWorkspaceProps) {
  const locale = useLocale() === "en" ? "en" : "zh", m = solidGeometryMessages(locale);
  const origin = useMemo(() => solidGeometrySnapshot(initial ?? createSolidGeometryInitial()), [initial]);
  const host = useToolSnapshot(origin, classroom), snapshot = host.snapshot;
  const disabled = readOnly || host.publishing || Boolean(classroom && !classroom.onChange);
  const [tool, setTool] = useState<Tool>("orbit"), [panel, setPanel] = useState<Panel>(null);
  const [axis, setAxis] = useState<Axis>("x"), [moveSnap, setMoveSnap] = useState(false), [dragging, setDragging] = useState(false);
  const [frame, setFrame] = useState(() => getSolidsFrame(origin.entities));
  const [instantKey, setInstantKey] = useState<string | null>(null);
  const [sectionDragging, setSectionDragging] = useState(false), [sectionInstantKey, setSectionInstantKey] = useState<string | null>(null);
  const [sectionGesture, setSectionGesture] = useState<{ source: SolidGeometrySnapshot; settings: SolidSectionSettings; pending: boolean } | null>(null);
  const axisSnap = useSpatialAxisSnap();
  const displayTargets = useMemo(() => snapshot.entities.map((entity) => entity.id === snapshot.selectedId ? measurementDisplayEntity(entity, snapshot.measurement) : entity), [snapshot.entities, snapshot.selectedId, snapshot.measurement]);
  const presentation = useSolidPresentation(displayTargets, instantKey);
  const sectionPreview = sectionGesture?.source === snapshot && (!sectionGesture.pending || !host.failed) ? sectionGesture.settings : null;
  const sectionPresentation = useSolidSectionPresentation(snapshot.section, sectionPreview, sectionInstantKey), sectionMessages = solidSectionsMessages(locale);
  const selected = snapshot.entities.find((entity) => entity.id === snapshot.selectedId) ?? null;
  const captured = useMemo(() => solidGeometryInitial(snapshot), [snapshot]);
  const capture = useSceneCapture(disabled || dragging || sectionDragging || !!sectionPreview || presentation.animating || sectionPresentation.animating ? null : captured, onSnapshot);
  const update = useCallback((next: SolidGeometrySnapshot) => {
    const parsed = solidGeometrySnapshotSchema.safeParse(next); if (!parsed.success) return false;
    setInstantKey(null); setSectionInstantKey(null); setSectionGesture(null); return host.update(parsed.data);
  }, [host]);
  const previewSection = useCallback((settings: SolidSectionSettings | null) => setSectionGesture(settings ? { source: snapshot, settings, pending: false } : null), [snapshot]);
  const commitSection = useCallback((section: SolidSectionSettings) => {
    if (disabled) return;
    if (update({ ...snapshot, section })) {
      setSectionInstantKey(JSON.stringify(section));
      if (classroom) setSectionGesture({ source: snapshot, settings: section, pending: true });
    }
  }, [disabled, update, snapshot, classroom]);
  const updateEntity = (next: SolidEntity) => update({ ...snapshot, entities: snapshot.entities.map((entity) => entity.id === next.id ? next : entity) });
  const pick = (id: string, feature: SolidFeatureSelection | null) => { if (!disabled) update({ ...snapshot, selectedId: id, feature }); };
  const open = (next: Panel, nextTool?: Tool) => { onToolChange?.(); setPanel((current) => current === next ? null : next); if (nextTool) setTool(nextTool); };
  const navigate = (next: Tool) => { setTool(next); setPanel(null); onToolChange?.(); };
  const fit = () => { setFrame(getSolidsFrame(snapshot.entities)); update({ ...snapshot, cameraRevision: snapshot.cameraRevision + 1 }); };
  const add = (kind: SolidKind) => {
    if (snapshot.entities.length >= SOLID_LIMITS.entities) return;
    const index = snapshot.entities.length;
    const entity = createSolidEntity(kind, newId(), { x: (index % 4) * 3, y: 1, z: Math.floor(index / 4) * 3 });
    const entities = [...snapshot.entities, entity];
    if (update({ ...snapshot, entities, selectedId: entity.id, feature: null, cameraRevision: snapshot.cameraRevision + 1 })) { setFrame(getSolidsFrame(entities)); setPanel("objects"); }
  };
  const remove = () => { if (!selected) return; const entities = snapshot.entities.filter((entity) => entity.id !== selected.id); update({ ...snapshot, entities, selectedId: entities.at(-1)?.id ?? null, feature: null }); };
  const move = (operation: CubeMoveOperation, direct = false) => { const entities = moveSolidByDrag(snapshot.entities, operation); if (!entities) return;
    if (update({ ...snapshot, entities }) && direct) setInstantKey(solidEntitiesKey(entities.map((entity) => entity.id === snapshot.selectedId ? measurementDisplayEntity(entity, snapshot.measurement) : entity))); };
  const drag = (operation: CubeMoveOperation) => move(operation, true);
  const rotate = (axis: Axis, sign: number) => { if (!selected) return; const value = selected.rotation[axis] + sign * Math.PI / 2;
    updateEntity({ ...selected, rotation: { ...selected.rotation, [axis]: Math.atan2(Math.sin(value), Math.cos(value)) } }); };
  const featureMode = tool === "face" || tool === "edge" || tool === "vertex" ? tool : "object";
  const topology = selected ? getSolidTopology(selected) : null;
  const parts = panel === "face" ? topology?.faces : panel === "edge" ? topology?.edges : panel === "vertex" ? topology?.vertices : null;
  const featureLabel = (id: string, index: number) => id in m.faces ? m.faces[id as keyof typeof m.faces] : id.startsWith("rim-") ? `${m.boundary} ${index + 1}` : `${panel === "edge" ? m.edge : m.vertex} ${index + 1}`;
  const context: SolidWorkspaceContext = { snapshot, selected, disabled, locale, update, closePanel: () => setPanel(null) };
  return <section className={styles.workspace} data-workbench-mode="courseware" data-solid-geometry-workspace="v1" aria-label={m.title} {...capture}>
    <div className={styles.viewport}><div className={styles.canvas}>
      <Canvas entities={presentation.entities} state={snapshot} selectedId={snapshot.selectedId} feature={snapshot.feature} pickMode={featureMode} section={sectionPresentation.frame}
        locale={locale} sectionEditable={tool === "section" && snapshot.section.enabled && snapshot.section.showPlane && !!selected && supportsSolidSection(selected.kind) && !presentation.animating && (!sectionPresentation.animating || sectionDragging)}
        sectionSettings={sectionPreview ?? snapshot.section} onSectionPreview={previewSection} onSectionCommit={commitSection} onSectionDragging={setSectionDragging}
        readOnly={disabled} onPick={pick} frame={frame} cameraRevision={snapshot.cameraRevision} axisSnap={axisSnap} moveSnap={moveSnap}
        navigationMode={tool === "pan" ? "pan" : tool === "move" ? "move" : "orbit"} moveAxis={axis} onMoveAxis={setAxis} onMove={drag} onDragging={setDragging} fallback={m.fallback}
        renderScene={(context) => <>{context.selected && <MeasurementOverlay entity={context.selected} settings={snapshot.measurement} feature={snapshot.feature} locale={locale} />}{renderScene?.(context)}</>} />
      {!snapshot.entities.length && <p className="pointer-events-none absolute left-4 top-16 text-sm text-muted">{m.empty}</p>}
      {host.failed && <p role="alert" className={styles.notice}>{m.syncError}</p>}
      <div className={`${styles.dock} ${styles.meta}`}>
        <CubeIconButton label={m.settings} active={panel === "settings"} disabled={disabled} onClick={() => open("settings")}><Settings2 aria-hidden /></CubeIconButton>
        <CubeIconButton label={m.reset} disabled={disabled} onClick={() => { setFrame(getSolidsFrame(origin.entities)); update({ ...structuredClone(origin), cameraRevision: snapshot.cameraRevision + 1 }); setTool("orbit"); setPanel(null); onToolChange?.(); }}><RotateCcw aria-hidden /></CubeIconButton>
      </div>
      <div className={`${styles.dock} ${styles.views}`} aria-label={m.fit}>
        {(["angle", "front", "left", "right", "top", "bottom"] as const).map((view) => <CubeIconButton key={view} label={m.views[view]} active={snapshot.view === view} disabled={disabled}
          onClick={() => update({ ...snapshot, view, cameraRevision: snapshot.cameraRevision + 1 })}><CubeViewIcon view={view} /></CubeIconButton>)}
        <CubeIconButton label={m.fit} disabled={disabled} onClick={fit}><Maximize aria-hidden /></CubeIconButton>
        <SpatialAxisSnapButton messages={m} disabled={disabled} iconOnly className={styles.icon} />
      </div>
      <div className={`${styles.dock} ${styles.tools}`} role="toolbar" aria-label={m.tools} data-solid-tools-toolbar>
        <CubeIconButton label={m.orbit} active={tool === "orbit"} disabled={disabled} onClick={() => navigate("orbit")}><Orbit aria-hidden /></CubeIconButton>
        <CubeIconButton label={m.pan} active={tool === "pan"} disabled={disabled} onClick={() => navigate("pan")}><Hand aria-hidden /></CubeIconButton>
        <CubeIconButton label={m.add} active={panel === "add"} disabled={disabled || snapshot.entities.length >= SOLID_LIMITS.entities} onClick={() => open("add")}><Plus aria-hidden /></CubeIconButton>
        <CubeIconButton label={m.objects} active={panel === "objects"} disabled={disabled || !selected} onClick={() => open("objects")}><Box aria-hidden /></CubeIconButton>
        <CubeIconButton label={m.move} active={tool === "move"} disabled={disabled || !selected} onClick={() => open("move", "move")}><Move aria-hidden /></CubeIconButton>
        <CubeIconButton label={m.turn} active={panel === "turn"} disabled={disabled || !selected} onClick={() => open("turn", "orbit")}><RotateCw aria-hidden /></CubeIconButton>
        <span className={styles.toolSeparator} />
        <CubeIconButton label={m.face} active={tool === "face"} disabled={disabled || !selected} onClick={() => open("face", "face")}><Square aria-hidden /></CubeIconButton>
        <CubeIconButton label={m.edge} active={tool === "edge"} disabled={disabled || !selected} onClick={() => open("edge", "edge")}><Spline aria-hidden /></CubeIconButton>
        <CubeIconButton label={m.vertex} active={tool === "vertex"} disabled={disabled || !selected} onClick={() => open("vertex", "vertex")}><CircleDot aria-hidden /></CubeIconButton>
        <CubeIconButton label={m.color} active={panel === "color"} disabled={disabled || !selected} onClick={() => open("color")}><PaintBucket aria-hidden /></CubeIconButton>
        <CubeIconButton label={m.transparent} active={panel === "transparent"} disabled={disabled || !selected} onClick={() => open("transparent")}><Droplets aria-hidden /></CubeIconButton>
        <CubeIconButton label={sectionMessages.title} active={panel === "section" || snapshot.section.enabled} disabled={disabled || !selected} onClick={() => {
          open("section", "section");
          if (selected && supportsSolidSection(selected.kind) && !snapshot.section.enabled) update({ ...snapshot, section: { ...snapshot.section, enabled: true }, measurement: { ...snapshot.measurement, enabled: false } });
        }}><Scissors aria-hidden /></CubeIconButton>
        <MeasurementButton locale={locale} active={panel === "measurement" || snapshot.measurement.enabled} disabled={disabled || !selected} onClick={() => {
          open("measurement", "orbit");
          if (!snapshot.measurement.enabled) update({ ...snapshot, measurement: { ...snapshot.measurement, enabled: true }, section: { ...snapshot.section, enabled: false } });
        }} />
        {renderToolbar?.(context)}
        <span className={styles.toolSeparator} />
        <CubeIconButton label={m.remove} disabled={disabled || !selected} onClick={remove}><Trash2 aria-hidden /></CubeIconButton>
      </div>
      {panel && panel !== "measurement" && <CubeCanvasPanel title={panel === "section" ? sectionMessages.title : m[panel]} anchor={panel === "settings" ? "meta" : "tool"} closeLabel={m.close} onClose={() => setPanel(null)}>
        <div className="space-y-3 text-xs">
          {panel === "section" && <SolidSectionControls entity={selected} settings={snapshot.section} locale={locale} disabled={disabled || sectionDragging} onChange={(section) => update({ ...snapshot, section, measurement: section.enabled ? { ...snapshot.measurement, enabled: false } : snapshot.measurement })} />}
          {panel === "add" && <><div className="grid grid-cols-2 gap-1">{SOLID_KINDS.map((kind) => <Button key={kind} size="sm" variant="ghost" disabled={disabled} onClick={() => add(kind)}>{m.kinds[kind]}</Button>)}</div><p className="text-muted">{m.limit}</p></>}
          {panel === "objects" && <>
            <div className="flex flex-wrap gap-1">{snapshot.entities.map((entity, index) => <Button key={entity.id} size="sm" variant={entity.id === snapshot.selectedId ? "secondary" : "ghost"} disabled={disabled} onClick={() => pick(entity.id, null)}>{index + 1} · {m.kinds[entity.kind]}</Button>)}</div>
            {selected && solidDimensionKeys(selected.kind).map((key) => <div key={`${selected.id}-${key}`} className="flex items-center gap-2"><Label className="w-12" htmlFor={`solid-${selected.id}-${key}`}>{m.dimensions[key]}</Label>
              <Input key={selected.dimensions[key]} id={`solid-${selected.id}-${key}`} type="number" defaultValue={selected.dimensions[key]} min={SOLID_LIMITS.dimensionMin} max={SOLID_LIMITS.dimensionMax} step={0.1} className="h-8 w-24" disabled={disabled}
                onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} onBlur={(event) => { const value = Number(event.currentTarget.value);
                  if (event.currentTarget.value.trim() && Number.isFinite(value) && value >= SOLID_LIMITS.dimensionMin && value <= SOLID_LIMITS.dimensionMax) updateEntity(resizeSolidEntity(selected, key, Math.round(value * 10) / 10)); else event.currentTarget.value = String(selected.dimensions[key]); }} />
            </div>)}
          </>}
          {panel === "move" && selected && <><p className="leading-5 text-muted">{m.moveHint}</p><Button size="sm" variant={moveSnap ? "secondary" : "ghost"} aria-pressed={moveSnap} disabled={disabled} onClick={() => setMoveSnap(!moveSnap)}><Magnet className="size-4" />{m.moveSnap}</Button>
            {(["x", "y", "z"] as const).map((axis) => <div key={axis} className="flex items-center gap-2"><span className="w-8">{axis.toUpperCase()}</span>{[-1, 1].map((sign) => <Button key={sign} size="sm" variant="secondary" disabled={disabled} aria-label={`${m.step} ${axis.toUpperCase()} ${sign > 0 ? "+" : "−"}`} onClick={() => move({ kind: "display-move", ids: [selected.id], axis, distance: sign * 0.5 })}>{sign > 0 ? "+ 0.5" : "− 0.5"}</Button>)}</div>)}
          </>}
          {panel === "turn" && selected && <><p className="leading-5 text-muted">{m.turnHint}</p>{(["x", "y", "z"] as const).map((axis) => <div key={axis} className="flex items-center gap-2"><span className="w-8">{axis.toUpperCase()}</span>{[-1, 1].map((sign) => <Button key={sign} size="sm" variant="secondary" disabled={disabled} aria-label={`${m.turn} ${axis.toUpperCase()} ${sign * 90}°`} onClick={() => rotate(axis, sign)}>{sign > 0 ? "+ 90°" : "− 90°"}</Button>)}</div>)}</>}
          {parts && <><p className="leading-5 text-muted">{m.featureHint}</p><div className="flex flex-wrap gap-1">{parts.map((part, index) => <Button key={part.id} size="sm" variant={snapshot.feature?.id === part.id && snapshot.feature.kind === panel ? "secondary" : "ghost"} disabled={disabled} onClick={() => pick(selected!.id, { entityId: selected!.id, kind: panel as SolidFeatureSelection["kind"], id: part.id })}>{featureLabel(part.id, index)}</Button>)}</div>
            {!parts.length && <p className="text-muted">{panel === "edge" ? m.noEdges : m.noVertices}</p>}<Button size="sm" variant="ghost" disabled={disabled || !snapshot.feature} onClick={() => pick(selected!.id, null)}>{m.clearFeature}</Button></>}
          {panel === "color" && selected && <CubeColorPicker value={selected.color} labels={m.colors} label={m.color} disabled={disabled} onChange={(color) => updateEntity({ ...selected, color })} />}
          {panel === "transparent" && selected && <><p>{m.opacity} · {Math.round(selected.opacity * 100)}%</p><div className="flex flex-wrap gap-1">{[1, 0.75, 0.5, 0.25, 0].map((opacity) => <Button key={opacity} size="sm" variant={selected.opacity === opacity ? "secondary" : "ghost"} disabled={disabled} onClick={() => updateEntity({ ...selected, opacity })}>{opacity * 100}%</Button>)}</div></>}
          {panel === "settings" && <>{([["axes", Axis3d], ["grid", Grid2X2]] as const).map(([key, Icon]) => <Button key={key} size="sm" variant={snapshot[key] ? "secondary" : "ghost"} aria-pressed={snapshot[key]} disabled={disabled} onClick={() => update({ ...snapshot, [key]: !snapshot[key] })}><Icon className="mr-1 size-4" />{m[key]}</Button>)}</>}
        </div>
      </CubeCanvasPanel>}
      {panel === "measurement" && <MeasurementPanel locale={locale} settings={snapshot.measurement} selected={selected} feature={snapshot.feature} disabled={disabled}
        onChange={(measurement) => update({ ...snapshot, measurement, section: measurement.enabled ? { ...snapshot.section, enabled: false } : snapshot.section })}
        onSelectFace={(feature) => update({ ...snapshot, feature })} onClose={() => setPanel(null)} />}
      {renderPanel?.(context)}
    </div></div>
  </section>;
}
