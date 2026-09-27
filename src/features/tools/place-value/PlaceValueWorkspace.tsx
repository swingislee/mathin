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
import { boardTotal, createDefaultPlaceValueInitial, createPlaceValueBoard, formatPlaceValue, groupSize, parsePlaceValue, PLACE_VALUE_BASES, PLACE_VALUE_MAX_DIGITS, placeValueInitial, placeValueLimit, placeValueSnapshot, placeValueSnapshotSchema,
  type PlaceValueAction, type PlaceValueInitial, type PlaceValueSide, type PlaceValueSnapshot } from "./radix-contract";
import { applyPlaceValueChange, configurePlaceValue, historyPlaceValue, isPlaceValueRegrouping, pausePlaceValue, placeValueCarry, placeValueFrame, placeValueGroup, placeValuePendingCarry, placeValuePlaces, planPlaceValue, planPlaceValueCount, resumePlaceValue } from "./radix-model";
import { PlaceValueCarryControl, PlaceValueStation, type PlaceValueStationProps } from "./PlaceValueStation";
import { usePlaceValuePresentation } from "./usePlaceValuePresentation";
import { placeValueCarryLabel, placeValueLabel, placeValueMessages } from "./messages";
import styles from "../spatial-lab/CubeStructuresWorkbench.module.css";
import local from "./PlaceValueWorkspace.module.css";

const Viewport = dynamic(() => import("./PlaceValueCanvas").then((module) => module.PlaceValueCanvas), { ssr: false, loading: () => <Skeleton className="size-full" /> });
export interface PlaceValueWorkspaceProps {
  initial?: PlaceValueInitial; onSnapshot?: (initial: PlaceValueInitial | null) => void; readOnly?: boolean; legacy?: boolean;
  classroom?: { state?: PlaceValueSnapshot; onChange?: (next: PlaceValueSnapshot) => Promise<void> };
}
export function PlaceValueWorkspace({ initial, onSnapshot, readOnly = false, classroom, legacy = false }: PlaceValueWorkspaceProps) {
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
  const base = board.radix, digits = board.places.length, limit = placeValueLimit(base, digits);
  const selected = controls.selectionActive && snapshot.selection?.side === active ? placeValueGroup(board, snapshot.selection.unit) : null;
  const carry = placeValueCarry(board);
  const quantityDisabled = disabled || placeValuePendingCarry(snapshot, active) !== null;
  const unpack = selected && selected.level > 0 ? selected.level : board.places.findIndex((groups, level) => level > 0 && groups.length > 0);
  const unpackLabel = unpack > 0 ? placeValueCarryLabel(locale, unpack - 1, base, true) : m.unpack;
  const update = host.update;
  const commit = useCallback((next: PlaceValueSnapshot) => {
    if (publishing) return false;
    const parsed = placeValueSnapshotSchema.safeParse(next);
    if (!parsed.success) { setNotice(m.failed); return false; }
    setNotice(""); return update(parsed.data);
  }, [publishing, update, m.failed]);
  const act = (action: PlaceValueAction, side = active, level = 0) => {
    if (disabled) return;
    const next = planPlaceValue({ ...commandState, active: side }, action, undefined, level); if (next) commit(action === "unpack" ? { ...next, autoCarry: false } : next);
  };
  const captureValue = useMemo(() => placeValueInitial(snapshot), [snapshot]);
  const capture = useSceneCapture(publishing || presentation.busy || preview !== null ? null : captureValue, onSnapshot);
  const autoKey = useRef("");
  useEffect(() => {
    if (disabled || presentation.busy || !snapshot.autoCarry || carry === null || host.failed) return;
    const key = [snapshot.motion?.id, active, board.nextId, ...board.places.map((groups) => groups.length)].join(":");
    if (autoKey.current === key) return;
    const timer = window.setTimeout(() => {
      autoKey.current = key;
      const next = planPlaceValue(commandState, "carry", Date.now(), carry); if (next) commit(next);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [disabled, presentation.busy, snapshot, commandState, active, board, carry, host.failed, commit]);
  const configure = (patch: Partial<PlaceValueInitial>) => { if (!disabled) commit({ ...snapshot, ...patch, motion: null }); };
  const arrange = (value: number) => {
    if (quantityDisabled) return;
    if (!Number.isInteger(value) || value < 0 || value > limit) { setNotice(m.capacityError); return; }
    let after;
    try { after = createPlaceValueBoard(value, grouping, base, digits); } catch { setNotice(m.groupsError); return; }
    const next = applyPlaceValueChange(snapshot, { side: active, kind: "replace", level: 0, before: board, after });
    next.motion = null; next.selection = null; next.frame = placeValueFrame(next); next.cameraRevision++;
    autoKey.current = "";
    commit(next); setDraft(formatPlaceValue(value, base));
  };
  const arrangeDraft = () => { const value = parsePlaceValue(draft, base); if (value === null) setNotice(m.capacityError); else arrange(value); };
  const setNumeration = (radix: number, places: number) => {
    if (disabled || legacy) return;
    const next = configurePlaceValue(commandState, radix, places);
    if (!next) { setNotice(m.capacityError); return; }
    if (commit(next)) { setDraft(formatPlaceValue(boardTotal(board), radix)); autoKey.current = ""; }
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
  const actionLabel = snapshot.motion && isPlaceValueRegrouping(snapshot.motion.kind) ? placeValueCarryLabel(locale, snapshot.motion.level - (snapshot.motion.kind === "unpack" ? 1 : 0), base, snapshot.motion.kind === "unpack") : "";
  const stationProps = (side: PlaceValueSide, place: number): PlaceValueStationProps => ({ snapshot, progress: preview ?? presentation.progress, side, place, locale, disabled, publishing,
    onCountChange: (side, place, count) => { if (!disabled) { const next = planPlaceValueCount(commandState, side, place, count); if (next) commit(next); } },
    onCarry: (side, place) => act("carry", side, place),
    onHighlight: (place) => commit({ ...snapshot, highlight: snapshot.highlight === place ? "all" : place }) });
  return <section className={styles.workspace} data-workbench-mode="courseware" data-place-value-workspace="v2" aria-label={m.title} {...capture} {...controls.bindings}>
    <div className={styles.viewport}><div className={styles.canvas}>
      <Viewport snapshot={snapshot} progress={preview ?? presentation.progress} locale={locale} navigation={controls.tool} axisSnap={axisSnap} interactive={!viewer} selected={controls.selectionActive}
        onPointerMissed={controls.onPointerMissed} onSelect={(side, unit) => { if (!disabled) { controls.activateSelection(); commit({ ...snapshot, active: side, selection: { side, unit } }); } }}
        renderPlaceControl={(side, place) => <PlaceValueStation {...stationProps(side, place)} />}
        renderCarryControl={(side, place) => <PlaceValueCarryControl {...stationProps(side, place)} />} />
      <div className={styles.dock + " " + styles.views}>
        <SpatialViewButtons views={SPATIAL_STANDARD_VIEWS} value={snapshot.view} labels={m.views} disabled={publishing}
          onChange={(view) => commit({ ...snapshot, view, cameraRevision: snapshot.cameraRevision + 1 })}
          fit={{ label: m.fit, onClick: () => commit({ ...snapshot, frame: placeValueFrame(snapshot), cameraRevision: snapshot.cameraRevision + 1 }) }} />
        <SpatialAxisSnapButton messages={m} disabled={viewer} iconOnly className={styles.icon} />
      </div>
      <div className={styles.dock + " " + styles.tools} role="toolbar" aria-label={m.tools}>
        <SpatialActionButton action="orbit" label={m.orbit} active={controls.tool === "orbit"} disabled={viewer} onClick={() => controls.chooseTool("orbit")} />
        <span className={styles.toolSeparator} />
        <SpatialActionButton action="prepare" label={m.prepare} active={controls.panel === "prepare"} disabled={viewer} onClick={() => { setDraft(formatPlaceValue(boardTotal(board), base)); controls.togglePanel("prepare"); }} />
        <SpatialActionButton action="compareScenes" label={m.compare} active={controls.panel === "compare"} disabled={viewer} onClick={() => controls.togglePanel("compare")} />
        <SpatialActionButton action="placeUnpack" label={unpackLabel} disabled={quantityDisabled || unpack < 1} onClick={() => unpack > 0 && act("unpack", active, unpack)} />
        <SpatialActionButton action="observe" label={m.inspect} active={controls.panel === "inspect"} disabled={viewer} onClick={() => controls.togglePanel("inspect")} />
        <span className={styles.toolSeparator} />
        <SpatialActionButton action="showDigits" label={m.showDigits} active={snapshot.showDigits} disabled={publishing} onClick={() => commit({ ...snapshot, showDigits: !snapshot.showDigits })} />
        <SpatialActionButton action="settings" label={m.settings} active={controls.panel === "settings"} disabled={viewer} onClick={() => controls.togglePanel("settings")} />
        <SpatialActionButton action="undo" label={m.undo} disabled={disabled || !snapshot.past.length} onClick={() => { const next = historyPlaceValue(commandState, "undo"); if (next) commit({ ...next, autoCarry: false }); }} />
        <SpatialActionButton action="redo" label={m.redo} disabled={disabled || !snapshot.future.length} onClick={() => { const next = historyPlaceValue(commandState, "redo"); if (next) commit({ ...next, autoCarry: false }); }} />
        <SpatialActionButton action="reset" label={m.reset} disabled={publishing} onClick={() => { autoKey.current = ""; setPreview(null); commit({ ...structuredClone(origin), cameraRevision: snapshot.cameraRevision + 1 }); controls.closePanel(); }} />
      </div>
      {controls.panel && <SpatialCanvasPanel title={m[controls.panel]} closeLabel={m.close} anchor="tool" onClose={controls.closePanel}>
        <div className="space-y-3 text-xs">
          {(controls.panel === "prepare" || controls.panel === "compare") && <>
            <div className="flex gap-1">{(["single", "compare"] as const).map((mode) => <Button key={mode} size="sm" variant={snapshot.mode === mode ? "secondary" : "ghost"} aria-pressed={snapshot.mode === mode} disabled={disabled} onClick={() => setMode(mode)}>{m[mode]}</Button>)}</div>
            {snapshot.mode === "compare" && <div className="flex gap-1">{(["left", "right"] as const).map((side) => <Button key={side} size="sm" variant={active === side ? "secondary" : "ghost"} aria-pressed={active === side} disabled={disabled} onClick={() => { configure({ active: side, selection: null }); setDraft(formatPlaceValue(boardTotal(snapshot[side]), base)); }}>{m[side]} · {formatPlaceValue(boardTotal(snapshot[side]), base)}<sub>{base}</sub></Button>)}</div>}
            <Label className="flex items-center justify-between gap-2 text-xs">{m.value} ({base})<Input aria-label={m.value} type="text" inputMode={base === 16 ? "text" : "numeric"} maxLength={digits} className="h-8 w-28" disabled={quantityDisabled} value={draft} onChange={(event) => setDraft(event.target.value.toUpperCase())} onKeyDown={(event) => { if (event.key === "Enter") arrangeDraft(); }} /></Label>
            <div className="text-muted">0–{formatPlaceValue(limit, base)}<sub>{base}</sub></div>
            <div className="flex flex-wrap gap-1">{(["normal", "ones", "tens"] as const).map((kind) => <Button key={kind} size="sm" variant={grouping === kind ? "secondary" : "ghost"} aria-pressed={grouping === kind} disabled={quantityDisabled} onClick={() => setGrouping(kind)}>{kind === "normal" ? m.normalGrouping : kind === "ones" ? m.allOnes : base === 10 ? m.allTens : placeValueLabel(locale, 1, base)}</Button>)}</div>
            <Button size="sm" disabled={quantityDisabled || !draft.trim()} onClick={arrangeDraft}>{m.apply}</Button>
            <div className="flex flex-wrap gap-1">{[0, base - 1, base * 2 - 1, base ** 2 - 1, base ** 2, base ** 2 + 1, base ** 2 + base, base ** 2 * 2].filter((value, i, values) => value <= limit && values.indexOf(value) === i).map((value) => <Button key={value} size="sm" variant="ghost" disabled={quantityDisabled} onClick={() => arrange(value)}>{formatPlaceValue(value, base)}</Button>)}</div>
            {controls.panel === "compare" && <>
              <div className="flex flex-wrap gap-1">{(["all", ...placeValuePlaces(digits)] as const).map((place) => <Button key={place} size="sm" variant={snapshot.highlight === place ? "secondary" : "ghost"} aria-pressed={snapshot.highlight === place} disabled={publishing} onClick={() => commit({ ...snapshot, highlight: place })}>{place === "all" ? m.all : placeValueLabel(locale, place, base)}</Button>)}</div>
              <Label className="text-xs">{m.comparison}</Label><div className="flex gap-1">{(["hidden", "<", "=", ">"] as const).map((symbol) => <Button key={symbol} size="sm" variant={snapshot.comparison === symbol ? "secondary" : "ghost"} aria-pressed={snapshot.comparison === symbol} disabled={publishing} onClick={() => commit({ ...snapshot, comparison: symbol })}>{symbol === "hidden" ? m.hidden : symbol}</Button>)}</div>
            </>}
          </>}
          {controls.panel === "inspect" && <>
            <p>{selected ? m.group + " " + groupSize(selected.group) + " " + m.units : m.groupHint}</p>
            <Button size="sm" disabled={quantityDisabled || unpack < 1} onClick={() => unpack > 0 && act("unpack", active, unpack)}>{unpackLabel}</Button>
            <p className="text-muted">{m.fullHint}</p>
            <p className="text-muted">{m.orientation}</p>
            <div className="flex gap-2">
              <SpatialActionButton action={presentation.playing ? "pause" : "play"} label={presentation.playing ? m.pause : m.resume} disabled={publishing || !regrouping} onClick={toggleMotion} />
              <SpatialActionButton action="nextStep" label={m.step} disabled={publishing || !regrouping} onClick={() => updateProgress(Math.min(1, presentation.progress + .1))} />
            </div>
            {snapshot.motion && <><Label className="text-xs">{m.progress}</Label><Slider aria-label={m.progress} min={0} max={1} step={.01} value={[preview ?? presentation.progress]} disabled={publishing} onValueChange={([value]) => setPreview(value)} onValueCommit={([value]) => { updateProgress(value); setPreview(null); }} onPointerCancel={() => setPreview(null)} /></>}
          </>}
          {controls.panel === "settings" && <>
            {legacy ? <p className="text-muted">{m.legacyNote}</p> : <>
              <Label className="text-xs">{m.radix}</Label><div className="flex flex-wrap gap-1">{PLACE_VALUE_BASES.map((radix) => <Button key={radix} size="sm" variant={base === radix ? "secondary" : "ghost"} aria-label={m.radix + " " + radix} aria-pressed={base === radix}
                disabled={disabled || ["left", "right"].some((side) => placeValuePendingCarry(snapshot, side as PlaceValueSide) !== null)}
                onClick={() => setNumeration(radix, Math.max(digits, Math.min(PLACE_VALUE_MAX_DIGITS, Math.ceil(Math.log(Math.max(boardTotal(snapshot.left), boardTotal(snapshot.right)) + 1) / Math.log(radix)))))}>{radix}</Button>)}</div>
              <Label className="text-xs">{m.places}</Label><div className="flex gap-1">{[3, 4, 5, 6].map((places) => <Button key={places} size="sm" variant={digits === places ? "secondary" : "ghost"} aria-label={m.places + " " + places} aria-pressed={digits === places} disabled={quantityDisabled} onClick={() => setNumeration(base, places)}>{places}</Button>)}</div>
              <p className="text-muted">{m.baseNote}</p>
            </>}
            {(["autoCarry", "showDigits", "showLabels", "axes"] as const).map((key) => <Label key={key} className="flex items-center gap-2 text-xs"><Checkbox checked={snapshot[key]} disabled={publishing} onCheckedChange={(value) => commit({ ...snapshot, [key]: value === true })} />{m[key]}</Label>)}
            <Label className="text-xs">{m.speed}</Label><div className="flex gap-1">{(["slow", "normal", "fast"] as const).map((speed) => <Button key={speed} size="sm" variant={snapshot.speed === speed ? "secondary" : "ghost"} aria-pressed={snapshot.speed === speed} disabled={disabled} onClick={() => configure({ speed })}>{m[speed]}</Button>)}</div>
            <Button size="sm" variant="ghost" disabled={quantityDisabled} onClick={() => { if (!quantityDisabled) commit(applyPlaceValueChange(snapshot, { side: active, kind: "replace", level: 0, before: board, after: createPlaceValueBoard(0, "normal", base, digits) })); }}>{m.clear}</Button>
          </>}
        </div>
      </SpatialCanvasPanel>}
      {regrouping && <div className={local.status} role="status"><span>{(presentation.playing ? m.moving : m.paused) + (actionLabel ? " · " + actionLabel : "")}</span></div>}
      {(host.failed || notice) && <p className={styles.notice} role="alert">{host.failed ? m.failed : notice}</p>}
    </div></div>
  </section>;
}
