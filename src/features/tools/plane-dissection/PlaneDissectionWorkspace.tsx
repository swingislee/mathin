"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Eye, Magnet, MoveRight, Redo2, RotateCcw, Scissors, SlidersHorizontal, Square, Undo2, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { usePlanarDrag, type PlanarDragFrame } from "../planar-interaction/usePlanarDrag";
import { translatePolygon, type PlanePoint } from "../planar-interaction/geometry";
import { closestPaperSnap, commitPaperScene, defaultPlaneDissection, interpolatePaperScene, movePaper, paperPolygons, planeDissectionSchema, stepPaperHistory, type PaperHistory, type PaperId, type PaperSnap, type PlaneDissectionScene } from "./model";
import { planeDissectionMessages } from "./messages";
import styles from "./PlaneDissectionWorkspace.module.css";

const SCALE = 55, HOME = { x: 180, y: 465 };
const position = (p: PlanePoint) => ({ x: HOME.x + p.x * SCALE, y: HOME.y + p.y * SCALE });
const points = (polygon: PlanePoint[]) => polygon.map(position).map((p) => `${p.x},${p.y}`).join(" ");
const numeric = (n: number) => Number(n.toFixed(2));
type ShapeField = "base" | "height" | "slant";
type DragData = { start: PlaneDissectionScene; kind: PaperId | "base" | "shape"; threshold: number };

function Action({ icon: Icon, label, active, ...props }: { icon: LucideIcon; label: string; active?: boolean } & Omit<React.ComponentProps<typeof Button>, "children">) {
  return <Button type="button" variant="secondary" className={styles.icon} title={label} aria-label={label} aria-pressed={active} {...props}><Icon size={18} aria-hidden /></Button>;
}

/** 交互试做与后续宿主共用原组件；准确起点/终点通过 onSnapshot 暴露，过程帧留在舞台。 */
export function PlaneDissectionWorkspace({ locale = "zh", initial, readOnly = false, onSnapshot }: {
  locale?: string; initial?: PlaneDissectionScene; readOnly?: boolean; onSnapshot?: (scene: PlaneDissectionScene | null) => void;
}) {
  const m = planeDissectionMessages(locale), uid = useId();
  const [history, setHistory] = useState<PaperHistory>(() => ({ past: [], present: planeDissectionSchema.parse(initial ?? defaultPlaneDissection()), future: [] }));
  const [preview, setPreview] = useState<PlaneDissectionScene | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<PaperId | null>(null);
  const [panel, setPanel] = useState<"shape" | "display" | null>(null);
  const [landing, setLanding] = useState<{ id: PaperId; snap: PaperSnap } | null>(null);
  const [cutProgress, setCutProgress] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const motion = useRef<number | null>(null);
  const scene = preview ?? history.present;
  const polygons = paperPolygons(scene);

  useEffect(() => { onSnapshot?.(busy ? null : history.present); }, [history.present, busy, onSnapshot]);
  useEffect(() => () => { if (motion.current !== null) cancelAnimationFrame(motion.current); }, []);

  function commit(next: PlaneDissectionScene) {
    setHistory((old) => commitPaperScene(old, next)); setPreview(null); setLanding(null); setBusy(false); setCutProgress(null);
  }
  function stopMotion() {
    if (motion.current !== null) cancelAnimationFrame(motion.current);
    motion.current = null; setPreview(null); setLanding(null); setBusy(false); setCutProgress(null);
  }
  function animate(from: PlaneDissectionScene, to: PlaneDissectionScene, duration: number, cutting = false) {
    if (motion.current !== null) cancelAnimationFrame(motion.current);
    setBusy(true); setLanding(null); setPreview(from);
    const started = performance.now();
    const frame = (now: number) => {
      const progress = Math.min(1, (now - started) / duration);
      if (cutting) { setCutProgress(progress); setPreview(from); }
      else setPreview(interpolatePaperScene(from, to, progress));
      if (progress < 1) motion.current = requestAnimationFrame(frame);
      else { motion.current = null; commit(to); }
    };
    motion.current = requestAnimationFrame(frame);
  }
  const shapeChange = (start: PlaneDissectionScene, field: ShapeField, value: number): PlaneDissectionScene => ({
    ...start, [field]: numeric(Math.min(field === "base" ? 8 : field === "height" ? 5 : 2.5, Math.max(field === "base" ? 3 : field === "height" ? 1.5 : 0.5, value))),
  });
  function dragScene({ data, delta }: PlanarDragFrame<DragData>): PlaneDissectionScene {
    if (data.kind === "base") return shapeChange(data.start, "base", data.start.base + delta.x / SCALE);
    if (data.kind === "shape") return shapeChange(shapeChange(data.start, "slant", data.start.slant + delta.x / SCALE), "height", data.start.height - delta.y / SCALE);
    return movePaper(data.start, data.kind, { x: delta.x / SCALE, y: delta.y / SCALE });
  }
  const drag = usePlanarDrag(svg, {
    onMove(frame: PlanarDragFrame<DragData>) {
      const next = dragScene(frame); setPreview(next);
      if (frame.data.kind === "body" || frame.data.kind === "offcut") {
        const snap = closestPaperSnap(next, frame.data.kind, frame.data.threshold);
        setLanding(snap ? { id: frame.data.kind, snap } : null);
      }
    },
    onFinish(frame: PlanarDragFrame<DragData>) {
      if (!frame.moved) { commit(frame.data.start); return; }
      const next = dragScene(frame), id = frame.data.kind;
      if (id === "body" || id === "offcut") {
        const snap = closestPaperSnap(next, id, frame.data.threshold);
        if (snap && Math.hypot(next[id].x - snap.position.x, next[id].y - snap.position.y) > 1e-6) { animate(next, { ...next, [id]: snap.position }, 180); return; }
      }
      commit(next);
    },
    onCancel() { setPreview(null); setLanding(null); setBusy(false); },
  });
  function begin(event: PointerEvent, kind: DragData["kind"]) {
    if (readOnly || busy) return;
    const scale = svg.current?.getScreenCTM()?.a ?? 1;
    if (drag.start(event, { start: history.present, kind, threshold: 18 / (Math.abs(scale) * SCALE) })) {
      svg.current?.focus({ preventScroll: true });
      setBusy(true); setSelected(kind === "body" || kind === "offcut" ? kind : null);
    }
  }
  function handleKey(event: KeyboardEvent) {
    if (event.key === "Escape") { event.preventDefault(); drag.cancel(); stopMotion(); setSelected(null); setPanel(null); return; }
    if ((event.target as Element).closest("input, button, textarea, [role=checkbox]")) return;
    if (readOnly || busy) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault(); setHistory((old) => stepPaperHistory(old, event.shiftKey ? "redo" : "undo")); return;
    }
    if (!selected || !scene.cut) return;
    const directions: Record<string, PlanePoint> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
    const d = directions[event.key];
    if (d) { event.preventDefault(); const step = event.shiftKey ? 1 : .25; commit(movePaper(scene, selected, { x: d.x * step, y: d.y * step })); }
  }
  const disabled = readOnly || busy;
  const measureOrigin = !scene.cut || scene.showOrigin;
  const high = position({ x: scene.slant, y: -scene.height }), foot = position({ x: scene.slant, y: 0 }), end = position({ x: scene.base, y: 0 });
  const hint = panel === "shape" ? m.shapeHint : scene.cut ? m.dragHint : m.cutHint;

  return <div className={styles.workspace} onKeyDown={handleKey} data-plane-dissection="preview-v1">
    <div className={styles.stage}>
      <svg ref={svg} className={styles.canvas} viewBox="0 0 960 720" tabIndex={-1} aria-label={m.title} {...drag.handlers} onPointerDown={(event) => {
        if (event.target === event.currentTarget && event.button === 0 && !busy) { setSelected(null); svg.current?.focus({ preventScroll: true }); }
      }}>
        <defs><pattern id={`${uid}-grid`} width={SCALE} height={SCALE} patternUnits="userSpaceOnUse" x={HOME.x} y={HOME.y}><path d={`M ${SCALE} 0 H 0 V ${SCALE}`} fill="none" stroke="var(--line)" strokeWidth="1" /></pattern></defs>
        {scene.showGrid && <rect width="960" height="720" fill={`url(#${uid}-grid)`} pointerEvents="none" />}
        {scene.cut && scene.showOrigin && <polygon points={points(polygons.whole)} className={styles.origin} />}
        {!scene.cut && <polygon points={points(polygons.whole)} className={styles.paper} fill="var(--leaf)" />}
        {scene.cut && (["body", "offcut"] as PaperId[]).sort((a, b) => Number(a === selected) - Number(b === selected)).map((id) => <polygon key={id}
          points={points(translatePolygon(polygons[id], scene[id]))} fill={id === "body" ? "var(--leaf)" : "var(--moon)"}
          className={cn(styles.paper, !readOnly && styles.movable, selected === id && styles.selected, busy && selected === id && styles.moving)}
          role="button" tabIndex={readOnly ? -1 : 0} aria-label={m[id]} aria-pressed={selected === id} aria-disabled={readOnly}
          onPointerDown={(event) => begin(event, id)} onFocus={() => { if (!readOnly) setSelected(id); }}
          onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && !disabled) { event.preventDefault(); setSelected(id); } }} />)}
        {landing && <polygon points={points(translatePolygon(polygons[landing.id], landing.snap.position))} className={styles.landing} aria-label={m.snapTarget} />}
        {scene.showMeasures && measureOrigin && <g pointerEvents="none">
          <path className={styles.dimension} d={`M ${HOME.x} ${HOME.y + 28} v 12 m 0 -6 h ${scene.base * SCALE} m 0 -6 v 12`} />
          <text x={(HOME.x + end.x) / 2} y={HOME.y + 64} textAnchor="middle">{m.base} {scene.base} {m.unit}</text>
          <path className={styles.dimension} strokeDasharray="4 4" d={`M ${high.x} ${high.y} V ${foot.y}`} />
          <path className={styles.dimension} d={`M ${foot.x} ${foot.y - 16} h 16 v 16`} />
          <text x={high.x - 20} y={(high.y + foot.y) / 2} textAnchor="end">{m.height} {scene.height} {m.unit}</text>
          {scene.cut && <text x={(HOME.x + end.x) / 2} y={HOME.y + 89} textAnchor="middle" fontSize="14">{m.originalMeasures}</text>}
        </g>}
        {cutProgress !== null && <path className={styles.cut} d={`M ${high.x} ${high.y} V ${foot.y}`} pathLength="1" strokeDasharray="1" strokeDashoffset={1 - cutProgress} />}
        {panel === "shape" && !scene.cut && !readOnly && <g>
          <circle cx={end.x} cy={end.y} r={18} className={styles.shapeHandle} style={{ stroke: "transparent", fill: "transparent" }} onPointerDown={(event) => begin(event, "base")} />
          <circle cx={end.x} cy={end.y} r={8} className={styles.shapeHandle} pointerEvents="none" />
          <circle cx={high.x} cy={high.y} r={18} className={styles.shapeHandle} style={{ stroke: "transparent", fill: "transparent" }} onPointerDown={(event) => begin(event, "shape")} />
          <circle cx={high.x} cy={high.y} r={8} className={styles.shapeHandle} pointerEvents="none" />
        </g>}
      </svg>
      <div className={styles.topbar} role="toolbar" aria-label={m.tool}>
        <Action icon={Undo2} label={m.undo} disabled={disabled || !history.past.length} onClick={() => { setHistory((old) => stepPaperHistory(old, "undo")); setSelected(null); }} />
        <Action icon={Redo2} label={m.redo} disabled={disabled || !history.future.length} onClick={() => { setHistory((old) => stepPaperHistory(old, "redo")); setSelected(null); }} />
        {busy && <Action icon={Square} label={m.cancel} onClick={() => { drag.cancel(); stopMotion(); }} />}
      </div>
      <div className={styles.toolbar} role="toolbar" aria-label={m.title}>
        <Action icon={Scissors} label={m.cut} disabled={disabled || scene.cut} onClick={() => { setPanel(null); animate(scene, { ...scene, cut: true }, 460, true); }} />
        <Action icon={MoveRight} label={m.assemble} disabled={disabled || !scene.cut} onClick={() => { setPanel(null); animate(scene, { ...scene, offcut: { x: scene.body.x + scene.base, y: scene.body.y } }, 1000); }} />
        <Action icon={RotateCcw} label={m.reset} disabled={disabled} onClick={() => { setPanel(null); setSelected(null); animate(scene, { ...scene, cut: false, body: { x: 0, y: 0 }, offcut: { x: 0, y: 0 } }, 700); }} />
        <span className={styles.divider} />
        <Action icon={Magnet} label={m.snap} active={scene.snap} disabled={disabled} onClick={() => commit({ ...scene, snap: !scene.snap })} />
        <Action icon={SlidersHorizontal} label={m.shape} active={panel === "shape"} disabled={disabled || scene.cut} onClick={() => { setSelected(null); setPanel(panel === "shape" ? null : "shape"); }} />
        <Action icon={Eye} label={m.display} active={panel === "display"} disabled={disabled} onClick={() => { setSelected(null); setPanel(panel === "display" ? null : "display"); }} />
      </div>
      {panel && <section className={styles.panel} aria-label={panel === "shape" ? m.shape : m.display}>
        <div className={styles.panelHeader}><h2>{panel === "shape" ? m.shape : m.display}</h2><Action icon={X} label={m.close} onClick={() => setPanel(null)} /></div>
        {panel === "shape" ? <>
          {(["base", "height", "slant"] as const).map((field) => <label className={styles.field} key={field}><span>{m[field]} / {m.unit}</span><Input key={scene[field]} type="number" aria-label={m[field]} step="0.25" defaultValue={scene[field]} min={field === "base" ? 3 : field === "height" ? 1.5 : .5} max={field === "base" ? 8 : field === "height" ? 5 : 2.5} disabled={disabled}
            onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
            onBlur={(event) => { const value = event.currentTarget.valueAsNumber; if (Number.isFinite(value)) commit(shapeChange(history.present, field, value)); else event.currentTarget.value = String(history.present[field]); }} /></label>)}
          <p>{m.shapeHint}</p>
        </> : ([['showOrigin', m.origin], ['showMeasures', m.measures], ['showArea', m.area], ['showGrid', m.grid]] as const).map(([field, label]) => <label className={styles.field} key={field}><span>{label}</span><Checkbox checked={scene[field]} disabled={disabled} onCheckedChange={(checked) => commit({ ...scene, [field]: checked === true })} /></label>)}
      </section>}
      {scene.showArea && <output className={styles.area}>{scene.cut ? `${m.combinedArea} · ` : ""}{scene.base} × {scene.height} = {numeric(scene.base * scene.height)} {m.squareUnit}</output>}
      <p className={styles.hint}>{hint}<br />{m.cancelHint}</p>
    </div>
  </div>;
}
