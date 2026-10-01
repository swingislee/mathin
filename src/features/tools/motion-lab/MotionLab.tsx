"use client";

import { CircleHelp, LocateFixed, Minus, Pause, Play, Plus, RotateCcw, Ruler, Timer } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ToolComponentProps } from "../types";
import { SpatialIconButton } from "../spatial-interaction/SpatialWorkbenchControls";
import { ApplyField, EditableNumber } from "./NumField";
import { RunwayLane } from "./RunwayLane";
import { RulerOverlay } from "./RulerOverlay";
import { DEFAULT_HEAD, DEFAULT_VEHICLE, MAX_RUNWAYS, PANEL_W, POST_PAD, VEHICLE_SPEEDS, editField, fmt, recompute, type Runway, type SolveKey } from "./shared";
import { initialMotionScene, motionFrame, type MotionScene } from "../courseware/numeric-teaching-content";
import { useSceneCapture } from "../courseware/useSceneCapture";

function makeRunway(id: number): Runway {
  return { id, head: DEFAULT_HEAD, vehicle: DEFAULT_VEHICLE, facingRight: true, x: 0, solve: "speed", distance: 100, time: 10, speed: 10 };
}

export function MotionLab({ embedded, initial, onSnapshot, readOnly = false, preparation = false }: ToolComponentProps & {
  initial?: MotionScene; onSnapshot?: (snapshot: MotionScene | null) => void; readOnly?: boolean; preparation?: boolean;
}) {
  const t = useTranslations("tools.motion");
  const [scene, setScene] = useState(() => initial ?? initialMotionScene());
  const [now, setNow] = useState(() => Date.now());
  const { length, showRuler, allTime, allSpeed } = scene;
  const { runways, phase, clock } = motionFrame(scene, now);
  const setRunways = (update: SetStateAction<Runway[]>) => setScene((current) => ({ ...current,
    runways: typeof update === "function" ? update(motionFrame(current, Date.now()).runways) : update,
    playback: { phase: "idle", elapsedMs: 0, startedAt: 0 } }));
  const setLength = (value: number) => setScene((current) => ({ ...current, length: value }));
  const setShowRuler = (value: boolean) => setScene((current) => ({ ...current, showRuler: value }));
  const setAllTime = (value: number) => setScene((current) => ({ ...current, allTime: value }));
  const setAllSpeed = (value: number) => setScene((current) => ({ ...current, allSpeed: value }));
  // 备课保存停下后的可见现场；课堂则保存时间锚点，展示端自行连续绘制。
  const captured = useMemo(() => preparation && scene.playback.phase !== "idle"
    ? null : scene, [preparation, scene]);
  const capture = useSceneCapture(captured, onSnapshot);
  const [trackW, setTrackW] = useState(640);
  const trackRef = useRef<HTMLDivElement>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setTrackW(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ppm = Math.max(0.0001, (trackW - POST_PAD * 2) / length);

  const patchRunway = (id: number, patch: Partial<Runway>, solveAgain = false) =>
    setRunways((prev) => prev.map((r) => (r.id === id ? (solveAgain ? recompute({ ...r, ...patch }) : { ...r, ...patch }) : r)));

  /** 统一时间：全班一起跑 t 秒（原 Timer 的 handleTimeSet） */
  const setAllTimes = (v: number) => {
    setAllTime(v);
    setRunways((prev) =>
      prev.map((r) => recompute({ ...r, time: fmt(v), solve: r.solve === "time" ? "speed" : r.solve })),
    );
  };
  /** 统一速度 */
  const setAllSpeeds = (v: number) => {
    setAllSpeed(v);
    setRunways((prev) =>
      prev.map((r) => recompute({ ...r, speed: fmt(v), solve: r.solve === "speed" ? "distance" : r.solve })),
    );
  };

  const go = () => {
    const startedAt = Date.now(); setNow(startedAt);
    setScene((current) => ({ ...current, runways: motionFrame(current, startedAt).runways, playback: { phase: "running", elapsedMs: 0, startedAt } }));
  };
  const pause = () => setScene((current) => ({ ...current, playback: { phase: "paused", elapsedMs: motionFrame(current, Date.now()).clock * 1000, startedAt: 0 } }));
  const resume = () => {
    const startedAt = Date.now(); setNow(startedAt);
    setScene((current) => ({ ...current, playback: { ...current.playback, phase: "running", startedAt } }));
  };
  const reset = () => {
    setScene((current) => ({ ...current, playback: { phase: "idle", elapsedMs: 0, startedAt: 0 } }));
  };

  useEffect(() => {
    if (phase !== "running") return;
    let raf = 0;
    const tick = () => {
      setNow(Date.now()); raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  const locked = phase === "running" || readOnly;

  return (
    <div className="flex min-h-0 flex-1 flex-col" inert={readOnly} {...capture}>
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 ${embedded ? "py-1.5" : "py-2"}`}>
        <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-muted">
          {t("length")}
          <EditableNumber value={length} disabled={locked} min={Number.MIN_VALUE}
            className="h-[30px] w-14 border-line py-0 shadow-none"
            longPressValue={100} longPressLabel={t("numberHint", { value: 100, unit: "m" })} onCommit={(v) => {
            if (v > 0) {
              setLength(fmt(v));
              setRunways((prev) => prev.map((r) => (r.x > v ? { ...r, x: v } : r)));
            }
          }} ariaLabel={t("length")} />
          <span>m</span>
        </div>
        <div className="flex shrink-0 items-center gap-1 border-l border-line pl-3">
          {phase === "running" ? (
            <SpatialIconButton label={t("pause")} active onClick={pause}><Pause aria-hidden /></SpatialIconButton>
          ) : phase === "paused" ? (
            <SpatialIconButton label={t("resume")} onClick={resume}><Play aria-hidden /></SpatialIconButton>
          ) : (
            <SpatialIconButton label={t("start")} onClick={go}><Play aria-hidden /></SpatialIconButton>
          )}
          <SpatialIconButton label={t("reset")} onClick={reset}><RotateCcw aria-hidden /></SpatialIconButton>
          {preparation && scene.playback.phase !== "idle" && <SpatialIconButton label={t("useCurrentPosition")} onClick={() => setRunways((current) => current)}><LocateFixed aria-hidden /></SpatialIconButton>}
          <span aria-label={t("clock")} title={t("clock")} className="ml-1 flex h-[30px] items-center gap-1.5 whitespace-nowrap px-1 text-xs tabular-nums text-muted">
            <Timer size={15} aria-hidden /><span className="min-w-7 text-right text-ink">{clock.toFixed(1)}</span> s
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-l border-line pl-3">
          <div className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted">
            <span>{t("allTime")}</span>
            <ApplyField value={allTime} disabled={locked} min={Number.MIN_VALUE} unit="s" applyLabel={`${t("apply")} · ${t("allTime")}`} onApply={(v) => v > 0 && setAllTimes(v)} ariaLabel={t("allTime")} />
          </div>
          <div className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted">
            <span>{t("allSpeed")}</span>
            <ApplyField value={allSpeed} disabled={locked} unit="m/s" applyLabel={`${t("apply")} · ${t("allSpeed")}`} onApply={(v) => v >= 0 && setAllSpeeds(v)} ariaLabel={t("allSpeed")} />
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <SpatialIconButton label={t("showRuler")} active={showRuler} onClick={() => setShowRuler(!showRuler)}><Ruler aria-hidden /></SpatialIconButton>
          <div className="mx-1 h-5 border-l border-line" aria-hidden />
          <SpatialIconButton label={t("addRunway")} disabled={phase !== "idle" || runways.length >= MAX_RUNWAYS} onClick={() => setRunways((p) => [...p, makeRunway(Math.max(...p.map((r) => r.id)) + 1)])}><Plus aria-hidden /></SpatialIconButton>
          <SpatialIconButton label={t("removeRunway")} disabled={phase !== "idle" || runways.length <= 1} onClick={() => setRunways((p) => p.slice(0, -1))}><Minus aria-hidden /></SpatialIconButton>
          <Popover open={helpOpen} onOpenChange={setHelpOpen}>
            <PopoverTrigger asChild>
              <SpatialIconButton label={t("help")} active={helpOpen}><CircleHelp aria-hidden /></SpatialIconButton>
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={8} aria-label={t("help")} className="w-80 space-y-2 bg-paper p-3 text-xs leading-relaxed text-muted">
              <p className="font-medium text-ink">{t("help")}</p>
              <p>{t("dragHint")}</p><p>{t("solveHint")}</p><p>{t("editHint")}</p>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-2">
        <div className="relative">
          {/* 尾部留白：测距尺可以停靠在最后一条跑道下方而不遮挡它 */}
          {runways.map((r) => (
            <RunwayLane
              key={r.id}
              runway={r}
              length={length}
              ppm={ppm}
              locked={locked}
              onMove={(id, x) => patchRunway(id, { x })}
              onField={(id, field, value) => setRunways((prev) => prev.map((r) => (r.id === id ? editField(r, field, value) : r)))}
              onSolve={(id, key: SolveKey) => patchRunway(id, { solve: key }, true)}
              onPatch={(id, patch) => patchRunway(id, patch)}
              onVehicle={(id, vehicle) =>
                setRunways((prev) =>
                  prev.map((r) => {
                    if (r.id !== id) return r;
                    const preset = VEHICLE_SPEEDS[vehicle];
                    const next = { ...r, vehicle };
                    return preset ? editField(next, "speed", preset) : next;
                  }),
                )
              }
              onMeasure={(id, dist, dur) => patchRunway(id, { distance: fmt(dist), time: fmt(dur), speed: fmt(dist / dur) })}
            />
          ))}
          <div aria-hidden className="h-16" />
          {/* 测距尺覆盖层：与各跑道的轨道区对齐 */}
          <div ref={trackRef} className="pointer-events-none absolute inset-y-0 right-0" style={{ left: PANEL_W }}>
            {showRuler && runways.length > 0 && <RulerOverlay xs={runways.map((r) => r.x)} ppm={ppm} length={length} />}
          </div>
        </div>
      </div>
    </div>
  );
}
