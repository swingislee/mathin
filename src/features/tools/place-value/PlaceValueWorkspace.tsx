"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
import { applyPlaceValueChange, historyPlaceValue, pausePlaceValue, placeValueCarry, placeValueFrame, placeValueGroup, planPlaceValue, resumePlaceValue } from "./model";
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
  const [preview, setPreview] = useState<number | null>(null);
  const viewer = readOnly || !!(classroom && !classroom.onChange), publishing = viewer || host.publishing, disabled = publishing || presentation.busy || preview !== null;
  const controls = useSpatialToolState<"orbit" | "pan", "prepare" | "compare" | "inspect" | "settings">({
    defaultTool: "orbit", panels: { prepare: "orbit", compare: "orbit", inspect: "orbit", settings: "orbit" },
    onClearSelection: () => { if (!publishing && snapshot.selection) host.update({ ...snapshot, selection: null }); },
  });
  const axisSnap = useSpatialAxisSnap(), [notice, setNotice] = useState("");
  const [draft, setDraft] = useState("9"), [grouping, setGrouping] = useState<"normal" | "ones" | "tens">("normal");
  const active: PlaceValueSide = snapshot.mode === "single" ? "left" : snapshot.active, board = snapshot[active];
  const selected = controls.selectionActive && snapshot.selection?.side === active ? placeValueGroup(board, snapshot.selection.unit) : null;
  const carry = placeValueCarry(board);
  const unpack = selected?.place === "hundreds" ? "unpack-hundred" : selected?.place === "tens" ? "unpack-ten" : board.tens.length ? "unpack-ten" : board.hundreds.length ? "unpack-hundred" : null;
  const update = host.update;
  const commit = useCallback((next: PlaceValueSnapshot) => {
    if (publishing) return false;
    const parsed = placeValueSnapshotSchema.safeParse(next);
    if (!parsed.success) { setNotice(m.failed); return false; }
    setNotice(""); return update(parsed.data);
  }, [publishing, update, m.failed]);
  const act = (action: PlaceValueAction) => {
    if (disabled) return;
    const next = planPlaceValue(snapshot, action); if (next) commit(action.startsWith("unpack-") ? { ...next, autoCarry: false } : next);
  };
  const captureValue = useMemo(() => placeValueInitial(snapshot), [snapshot]);
  const capture = useSceneCapture(publishing || presentation.busy || preview !== null ? null : captureValue, onSnapshot);
  const autoKey = useRef("");
  useEffect(() => {
    if (disabled || !snapshot.autoCarry || !carry || host.failed) return;
    const key = [snapshot.motion?.id, active, board.nextId, board.ones.length, board.tens.length].join(":");
    if (autoKey.current === key) return;
    const timer = window.setTimeout(() => {
      autoKey.current = key;
      const next = planPlaceValue(snapshot, carry); if (next) commit(next);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [disabled, snapshot, active, board, carry, host.failed, commit]);
  const configure = (patch: Partial<PlaceValueInitial>) => { if (!disabled) commit({ ...snapshot, ...patch, motion: null }); };
  const arrange = (value: number) => {
    if (disabled) return;
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
  const actionLabel = snapshot.motion?.kind === "carry-one" || snapshot.motion?.kind === "unpack-ten" ? m.carryOne
    : snapshot.motion?.kind === "carry-ten" || snapshot.motion?.kind === "unpack-hundred" ? m.carryTen : "";
  return <section className={styles.workspace} data-workbench-mode="courseware" data-place-value-workspace="v1" aria-label={m.title} {...capture} {...controls.bindings}>
    <div className={styles.viewport}><div className={styles.canvas} style={{ "--cube-dock-bottom": snapshot.showDigits ? "82px" : "8px" } as CSSProperties}>
      <Viewport snapshot={snapshot} progress={preview ?? presentation.progress} locale={locale} navigation={controls.tool} axisSnap={axisSnap} interactive={!viewer} selected={controls.selectionActive}
        onPointerMissed={controls.onPointerMissed} onSelect={(side, unit) => { if (!disabled) { controls.activateSelection(); commit({ ...snapshot, active: side, selection: { side, unit } }); } }} />
      <div className={styles.dock + " " + styles.meta}><SpatialActionButton action="settings" label={m.settings} active={controls.panel === "settings"} disabled={viewer} onClick={() => controls.togglePanel("settings")} /></div>
      <div className={styles.dock + " " + styles.views}>
        <SpatialViewButtons views={SPATIAL_STANDARD_VIEWS} value={snapshot.view} labels={m.views} disabled={publishing}
          onChange={(view) => commit({ ...snapshot, view, cameraRevision: snapshot.cameraRevision + 1 })}
          fit={{ label: m.fit, onClick: () => commit({ ...snapshot, frame: placeValueFrame(snapshot), cameraRevision: snapshot.cameraRevision + 1 }) }} />
        <SpatialAxisSnapButton messages={m} disabled={viewer} iconOnly className={styles.icon} />
      </div>
      <div className={styles.dock + " " + styles.tools} role="toolbar" aria-label={m.tools}>
        <SpatialActionButton action="orbit" label={m.orbit} active={controls.tool === "orbit"} disabled={viewer} onClick={() => controls.chooseTool("orbit")} />
        <SpatialActionButton action="pan" label={m.pan} active={controls.tool === "pan"} disabled={viewer} onClick={() => controls.chooseTool("pan")} />
        <span className={styles.toolSeparator} />
        <SpatialActionButton action="prepare" label={m.prepare} active={controls.panel === "prepare"} disabled={viewer} onClick={() => { setDraft(String(boardTotal(board))); controls.togglePanel("prepare"); }} />
        <SpatialActionButton action="compareScenes" label={m.compare} active={controls.panel === "compare"} disabled={viewer} onClick={() => controls.togglePanel("compare")} />
        <SpatialActionButton action="add" label={m.add} disabled={disabled || boardTotal(board) >= 999} onClick={() => act("add")} />
        <SpatialActionButton action="decrease" label={m.remove} disabled={disabled || !boardTotal(board)} onClick={() => board.ones.length ? act("remove") : setNotice(m.needUnpack)} />
        <SpatialActionButton action="placeCarry" label={carry === "carry-one" ? m.carryOne : carry === "carry-ten" ? m.carryTen : m.carry} disabled={disabled || !carry} onClick={() => carry && act(carry)} />
        <SpatialActionButton action="placeUnpack" label={unpack === "unpack-hundred" ? m.unpackHundred : unpack === "unpack-ten" ? m.unpackTen : m.unpack} disabled={disabled || !unpack} onClick={() => unpack && act(unpack)} />
        <SpatialActionButton action="observe" label={m.inspect} active={controls.panel === "inspect"} disabled={viewer} onClick={() => controls.togglePanel("inspect")} />
        {presentation.busy && <>
          <SpatialActionButton action={presentation.playing ? "pause" : "play"} label={presentation.playing ? m.pause : m.resume} disabled={publishing} onClick={() => commit(presentation.playing ? pausePlaceValue(snapshot) : resumePlaceValue(snapshot))} />
          <SpatialActionButton action="nextStep" label={m.step} disabled={publishing} onClick={() => updateProgress(Math.min(1, presentation.progress + .1))} />
        </>}
        <span className={styles.toolSeparator} />
        <SpatialActionButton action="showDigits" label={m.showDigits} active={snapshot.showDigits} disabled={publishing} onClick={() => commit({ ...snapshot, showDigits: !snapshot.showDigits })} />
        <SpatialActionButton action="undo" label={m.undo} disabled={disabled || !snapshot.past.length} onClick={() => { const next = historyPlaceValue(snapshot, "undo"); if (next) commit({ ...next, autoCarry: false }); }} />
        <SpatialActionButton action="redo" label={m.redo} disabled={disabled || !snapshot.future.length} onClick={() => { const next = historyPlaceValue(snapshot, "redo"); if (next) commit({ ...next, autoCarry: false }); }} />
        <SpatialActionButton action="reset" label={m.reset} disabled={publishing} onClick={() => { autoKey.current = ""; setPreview(null); commit({ ...structuredClone(origin), cameraRevision: snapshot.cameraRevision + 1 }); controls.closePanel(); }} />
      </div>
      {controls.panel && <SpatialCanvasPanel title={m[controls.panel]} closeLabel={m.close} anchor={controls.panel === "settings" ? "meta" : "tool"} onClose={controls.closePanel}>
        <div className="space-y-3 text-xs">
          {(controls.panel === "prepare" || controls.panel === "compare") && <>
            <div className="flex gap-1">{(["single", "compare"] as const).map((mode) => <Button key={mode} size="sm" variant={snapshot.mode === mode ? "secondary" : "ghost"} aria-pressed={snapshot.mode === mode} disabled={disabled} onClick={() => setMode(mode)}>{m[mode]}</Button>)}</div>
            {snapshot.mode === "compare" && <div className="flex gap-1">{(["left", "right"] as const).map((side) => <Button key={side} size="sm" variant={active === side ? "secondary" : "ghost"} aria-pressed={active === side} disabled={disabled} onClick={() => { configure({ active: side, selection: null }); setDraft(String(boardTotal(snapshot[side]))); }}>{m[side]} · {boardTotal(snapshot[side])}</Button>)}</div>}
            <Label className="flex items-center justify-between gap-2 text-xs">{m.value}<Input aria-label={m.value} type="number" min={0} max={999} step={1} className="h-8 w-24" disabled={disabled} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && draft.trim()) arrange(Number(draft)); }} /></Label>
            <div className="flex flex-wrap gap-1">{(["normal", "ones", "tens"] as const).map((kind) => <Button key={kind} size="sm" variant={grouping === kind ? "secondary" : "ghost"} aria-pressed={grouping === kind} disabled={disabled} onClick={() => setGrouping(kind)}>{kind === "normal" ? m.normalGrouping : kind === "ones" ? m.allOnes : m.allTens}</Button>)}</div>
            <Button size="sm" disabled={disabled || !draft.trim()} onClick={() => arrange(Number(draft))}>{m.apply}</Button>
            <div className="flex flex-wrap gap-1">{[0, 9, 19, 99, 100, 101, 110, 200].map((value) => <Button key={value} size="sm" variant="ghost" disabled={disabled} onClick={() => arrange(value)}>{value}</Button>)}</div>
            {controls.panel === "compare" && <>
              <div className="flex flex-wrap gap-1">{(["all", "hundreds", "tens", "ones"] as const).map((place) => <Button key={place} size="sm" variant={snapshot.highlight === place ? "secondary" : "ghost"} aria-pressed={snapshot.highlight === place} disabled={publishing} onClick={() => commit({ ...snapshot, highlight: place })}>{m[place]}</Button>)}</div>
              <Label className="text-xs">{m.comparison}</Label><div className="flex gap-1">{(["hidden", "<", "=", ">"] as const).map((symbol) => <Button key={symbol} size="sm" variant={snapshot.comparison === symbol ? "secondary" : "ghost"} aria-pressed={snapshot.comparison === symbol} disabled={publishing} onClick={() => commit({ ...snapshot, comparison: symbol })}>{symbol === "hidden" ? m.hidden : symbol}</Button>)}</div>
            </>}
          </>}
          {controls.panel === "inspect" && <>
            <p>{selected ? m.group + " " + selected.ids.length + " " + m.units : m.groupHint}</p>
            <Button size="sm" disabled={disabled || !unpack} onClick={() => unpack && act(unpack)}>{unpack === "unpack-hundred" ? m.unpackHundred : m.unpackTen}</Button>
            <p className="text-muted">{m.fullHint}</p>
            {snapshot.motion && <><Label className="text-xs">{m.progress}</Label><Slider aria-label={m.progress} min={0} max={1} step={.01} value={[preview ?? presentation.progress]} disabled={publishing} onValueChange={([value]) => setPreview(value)} onValueCommit={([value]) => { updateProgress(value); setPreview(null); }} onPointerCancel={() => setPreview(null)} /></>}
          </>}
          {controls.panel === "settings" && <>
            {(["autoCarry", "showDigits", "showLabels", "grid", "axes"] as const).map((key) => <Label key={key} className="flex items-center gap-2 text-xs"><Checkbox checked={snapshot[key]} disabled={publishing} onCheckedChange={(value) => commit({ ...snapshot, [key]: value === true })} />{m[key]}</Label>)}
            <Label className="text-xs">{m.speed}</Label><div className="flex gap-1">{(["slow", "normal", "fast"] as const).map((speed) => <Button key={speed} size="sm" variant={snapshot.speed === speed ? "secondary" : "ghost"} aria-pressed={snapshot.speed === speed} disabled={disabled} onClick={() => configure({ speed })}>{m[speed]}</Button>)}</div>
            <Button size="sm" variant="ghost" disabled={disabled} onClick={() => commit(applyPlaceValueChange(snapshot, { side: active, kind: "replace", before: board, after: createPlaceValueBoard(0) }))}>{m.clear}</Button>
          </>}
        </div>
      </SpatialCanvasPanel>}
      {(presentation.busy || (carry && !snapshot.showLabels)) && <div className={local.status} role="status"><span>{presentation.busy ? (presentation.playing ? m.moving : m.paused) + (actionLabel ? " · " + actionLabel : "") : carry === "carry-one" ? m.pendingOnes(board.ones.length) : m.pendingTens(board.tens.length)}</span></div>}
      {snapshot.showDigits && <div className={local.readouts} data-place-value-digits>
        {(snapshot.mode === "compare" ? ["left", "right"] as const : ["left"] as const).map((side, index) => {
          const value = boardTotal(snapshot[side]);
          return <div key={side} className="flex items-center gap-3">
            {index === 1 && snapshot.comparison !== "hidden" && <span className="text-xl">{snapshot.comparison}</span>}
            <div className={local.number + (side === active ? " " + local.active : "")}>
              <span className={local.caption}>{snapshot.mode === "compare" ? m[side] + " · " : ""}{m.notation} · {value}</span>
              {(["hundreds", "tens", "ones"] as const).map((place) => snapshot.mode === "compare"
                ? <Button key={place} type="button" variant="ghost" className="pointer-events-auto h-auto min-w-0 p-0 text-xs" aria-pressed={snapshot.highlight === place} disabled={publishing}
                  onClick={() => commit({ ...snapshot, highlight: snapshot.highlight === place ? "all" : place })}>{m[place]}</Button>
                : <span key={place}>{m[place]}</span>)}
              {[Math.floor(value / 100), Math.floor(value / 10) % 10, value % 10].map((digit, position) => <span key={position} className={local.digit}>{digit}</span>)}
            </div>
          </div>;
        })}
      </div>}
      {(host.failed || notice) && <p className={styles.notice} role="alert">{host.failed ? m.failed : notice}</p>}
    </div></div>
  </section>;
}
