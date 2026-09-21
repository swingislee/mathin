"use client";

import { SpatialActionButton } from "../spatial-interaction/SpatialActionButton";
import { SpatialActionIcon } from "../spatial-interaction/SpatialActionIcon";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useLocale } from "next-intl";
import { SpatialViewButtons, SPATIAL_ALL_VIEWS } from "../spatial-interaction/SpatialViewButtons";
import { SpatialAxisSteps } from "../spatial-interaction/SpatialAxisSteps";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { newId } from "@/lib/uuid";
import { SpatialAxisSnapButton, useSpatialAxisSnap } from "@/features/spatial-math/renderer-r3f/SpatialCameraControls";
import type { Axis } from "@/features/spatial-math/domain";
import { SpatialCanvasPanel, SpatialColorPicker } from "../spatial-interaction/SpatialWorkbenchControls";
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
import { spatialDirectManipulation } from "../spatial-interaction/policy";
import { spatialQuarterTurn } from "../spatial-interaction/rigid-motion";
import { useSpatialDirectCommit } from "../spatial-interaction/useSpatialDirectCommit";
import { useSpatialToolState } from "../spatial-interaction/useSpatialToolState";

import { solidRollTarget } from "./solid-geometry-roll";
import { SPATIAL_ROLL_DIRECTIONS } from "../spatial-interaction/rolling";
import { SpatialRollButtons, type SpatialRollAction } from "../spatial-interaction/SpatialRollButtons";
import { spatialActionMessages } from "../spatial-interaction/messages";

const Canvas = dynamic(() => import("./SolidGeometryCanvas"), { ssr: false, loading: () => <Skeleton className="size-full" /> });
type Tool = "orbit" | "pan" | "move" | "face" | "edge" | "vertex" | "section";
type Panel = "add" | "objects" | "move" | "turn" | "roll" | "color" | "transparent" | "face" | "edge" | "vertex" | "settings" | "section" | "measurement" | null;
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
  const locale = useLocale() === "en" ? "en" : "zh", m = { ...solidGeometryMessages(locale), ...spatialActionMessages(locale) };
  const origin = useMemo(() => solidGeometrySnapshot(initial ?? createSolidGeometryInitial()), [initial]);
  const host = useToolSnapshot(origin, classroom), snapshot = host.snapshot;
  const disabled = readOnly || host.publishing || Boolean(classroom && !classroom.onChange);
  const controls = useSpatialToolState<Tool, Exclude<Panel, null>>({ defaultTool: "orbit", panels: {
    add: "orbit", objects: "orbit", move: "move", turn: "orbit", roll: "orbit", color: "orbit", transparent: "orbit", face: "face", edge: "edge", vertex: "vertex", settings: "orbit", section: "section", measurement: "orbit",
  } });
  const { tool, panel, setPanel, selectionActive, activateSelection } = controls;
  const [axis, setAxis] = useState<Axis>("x"), [moveSnap, setMoveSnap] = useState(false), [dragging, setDragging] = useState(false);
  const [frame, setFrame] = useState(() => getSolidsFrame(origin.entities));
  const [instantKey, setInstantKey] = useState<string | null>(null);
  const [sectionDragging, setSectionDragging] = useState(false), [sectionInstantKey, setSectionInstantKey] = useState<string | null>(null);
  const [sectionGesture, setSectionGesture] = useState<{ source: SolidGeometrySnapshot; settings: SolidSectionSettings; pending: boolean } | null>(null);
  const axisSnap = useSpatialAxisSnap();
  const directMove = useSpatialDirectCommit(snapshot, host.failed);
  const displaySnapshot = directMove.displayed;
  const displayTargets = useMemo(() => displaySnapshot.entities.map((entity) => entity.id === displaySnapshot.selectedId ? measurementDisplayEntity(entity, displaySnapshot.measurement) : entity), [displaySnapshot.entities, displaySnapshot.selectedId, displaySnapshot.measurement]);
  const presentation = useSolidPresentation(displayTargets, instantKey);
  const sectionPreview = sectionGesture?.source === snapshot && (!sectionGesture.pending || !host.failed) ? sectionGesture.settings : null;
  const sectionPresentation = useSolidSectionPresentation(snapshot.section, sectionPreview, sectionInstantKey), sectionMessages = solidSectionsMessages(locale);
  const selected = snapshot.entities.find((entity) => entity.id === snapshot.selectedId) ?? null;
  const rollTargets = useMemo(() => panel === "roll" && selected ? Object.fromEntries(SPATIAL_ROLL_DIRECTIONS.map((direction) => [direction, solidRollTarget(selected, direction, snapshot.entities)])) : {}, [panel, selected, snapshot.entities]);
  const captured = useMemo(() => solidGeometryInitial(snapshot), [snapshot]);
  const capture = useSceneCapture(disabled || dragging || sectionDragging || !!sectionPreview || presentation.animating || sectionPresentation.animating ? null : captured, onSnapshot);
  const update = useCallback((next: SolidGeometrySnapshot) => {
    const parsed = solidGeometrySnapshotSchema.safeParse(next); if (!parsed.success) return false;
    setInstantKey(null); directMove.clear(); setSectionInstantKey(null); setSectionGesture(null); return host.update(parsed.data);
  }, [host, directMove]);
  const previewSection = useCallback((settings: SolidSectionSettings | null) => setSectionGesture(settings ? { source: snapshot, settings, pending: false } : null), [snapshot]);
  const commitSection = useCallback((section: SolidSectionSettings) => {
    if (disabled) return;
    if (update({ ...snapshot, section })) {
      setSectionInstantKey(JSON.stringify(section));
      if (classroom) setSectionGesture({ source: snapshot, settings: section, pending: true });
    }
  }, [disabled, update, snapshot, classroom]);
  const updateEntity = (next: SolidEntity) => update({ ...snapshot, entities: snapshot.entities.map((entity) => entity.id === next.id ? next : entity) });
  const pick = (id: string, feature: SolidFeatureSelection | null) => { if (!disabled) { activateSelection(); update({ ...snapshot, selectedId: id, feature }); } };
  const open = (next: Exclude<Panel, null>, nextTool?: Tool) => { onToolChange?.(); if (next !== "settings" && next !== "add") activateSelection(); controls.togglePanel(next, nextTool); };
  const navigate = (next: Tool) => { controls.chooseTool(next); onToolChange?.(); };
  const fit = () => { setFrame(getSolidsFrame(snapshot.entities)); update({ ...snapshot, cameraRevision: snapshot.cameraRevision + 1 }); };
  const add = (kind: SolidKind) => {
    if (snapshot.entities.length >= SOLID_LIMITS.entities) return;
    const index = snapshot.entities.length;
    const entity = createSolidEntity(kind, newId(), { x: (index % 4) * 3, y: 1, z: Math.floor(index / 4) * 3 });
    const entities = [...snapshot.entities, entity];
    if (update({ ...snapshot, entities, selectedId: entity.id, feature: null, cameraRevision: snapshot.cameraRevision + 1 })) { activateSelection(); setFrame(getSolidsFrame(entities)); setPanel("objects"); }
  };
  const remove = () => { if (!selected) return; const entities = snapshot.entities.filter((entity) => entity.id !== selected.id); update({ ...snapshot, entities, selectedId: entities.at(-1)?.id ?? null, feature: null }); };
  const move = (operation: CubeMoveOperation, direct = false) => { const entities = moveSolidByDrag(snapshot.entities, operation); if (!entities) return;
    const next = { ...snapshot, entities, selectedId: operation.ids[0], feature: snapshot.selectedId === operation.ids[0] ? snapshot.feature : null };
    if (update(next) && direct) { activateSelection(); directMove.hold(next); setInstantKey(solidEntitiesKey(entities.map((entity) => entity.id === operation.ids[0] ? measurementDisplayEntity(entity, snapshot.measurement) : entity))); } };
  const drag = (operation: CubeMoveOperation) => move(operation, true);
  const rotate = (axis: Axis, sign: number) => { if (!selected) return;
    updateEntity({ ...selected, rotation: spatialQuarterTurn(selected.rotation, axis, sign > 0 ? 1 : -1) }); };
  const rollAction: SpatialRollAction = { label: m.roll, disabled: disabled || presentation.animating || dragging, plans: Object.fromEntries(Object.entries(rollTargets).flatMap(([direction, result]) => result ? [[direction, result.plan]] : [])),
    onRoll: (direction) => { const result = rollTargets[direction]; if (result && !disabled && !presentation.animating) updateEntity(result.target); },
  };
  const featureMode = tool === "face" || tool === "edge" || tool === "vertex" ? tool : "object";
  const topology = selected ? getSolidTopology(selected) : null;
  const parts = panel === "face" ? topology?.faces : panel === "edge" ? topology?.edges : panel === "vertex" ? topology?.vertices : null;
  const featureLabel = (id: string, index: number) => id in m.faces ? m.faces[id as keyof typeof m.faces] : id.startsWith("rim-") ? `${m.boundary} ${index + 1}` : `${panel === "edge" ? m.edge : m.vertex} ${index + 1}`;
  const context: SolidWorkspaceContext = { snapshot, selected, disabled, locale, update, closePanel: () => setPanel(null) };
  return <section className={styles.workspace} data-workbench-mode="courseware" data-solid-geometry-workspace="v1" aria-label={m.title} {...capture} {...controls.bindings}>
    <div className={styles.viewport}><div className={styles.canvas}>
      <Canvas entities={presentation.entities} state={snapshot} selectedId={snapshot.selectedId} feature={snapshot.feature} pickMode={featureMode} section={sectionPresentation.frame}
        selectionActive={selectionActive} onPointerMissed={!disabled && !dragging && !sectionDragging && !presentation.animating ? controls.onPointerMissed : undefined}
        locale={locale} sectionEditable={selectionActive && (tool === "section" || spatialDirectManipulation(tool)) && snapshot.section.enabled && snapshot.section.showPlane && !!selected && supportsSolidSection(selected.kind) && !presentation.animating && (!sectionPresentation.animating || sectionDragging)}
        sectionSettings={sectionPreview ?? snapshot.section} onSectionPreview={previewSection} onSectionCommit={commitSection} onSectionDragging={setSectionDragging}
        readOnly={disabled} onPick={pick} frame={frame} cameraRevision={snapshot.cameraRevision} axisSnap={axisSnap} moveSnap={moveSnap}
        cameraInteractive={!readOnly && !(classroom && !classroom.onChange)}
        navigationMode={tool === "pan" ? "pan" : tool === "move" ? "move" : "orbit"} moveAxis={axis} onMoveAxis={setAxis} onMove={drag} onDragging={setDragging} fallback={m.fallback}
        objectManipulation={spatialDirectManipulation(tool)} objectAnimating={presentation.animating} rotationAction={{ axis, onAxisChange: setAxis, onRotate: rotate, label: m.turn }}
        rotationHandles={panel === "turn"} onToggleRotationHandles={() => open("turn")}
        onTransform={(entity) => {
          if (disabled) return false;
          const next = { ...snapshot, entities: snapshot.entities.map((item) => item.id === entity.id ? entity : item) };
          if (!update(next)) return false;
          directMove.hold(next); setInstantKey(solidEntitiesKey(next.entities.map((item) => item.id === next.selectedId ? measurementDisplayEntity(item, snapshot.measurement) : item))); return true;
        }}
        rollAction={panel === "roll" ? rollAction : undefined}
        renderScene={(context) => <>{context.selected && <MeasurementOverlay entity={context.selected} settings={snapshot.measurement} feature={snapshot.feature} locale={locale} />}{renderScene?.(context)}</>} />
      {!snapshot.entities.length && <p className="pointer-events-none absolute left-4 top-16 text-sm text-muted">{m.empty}</p>}
      {host.failed && <p role="alert" className={styles.notice}>{m.syncError}</p>}
      <div className={`${styles.dock} ${styles.meta}`}>
        <SpatialActionButton action="settings" label={m.settings} active={panel === "settings"} disabled={disabled} onClick={() => open("settings")} />
        <SpatialActionButton action="reset" label={m.reset} disabled={disabled} onClick={() => { setFrame(getSolidsFrame(origin.entities)); update({ ...structuredClone(origin), cameraRevision: snapshot.cameraRevision + 1 }); controls.closePanel(); onToolChange?.(); }} />
      </div>
      <div className={`${styles.dock} ${styles.views}`} aria-label={m.fit}>
        <SpatialViewButtons views={SPATIAL_ALL_VIEWS} value={snapshot.view} labels={m.views} disabled={disabled}
          onChange={(view) => update({ ...snapshot, view, cameraRevision: snapshot.cameraRevision + 1 })} fit={{ label: m.fit, onClick: fit }} />
        <SpatialAxisSnapButton messages={m} disabled={disabled} iconOnly className={styles.icon} />
      </div>
      <div className={`${styles.dock} ${styles.tools}`} role="toolbar" aria-label={m.tools} data-solid-tools-toolbar>
        <SpatialActionButton action="orbit" label={m.orbit} active={tool === "orbit"} disabled={disabled} onClick={() => navigate("orbit")} />
        <SpatialActionButton action="pan" label={m.pan} active={tool === "pan"} disabled={disabled} onClick={() => navigate("pan")} />
        <SpatialActionButton action="add" label={m.add} active={panel === "add"} disabled={disabled || snapshot.entities.length >= SOLID_LIMITS.entities} onClick={() => open("add")} />
        <SpatialActionButton action="objects" label={m.objects} active={panel === "objects"} disabled={disabled || !selected} onClick={() => open("objects")} />
        <SpatialActionButton action="move" label={m.move} active={tool === "move"} disabled={disabled || !selected} onClick={() => open("move", "move")} />
        <SpatialActionButton action="rotate" label={m.turn} active={panel === "turn"} disabled={disabled || !selected} onClick={() => open("turn", "orbit")} />
        <SpatialActionButton action="roll" label={m.roll} active={panel === "roll"} disabled={disabled || !selected || (selected.kind !== "cube" && selected.kind !== "cuboid")} onClick={() => open("roll")} />
        <span className={styles.toolSeparator} />
        <SpatialActionButton action="face" label={m.face} active={tool === "face"} disabled={disabled || !selected} onClick={() => open("face", "face")} />
        <SpatialActionButton action="edge" label={m.edge} active={tool === "edge"} disabled={disabled || !selected} onClick={() => open("edge", "edge")} />
        <SpatialActionButton action="vertex" label={m.vertex} active={tool === "vertex"} disabled={disabled || !selected} onClick={() => open("vertex", "vertex")} />
        <SpatialActionButton action="color" label={m.color} active={panel === "color"} disabled={disabled || !selected} onClick={() => open("color")} />
        <SpatialActionButton action="opacity" label={m.transparent} active={panel === "transparent"} disabled={disabled || !selected} onClick={() => open("transparent")} />
        <SpatialActionButton action="section" label={sectionMessages.title} active={panel === "section" || snapshot.section.enabled} disabled={disabled || !selected} onClick={() => {
          open("section", "section");
          if (selected && supportsSolidSection(selected.kind) && !snapshot.section.enabled) update({ ...snapshot, section: { ...snapshot.section, enabled: true }, measurement: { ...snapshot.measurement, enabled: false } });
        }} />
        <MeasurementButton locale={locale} active={panel === "measurement" || snapshot.measurement.enabled} disabled={disabled || !selected} onClick={() => {
          open("measurement", "orbit");
          if (!snapshot.measurement.enabled) update({ ...snapshot, measurement: { ...snapshot.measurement, enabled: true }, section: { ...snapshot.section, enabled: false } });
        }} />
        {renderToolbar?.(context)}
        <span className={styles.toolSeparator} />
        <SpatialActionButton action="remove" label={m.remove} disabled={disabled || !selected} onClick={remove} />
      </div>
      {panel && panel !== "measurement" && <SpatialCanvasPanel title={panel === "section" ? sectionMessages.title : m[panel]} anchor={panel === "settings" ? "meta" : "tool"} closeLabel={m.close} onClose={() => setPanel(null)}>
        <div className="space-y-3 text-xs">
          {panel === "roll" && <><p className="text-muted">{m.rollHint}</p><SpatialRollButtons action={rollAction} /><p className="text-muted">{m.rollBlocked}</p></>}
          {panel === "section" && <SolidSectionControls entity={selected} settings={snapshot.section} locale={locale} disabled={disabled || sectionDragging} onChange={(section) => update({ ...snapshot, section, measurement: section.enabled ? { ...snapshot.measurement, enabled: false } : snapshot.measurement })} />}
          {panel === "add" && <><div className="grid grid-cols-2 gap-1">{SOLID_KINDS.map((kind) => <Button key={kind} size="sm" variant="ghost" disabled={disabled} onClick={() => add(kind)}>{m.kinds[kind]}</Button>)}</div><p className="text-muted">{m.limit}</p></>}
          {panel === "objects" && <>
            <div className="flex flex-wrap gap-1">{snapshot.entities.map((entity, index) => <Button key={entity.id} size="sm" variant={selectionActive && entity.id === snapshot.selectedId ? "secondary" : "ghost"} disabled={disabled} onClick={() => pick(entity.id, null)}>{index + 1} · {m.kinds[entity.kind]}</Button>)}</div>
            {selected && solidDimensionKeys(selected.kind).map((key) => <div key={`${selected.id}-${key}`} className="flex items-center gap-2"><Label className="w-12" htmlFor={`solid-${selected.id}-${key}`}>{m.dimensions[key]}</Label>
              <Input key={selected.dimensions[key]} id={`solid-${selected.id}-${key}`} type="number" defaultValue={selected.dimensions[key]} min={SOLID_LIMITS.dimensionMin} max={SOLID_LIMITS.dimensionMax} step={0.1} className="h-8 w-24" disabled={disabled}
                onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} onBlur={(event) => { const value = Number(event.currentTarget.value);
                  if (event.currentTarget.value.trim() && Number.isFinite(value) && value >= SOLID_LIMITS.dimensionMin && value <= SOLID_LIMITS.dimensionMax) updateEntity(resizeSolidEntity(selected, key, Math.round(value * 10) / 10)); else event.currentTarget.value = String(selected.dimensions[key]); }} />
            </div>)}
          </>}
          {panel === "move" && selected && <><p className="leading-5 text-muted">{m.moveHint}</p><Button size="sm" variant={moveSnap ? "secondary" : "ghost"} aria-pressed={moveSnap} disabled={disabled} onClick={() => setMoveSnap(!moveSnap)}><SpatialActionIcon action="moveSnap" className="size-4" />{m.moveSnap}</Button>
            <SpatialAxisSteps label={m.move} step={0.5} disabled={disabled} formatLabel={(axis, sign) => `${m.step} ${axis.toUpperCase()} ${sign > 0 ? "+" : "−"}`}
              onStep={(axis, sign) => move({ kind: "display-move", ids: [selected.id], axis, distance: sign * 0.5 })} />
          </>}
          {panel === "turn" && selected && <><p className="leading-5 text-muted">{m.turnHint}</p><SpatialAxisSteps label={m.turn} step={90} unit="°" disabled={disabled}
            formatLabel={(axis, sign) => `${m.turn} ${axis.toUpperCase()} ${sign * 90}°`} onStep={rotate} /></>}
          {parts && <><p className="leading-5 text-muted">{m.featureHint}</p><div className="flex flex-wrap gap-1">{parts.map((part, index) => <Button key={part.id} size="sm" variant={snapshot.feature?.id === part.id && snapshot.feature.kind === panel ? "secondary" : "ghost"} disabled={disabled} onClick={() => pick(selected!.id, { entityId: selected!.id, kind: panel as SolidFeatureSelection["kind"], id: part.id })}>{featureLabel(part.id, index)}</Button>)}</div>
            {!parts.length && <p className="text-muted">{panel === "edge" ? m.noEdges : m.noVertices}</p>}<Button size="sm" variant="ghost" disabled={disabled || !snapshot.feature} onClick={() => pick(selected!.id, null)}>{m.clearFeature}</Button></>}
          {panel === "color" && selected && <SpatialColorPicker value={selected.color} labels={m.colors} label={m.color} disabled={disabled} onChange={(color) => updateEntity({ ...selected, color })} />}
          {panel === "transparent" && selected && <><p>{m.opacity} · {Math.round(selected.opacity * 100)}%</p><div className="flex flex-wrap gap-1">{[1, 0.75, 0.5, 0.25, 0].map((opacity) => <Button key={opacity} size="sm" variant={selected.opacity === opacity ? "secondary" : "ghost"} disabled={disabled} onClick={() => updateEntity({ ...selected, opacity })}>{opacity * 100}%</Button>)}</div></>}
          {panel === "settings" && <>{(["axes", "grid"] as const).map((key) => <Button key={key} size="sm" variant={snapshot[key] ? "secondary" : "ghost"} aria-pressed={snapshot[key]} disabled={disabled} onClick={() => update({ ...snapshot, [key]: !snapshot[key] })}><SpatialActionIcon action={key} className="mr-1 size-4" />{m[key]}</Button>)}</>}
        </div>
      </SpatialCanvasPanel>}
      {panel === "measurement" && <MeasurementPanel locale={locale} settings={snapshot.measurement} selected={selected} feature={snapshot.feature} disabled={disabled}
        onChange={(measurement) => update({ ...snapshot, measurement, section: measurement.enabled ? { ...snapshot.section, enabled: false } : snapshot.section })}
        onSelectFace={(feature) => update({ ...snapshot, feature })} onClose={() => setPanel(null)} />}
      {renderPanel?.(context)}
    </div></div>
  </section>;
}
