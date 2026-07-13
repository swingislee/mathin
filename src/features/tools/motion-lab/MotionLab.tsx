"use client";

import { Input } from "@/components/ui/input";

import { Minus, Pause, Play, Plus, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ToolComponentProps } from "../types";
import { ApplyField } from "./NumField";
import { RunwayLane } from "./RunwayLane";
import { RulerOverlay } from "./RulerOverlay";
import { DEFAULT_HEAD, DEFAULT_VEHICLE, MAX_RUNWAYS, PANEL_W, POST_PAD, VEHICLE_SPEEDS, editField, fmt, recompute, type Runway, type SolveKey } from "./shared";

let nextId = 1;
function makeRunway(): Runway {
  return { id: nextId++, head: DEFAULT_HEAD, vehicle: DEFAULT_VEHICLE, facingRight: true, x: 0, solve: "speed", distance: 100, time: 10, speed: 10 };
}

type Phase = "idle" | "running" | "paused";

export function MotionLab({ embedded }: ToolComponentProps) {
  const t = useTranslations("tools.motion");
  const [length, setLength] = useState(100);
  const [runways, setRunways] = useState<Runway[]>(() => [makeRunway()]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [clock, setClock] = useState(0);
  const [showRuler, setShowRuler] = useState(true);
  const [allTime, setAllTime] = useState(10);
  const [allSpeed, setAllSpeed] = useState(10);
  const [trackW, setTrackW] = useState(640);
  const trackRef = useRef<HTMLDivElement>(null);
  const runStartRef = useRef(0);
  const doneAtRef = useRef(0);
  const startXsRef = useRef<Map<number, number>>(new Map());
  const goSnapshotRef = useRef<Map<number, number>>(new Map());

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
    const snap = new Map(runways.map((r) => [r.id, r.x]));
    goSnapshotRef.current = snap;
    startXsRef.current = snap;
    doneAtRef.current = Math.max(0, ...runways.map((r) => (r.time > 0 && r.speed > 0 ? r.time : 0)));
    runStartRef.current = performance.now();
    setClock(0);
    setPhase("running");
  };
  const pause = () => setPhase("paused");
  const resume = () => {
    runStartRef.current = performance.now() - clock * 1000;
    setPhase("running");
  };
  const reset = () => {
    setPhase("idle");
    setClock(0);
    setRunways((prev) => prev.map((r) => ({ ...r, x: goSnapshotRef.current.get(r.id) ?? r.x })));
  };

  useEffect(() => {
    if (phase !== "running") return;
    let raf = 0;
    const tick = () => {
      const t = (performance.now() - runStartRef.current) / 1000;
      const done = t >= doneAtRef.current;
      const tt = Math.min(t, doneAtRef.current);
      setClock(tt);
      setRunways((prev) =>
        prev.map((r) => {
          const x0 = startXsRef.current.get(r.id) ?? r.x;
          const dir = r.facingRight ? 1 : -1;
          const x = Math.max(0, Math.min(length, x0 + dir * r.speed * Math.min(tt, r.time)));
          return x === r.x ? r : { ...r, x };
        }),
      );
      if (done) setPhase("idle");
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, length]);

  const locked = phase === "running";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 ${embedded ? "py-2" : "py-2.5"}`}>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          {t("length")}
          <ApplyField value={length} disabled={locked} applyLabel={t("apply")} onApply={(v) => {
            if (v > 0) {
              setLength(fmt(v));
              setRunways((prev) => prev.map((r) => (r.x > v ? { ...r, x: v } : r)));
            }
          }} ariaLabel={t("length")} />
          <span>m</span>
        </label>
        {phase === "running" ? (
          <Button size="sm" onClick={pause}><Pause size={14} />{t("pause")}</Button>
        ) : phase === "paused" ? (
          <Button size="sm" onClick={resume}><Play size={14} />{t("resume")}</Button>
        ) : (
          <Button size="sm" onClick={go}><Play size={14} />{t("start")}</Button>
        )}
        <Button variant="secondary" size="sm" onClick={reset}><RotateCcw size={13} />{t("reset")}</Button>
        <span className="rounded-full border px-3 py-1 text-xs tabular-nums text-muted">
          {t("clock")} <span className="text-ink">{clock.toFixed(1)}</span> s
        </span>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          {t("allTime")}
          <ApplyField value={allTime} disabled={locked} applyLabel={t("apply")} onApply={(v) => v > 0 && setAllTimes(v)} ariaLabel={t("allTime")} />
          <span>s</span>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          {t("allSpeed")}
          <ApplyField value={allSpeed} disabled={locked} applyLabel={t("apply")} onApply={(v) => v >= 0 && setAllSpeeds(v)} ariaLabel={t("allSpeed")} />
          <span>m/s</span>
        </label>
        <div className="ml-auto flex items-center gap-2.5">
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <Input type="checkbox" checked={showRuler} onChange={(e) => setShowRuler(e.target.checked)} className="accent-(--p-accent)" />
            {t("showRuler")}
          </label>
          <Button variant="ghost" size="sm" disabled={phase !== "idle" || runways.length >= MAX_RUNWAYS} onClick={() => setRunways((p) => [...p, makeRunway()])}>
            <Plus size={14} />{t("addRunway")}
          </Button>
          <Button variant="ghost" size="sm" disabled={phase !== "idle" || runways.length <= 1} onClick={() => setRunways((p) => p.slice(0, -1))}>
            <Minus size={14} />{t("removeRunway")}
          </Button>
        </div>
      </div>
      <p className="px-4 pt-2 text-xs text-muted">{t("dragHint")}；{t("solveHint")}</p>
      <p className="px-4 pt-1 text-xs text-muted">{t("editHint")}</p>

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
              onField={(id, field, value) => setRunways((prev) => prev.map((r) => (r.id === id ? recompute({ ...r, [field]: fmt(value) }) : r)))}
              onFieldFocus={(id, field) =>
                setRunways((prev) =>
                  prev.map((r) => {
                    if (r.id !== id || r.solve !== field) return r;
                    // 原版手感：一碰「自动」框，求解目标立即轮转到下一个量
                    const nextSolve: SolveKey = field === "distance" ? "time" : field === "time" ? "speed" : "distance";
                    return recompute({ ...r, solve: nextSolve });
                  }),
                )
              }
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
