"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { SpatialAxisSnapButton, useSpatialAxisSnap } from "@/features/spatial-math/renderer-r3f/SpatialCameraControls";
import { SpatialActionButton } from "../spatial-interaction/SpatialActionButton";
import { SpatialViewButtons, SPATIAL_STANDARD_VIEWS } from "../spatial-interaction/SpatialViewButtons";
import { SpatialCanvasPanel } from "../spatial-interaction/SpatialWorkbenchControls";
import { useSpatialToolState } from "../spatial-interaction/useSpatialToolState";
import { useToolSnapshot } from "../scenes/useToolSnapshot";
import { useSceneCapture } from "../courseware/useSceneCapture";
import { boardTotal, createDefaultPlaceValueInitial, createPlaceValueBoard, placeValueInitial, placeValueSnapshot, placeValueSnapshotSchema,
  type PlaceValueAction, type PlaceValueInitial, type PlaceValueSide, type PlaceValueSnapshot } from "./contract";
import { applyPlaceValueChange, historyPlaceValue, isPlaceValueRegrouping, pausePlaceValue, placeValueCarry, placeValueFrame, placeValueGroup, placeValuePendingCarry, planPlaceValue, planPlaceValueCount, resumePlaceValue } from "./model";
import { PlaceValueStation } from "./PlaceValueStation";
import { usePlaceValuePresentation } from "./usePlaceValuePresentation";
import { placeValueMessages } from "./messages";
import styles from "../spatial-lab/CubeStructuresWorkbench.module.css";
import local from "./PlaceValueWorkspace.module.css";

const Viewport = dynamic(() => import("./PlaceValueCanvas").then((module) => module.PlaceValueCanvas), { ssr: false, loading: () => <Skeleton className="size-full" /> });
export interface PlaceValueWorkspaceProps {
  initial?: PlaceValueInitial; onSnapshot?: (initial: PlaceValueInitial | null) => void; readOnly?: boolean;
  classroom?: { state?: PlaceValueSnapshot; onChange?: (next: PlaceValueSnapshot) => Promise<void> };
}
export function PlaceValueWorkspace({ initial, onSnapshot, readOnly = false, classroom }: PlaceValueWorkspaceProps) {
  const locale = useLocale() === "en" ? "en" : "zh", m = placeValueMessages(locale);
  const origin = useMemo(() => placeValueSnapshot(initial ?? createDefaultPlaceValueInitial()), [initial]);
  const host = useToolSnapshot(origin, classroom), snapshot = host.snapshot, presentation = usePlaceValuePresentation(snapshot);
  const commandState = useMemo(() => presentation.progress === 1 && snapshot.motion
    ? { ...snapshot, motion: { ...snapshot.motion, progress: 1 } } : snapshot, [snapshot, presentation.progress]);
  const [preview, setPreview] = useState<number | null>(null);
  const viewer = readOnly || !!(classroom && !classroom.onChange), publishing = viewer || host.publishing;
  const regrouping = presentation.busy && isPlaceValueRegrouping(snapshot.motion?.kind), disabled = publishing || regrouping || preview !== null;
  const controls = useSpatialToolState<"orbit", "prepare" | "compare" | "inspect" | "settings">({
    defaultTool: "orbit", panels: { prepare: "orbit", compare: "orbit", inspect: "orbit", settings: "orbit" },
    onClearSelection: () => { if (!publishing && snapshot.selection) host.update({ ...snapshot, selection: null }); },
  });
  const axisSnap = useSpatialAxisSnap(), [notice, setNotice] = useState("");
  const [draft, setDraft] = useState("9"), [grouping, setGrouping] = useState<"normal" | "ones" | "tens">("normal");
  const active: PlaceValueSide = snapshot.mode === "single" ? "left" : snapshot.active, board = snapshot[active];
  const selected = controls.selectionActive && snapshot.selection?.side === active ? placeValueGroup(board, snapshot.selection.unit) : null;
  const carry = placeValueCarry(board);
  const quantityDisabled = disabled || !!placeValuePendingCarry(snapshot, active);
  const unpack = selected?.place === "hundreds" ? "unpack-hundred" : selected?.place === "tens" ? "unpack-ten" : board.tens.length ? "unpack-ten" : board.hundreds.length ? "unpack-hundred" : null;
  const update = host.update;
  const commit = useCallback((next: PlaceValueSnapshot) => {
    if (publishing) return false;
    const parsed = placeValueSnapshotSchema.safeParse(next);
    if (!parsed.success) { setNotice(m.failed); return false; }
    setNotice(""); return update(parsed.data);
  }, [publishing, update, m.failed]);
  const act = (action: PlaceValueAction, side = active) => {
    if (disabled) return;
    const next = planPlaceValue({ ...commandState, active: side }, action); if (next) commit(action.startsWith("unpack-") ? { ...next, autoCarry: false } : next);
  };
  const captureValue = useMemo(() => placeValueInitial(snapshot), [snapshot]);
  const capture = useSceneCapture(publishing || presentation.busy || preview !== null ? null : captureValue, onSnapshot);
  const autoKey = useRef("");
  useEffect(() => {
    if (disabled || presentation.busy || !snapshot.autoCarry || !carry || host.failed) return;
    const key = [snapshot.motion?.id, active, board.nextId, board.ones.length, board.tens.length].join(":");
    if (autoKey.current === key) return;
    const timer = window.setTimeout(() => {
      autoKey.current = key;
      const next = planPlaceValue(commandState, carry); if (next) commit(next);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [disabled, presentation.busy, snapshot, commandState, active, board, carry, host.failed, commit]);
  const configure = (patch: Partial<PlaceValueInitial>) => { if (!disabled) commit({ ...snapshot, ...patch, motion: null }); };
  const arrange = (value: number) => {
    if (quantityDisabled) return;
    if (!Number.isInteger(value) || value < 0 || value > 999) { setNotice(m.limit); return; }
    const next = applyPlaceValueChange(snapshot, { side: active, kind: "replace", before: board, after: createPlaceValueBoard(value, grouping) });
    next.motion = null; next.selection = null; next.frame = placeValueFrame(next); next.cameraRevision++;
    autoKey.current = "";
    commit(next); setDraft(String(value));
  };
  const setMode = (mode: PlaceValueInitial["mode"]) => {
    if (disabled) return;
    const next = { ...snapshot, mode, active: "left" as const, selection: null, motion: null };
    commit({ ...next, frame: placeValueFrame(next), cameraRevision: snapshot.cameraRevision + 1 });
  };
  const updateProgress = (progress: number) => {
    if (snapshot.motion) commit({ ...snapshot, motion: { ...snapshot.motion, progress, paused: true, startedAt: Date.now() } });
  };
  const toggleMotion = () => commit(presentation.playing ? pausePlaceValue(snapshot) : resumePlaceValue(snapshot));
  const actionLabel = snapshot.motion?.kind === "carry-one" || snapshot.motion?.kind === "unpack-ten" ? m.carryOne
    : snapshot.motion?.kind === "carry-ten" || snapshot.motion?.kind === "unpack-hundred" ? m.carryTen : "";
  return <section className={styles.workspace} data-workbench-mode="courseware" data-place-value-workspace="v1" aria-label={m.title} {...capture} {...controls.bindings}>
    <div className={styles.viewport}><div className={styles.canvas}>
      <Viewport snapshot={snapshot} progress={preview ?? presentation.progress} locale={locale} navigation={controls.tool} axisSnap={axisSnap} interactive={!viewer} selected={controls.selectionActive}
        onPointerMissed={controls.onPointerMissed} onSelect={(side, unit) => { if (!disabled) { controls.activateSelection(); commit({ ...snapshot, active: side, selection: { side, unit } }); } }}
        renderPlaceControl={(side, place) => <PlaceValueStation snapshot={snapshot} progress={preview ?? presentation.progress} side={side} place={place} locale={locale} disabled={disabled} publishing={publishing}
          onCountChange={(side, place, count) => { if (!disabled) { const next = planPlaceValueCount(commandState, side, place, count); if (next) commit(next); } }}
          onCarry={(side, place) => act(place === "ones" ? "carry-one" : "carry-ten", side)} onToggleMotion={toggleMotion}
          onHighlight={(place) => commit({ ...snapshot, highlight: snapshot.highlight === place ? "all" : place })} />} />
      <div className={styles.dock + " " + styles.meta}><SpatialActionButton action="settings" label={m.settings} active={controls.panel === "settings"} disabled={viewer} onClick={() => controls.togglePanel("settings")} /></div>
      <div className={styles.dock + " " + styles.views}>
        <SpatialViewButtons views={SPATIAL_STANDARD_VIEWS} value={snapshot.view} labels={m.views} disabled={publishing}
          onChange={(view) => commit({ ...snapshot, view, cameraRevision: snapshot.cameraRevision + 1 })}
          fit={{ label: m.fit, onClick: () => commit({ ...snapshot, frame: placeValueFrame(snapshot), cameraRevision: snapshot.cameraRevision + 1 }) }} />
        <SpatialAxisSnapButton messages={m} disabled={viewer} iconOnly className={styles.icon} />
      </div>
      <div className={styles.dock + " " + styles.tools} role="toolbar" aria-label={m.tools}>
        <SpatialActionButton action="orbit" label={m.orbit} active={controls.tool === "orbit"} disabled={viewer} onClick={() => controls.chooseTool("orbit")} />
        <span className={styles.toolSeparator} />
        <SpatialActionButton action="prepare" label={m.prepare} active={controls.panel === "prepare"} disabled={viewer} onClick={() => { setDraft(String(boardTotal(board))); controls.togglePanel("prepare"); }} />
        <SpatialActionButton action="compareScenes" label={m.compare} active={controls.panel === "compare"} disabled={viewer} onClick={() => controls.togglePanel("compare")} />
        <SpatialActionButton action="placeUnpack" label={unpack === "unpack-hundred" ? m.unpackHundred : unpack === "unpack-ten" ? m.unpackTen : m.unpack} disabled={quantityDisabled || !unpack} onClick={() => unpack && act(unpack)} />
        <SpatialActionButton action="observe" label={m.inspect} active={controls.panel === "inspect"} disabled={viewer} onClick={() => controls.togglePanel("inspect")} />
        <span className={styles.toolSeparator} />
        <SpatialActionButton action="showDigits" label={m.showDigits} active={snapshot.showDigits} disabled={publishing} onClick={() => commit({ ...snapshot, showDigits: !snapshot.showDigits })} />
        <SpatialActionButton action="undo" label={m.undo} disabled={disabled || !snapshot.past.length} onClick={() => { const next = historyPlaceValue(commandState, "undo"); if (next) commit({ ...next, autoCarry: false }); }} />
        <SpatialActionButton action="redo" label={m.redo} disabled={disabled || !snapshot.future.length} onClick={() => { const next = historyPlaceValue(commandState, "redo"); if (next) commit({ ...next, autoCarry: false }); }} />
        <SpatialActionButton action="reset" label={m.reset} disabled={publishing} onClick={() => { autoKey.current = ""; setPreview(null); commit({ ...structuredClone(origin), cameraRevision: snapshot.cameraRevision + 1 }); controls.closePanel(); }} />
      </div>
      {controls.panel && <SpatialCanvasPanel title={m[controls.panel]} closeLabel={m.close} anchor={controls.panel === "settings" ? "meta" : "tool"} onClose={controls.closePanel}>
        <div className="space-y-3 text-xs">
          {(controls.panel === "prepare" || controls.panel === "compare") && <>
            <div className="flex gap-1">{(["single", "compare"] as const).map((mode) => <Button key={mode} size="sm" variant={snapshot.mode === mode ? "secondary" : "ghost"} aria-pressed={snapshot.mode === mode} disabled={disabled} onClick={() => setMode(mode)}>{m[mode]}</Button>)}</div>
            {snapshot.mode === "compare" && <div className="flex gap-1">{(["left", "right"] as const).map((side) => <Button key={side} size="sm" variant={active === side ? "secondary" : "ghost"} aria-pressed={active === side} disabled={disabled} onClick={() => { configure({ active: side, selection: null }); setDraft(String(boardTotal(snapshot[side]))); }}>{m[side]} · {boardTotal(snapshot[side])}</Button>)}</div>}
            <Label className="flex items-center justify-between gap-2 text-xs">{m.value}<Input aria-label={m.value} type="number" min={0} max={999} step={1} className="h-8 w-24" disabled={quantityDisabled} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && draft.trim()) arrange(Number(draft)); }} /></Label>
            <div className="flex flex-wrap gap-1">{(["normal", "ones", "tens"] as const).map((kind) => <Button key={kind} size="sm" variant={grouping === kind ? "secondary" : "ghost"} aria-pressed={grouping === kind} disabled={quantityDisabled} onClick={() => setGrouping(kind)}>{kind === "normal" ? m.normalGrouping : kind === "ones" ? m.allOnes : m.allTens}</Button>)}</div>
            <Button size="sm" disabled={quantityDisabled || !draft.trim()} onClick={() => arrange(Number(draft))}>{m.apply}</Button>
            <div className="flex flex-wrap gap-1">{[0, 9, 19, 99, 100, 101, 110, 200].map((value) => <Button key={value} size="sm" variant="ghost" disabled={quantityDisabled} onClick={() => arrange(value)}>{value}</Button>)}</div>
            {controls.panel === "compare" && <>
              <div className="flex flex-wrap gap-1">{(["all", "hundreds", "tens", "ones"] as const).map((place) => <Button key={place} size="sm" variant={snapshot.highlight === place ? "secondary" : "ghost"} aria-pressed={snapshot.highlight === place} disabled={publishing} onClick={() => commit({ ...snapshot, highlight: place })}>{m[place]}</Button>)}</div>
              <Label className="text-xs">{m.comparison}</Label><div className="flex gap-1">{(["hidden", "<", "=", ">"] as const).map((symbol) => <Button key={symbol} size="sm" variant={snapshot.comparison === symbol ? "secondary" : "ghost"} aria-pressed={snapshot.comparison === symbol} disabled={publishing} onClick={() => commit({ ...snapshot, comparison: symbol })}>{symbol === "hidden" ? m.hidden : symbol}</Button>)}</div>
            </>}
          </>}
          {controls.panel === "inspect" && <>
            <p>{selected ? m.group + " " + selected.ids.length + " " + m.units : m.groupHint}</p>
            <Button size="sm" disabled={quantityDisabled || !unpack} onClick={() => unpack && act(unpack)}>{unpack === "unpack-hundred" ? m.unpackHundred : m.unpackTen}</Button>
            <p className="text-muted">{m.fullHint}</p>
            <p className="text-muted">{m.orientation}</p>
            <div className="flex gap-2">
              <SpatialActionButton action={presentation.playing ? "pause" : "play"} label={presentation.playing ? m.pause : m.resume} disabled={publishing || !regrouping} onClick={toggleMotion} />
              <SpatialActionButton action="nextStep" label={m.step} disabled={publishing || !regrouping} onClick={() => updateProgress(Math.min(1, presentation.progress + .1))} />
            </div>
            {snapshot.motion && <><Label className="text-xs">{m.progress}</Label><Slider aria-label={m.progress} min={0} max={1} step={.01} value={[preview ?? presentation.progress]} disabled={publishing} onValueChange={([value]) => setPreview(value)} onValueCommit={([value]) => { updateProgress(value); setPreview(null); }} onPointerCancel={() => setPreview(null)} /></>}
          </>}
          {controls.panel === "settings" && <>
            {(["autoCarry", "showDigits", "showLabels", "axes"] as const).map((key) => <Label key={key} className="flex items-center gap-2 text-xs"><Checkbox checked={snapshot[key]} disabled={publishing} onCheckedChange={(value) => commit({ ...snapshot, [key]: value === true })} />{m[key]}</Label>)}
            <Label className="text-xs">{m.speed}</Label><div className="flex gap-1">{(["slow", "normal", "fast"] as const).map((speed) => <Button key={speed} size="sm" variant={snapshot.speed === speed ? "secondary" : "ghost"} aria-pressed={snapshot.speed === speed} disabled={disabled} onClick={() => configure({ speed })}>{m[speed]}</Button>)}</div>
            <Button size="sm" variant="ghost" disabled={quantityDisabled} onClick={() => { if (!quantityDisabled) commit(applyPlaceValueChange(snapshot, { side: active, kind: "replace", before: board, after: createPlaceValueBoard(0) })); }}>{m.clear}</Button>
          </>}
        </div>
      </SpatialCanvasPanel>}
      {regrouping && <div className={local.status} role="status"><span>{(presentation.playing ? m.moving : m.paused) + (actionLabel ? " · " + actionLabel : "")}</span></div>}
      {(host.failed || notice) && <p className={styles.notice} role="alert">{host.failed ? m.failed : notice}</p>}
    </div></div>
  </section>;
}
