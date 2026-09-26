"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { bindSpatialPointerGuard } from "@/features/spatial-math/renderer-r3f/spatial-pointer-guard";
import { beginSpatialObjectGesture } from "@/features/spatial-math/renderer-r3f/spatial-object-gesture";
import { usePlanarDrag, type PlanarDragFrame } from "../planar-interaction/usePlanarDrag";
import { useToolSnapshot } from "../scenes/useToolSnapshot";
import { SpatialActionButton } from "../spatial-interaction/SpatialActionButton";
import { SpatialCanvasPanel } from "../spatial-interaction/SpatialWorkbenchControls";
import { useSpatialDirectCommit } from "../spatial-interaction/useSpatialDirectCommit";
import { useSpatialToolState } from "../spatial-interaction/useSpatialToolState";
import workbenchStyles from "../spatial-lab/CubeStructuresWorkbench.module.css";
import { planarSnapshot, planarSnapshotForTool, planarStateSchema, type PlanarSnapshot, type PlanarState, type PlanarToolId } from "./contract";
import { planarCommit, planarEventTime, planarFrame, planarHistory, planarPause, planarProgress } from "./presentation";
import { planarScene, scenesForPlanarTool } from "./scene-registry";
import { textFor, type PlanarAction, type PlanarDrawingApi } from "./types";
import styles from "./PlanarWorkbench.module.css";

interface Props {
  toolId: PlanarToolId; locale?: string; initial?: PlanarState; readOnly?: boolean;
  classroom?: { state?: PlanarSnapshot; onChange?: (next: PlanarSnapshot) => Promise<void> };
  onSnapshot?: (scene: PlanarState | null) => void;
}
type Drag = { start: PlanarState; target: string; source: PlanarSnapshot };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** 2D 教具共用唯一宿主：领域提供几何与动作，备课、历史、动画与课堂接线由这里维护。 */
export function PlanarWorkbench({ toolId, locale: suppliedLocale, initial, readOnly = false, classroom, onSnapshot }: Props) {
  return <PlanarWorkbenchStage key={`${toolId}:${JSON.stringify(initial ?? null)}`} toolId={toolId} locale={suppliedLocale} initial={initial} readOnly={readOnly} classroom={classroom} onSnapshot={onSnapshot} />;
}
function PlanarWorkbenchStage({ toolId, locale: suppliedLocale, initial, readOnly = false, classroom, onSnapshot }: Props) {
  const defaultLocale = useLocale(), locale = suppliedLocale ?? defaultLocale, en = locale === "en";
  const scenes = useMemo(() => scenesForPlanarTool(toolId), [toolId]);
  const prepared = useMemo(() => planarSnapshot(initial ?? scenes[0].create()), [initial, scenes]);
  const schema = useMemo(() => planarSnapshotForTool(toolId), [toolId]);
  const { snapshot, update, publishing, failed } = useToolSnapshot(prepared, classroom);
  const direct = useSpatialDirectCommit(snapshot, failed), authority = direct.displayed;
  const definition = planarScene(authority.current.sceneId);
  const [now, setNow] = useState(() => planarEventTime());
  const [preview, setPreview] = useState<PlanarState | null>(null);
  const [landing, setLanding] = useState<PlanarState | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const svg = useRef<SVGSVGElement>(null), uid = useId();
  const previousDrag = useRef<PlanarState | undefined>(undefined);
  const scrubSource = useRef<{ source: PlanarSnapshot; start: PlanarState } | null>(null);
  useEffect(() => {
    const cancelScrub = () => { if (scrubSource.current) { scrubSource.current = null; setPreview(null); } };
    window.addEventListener("blur", cancelScrub);
    return () => { window.removeEventListener("blur", cancelScrub); scrubSource.current = null; };
  }, []);
  const controls = useSpatialToolState<"direct", "scenes" | "parameters" | "display">({
    defaultTool: "direct", panels: { scenes: "direct", parameters: "direct", display: "direct" }, onClearSelection: () => setSelected(null),
  });
  const running = !!authority.motion && !authority.motion.paused && planarProgress(authority.motion, now) < 1;
  const frame = planarFrame(authority, definition, now), shown = preview ?? frame;
  const frameIsExact = planarStateSchema.safeParse(frame).success;
  const writable = !readOnly && (!classroom || !!classroom.onChange);
  const disabled = !writable || publishing || dragging;
  const stable = !running && !dragging && !preview && !publishing;
  const capture = stable && frameIsExact ? frame : null;
  // 保存只拿准确停点，不逐帧写草稿；课堂过程由语义运动及时间锚点重放。
  const captureKey = JSON.stringify(capture);
  useEffect(() => { onSnapshot?.(capture ? JSON.parse(captureKey) as PlanarState : null); }, [captureKey, onSnapshot]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (svg.current) return bindSpatialPointerGuard(svg.current); }, []);
  useEffect(() => {
    if (!authority.motion || authority.motion.paused) return;
    let request = 0;
    const tick = () => { const time = planarEventTime(); setNow(time); if (planarProgress(authority.motion!, time) < 1) request = requestAnimationFrame(tick); };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [authority.motion]);

  function publish(next: PlanarSnapshot) {
    if (!writable || publishing) return false;
    const checked = schema.safeParse(next);
    if (!checked.success || new TextEncoder().encode(JSON.stringify(next)).byteLength > 480_000) { setInvalid(true); return false; }
    if (!update(checked.data)) return false;
    direct.hold(checked.data); setNow(planarEventTime()); setInvalid(false); return true;
  }
  function commit(to: PlanarState, action?: Pick<PlanarAction, "id" | "duration">, from = shown, base = authority) {
    return publish(planarCommit(base, from, to, action?.duration ? { id: action.id, duration: action.duration, now: planarEventTime() } : undefined));
  }
  function execute(action: PlanarAction) {
    if (disabled || running || !frameIsExact || action.disabled?.(shown, { selected })) return;
    commit(action.run(shown, { selected }), action);
  }
  function setField(key: string, value: number) {
    commit(definition.setField?.(shown, key, value) ?? { ...shown, params: { ...shown.params, [key]: value } });
  }
  function stopAtFrame() {
    const current = planarFrame(authority, definition, planarEventTime());
    publish(planarStateSchema.safeParse(current).success ? { ...authority, current, motion: null } : planarPause(authority, planarEventTime(), true));
  }
  function dragFrame(data: PlanarDragFrame<Drag>) {
    const next = definition.drag?.(data.data.start, data.data.target, data.point, data.delta, { previous: previousDrag.current }) ?? data.data.start;
    previousDrag.current = next; return next;
  }
  function clearDrag() { previousDrag.current = undefined; setPreview(null); setLanding(null); setDragging(false); }
  const drag = usePlanarDrag<Drag>(svg, {
    onMove(data) {
      if (!writable || data.data.source !== snapshot) { drag.cancel(); return; }
      if (!data.moved) return;
      const next = dragFrame(data); setPreview(next); setLanding(definition.snap?.(next, data.data.target) ?? null);
    },
    onFinish(data) {
      if (!writable || data.data.source !== snapshot) { clearDrag(); return; }
      const next = data.moved ? dragFrame(data) : definition.tap?.(data.data.start, data.data.target) ?? data.data.start;
      const snapped = data.moved ? definition.snap?.(next, data.data.target) : null;
      // 手动过程已经展示；只有吸附的最后一小段播放，回执不会从起点重播拖动。
      const changed = planarCommit(authority, data.data.start, snapped ?? next);
      const settled = snapped && !same(snapped, next) ? { ...changed, motion: planarCommit(authority, next, snapped, { id: "snap", duration: 180, now: planarEventTime() }).motion } : changed;
      if (!same(next, data.data.start) || snapped) publish(settled);
      clearDrag();
    },
    onCancel: clearDrag,
  });
  useEffect(() => {
    // 外部权限/权威替换时必须同步撤销已捕获指针和本地预览，避免过期编辑留在舞台。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    drag.cancel(); clearDrag(); scrubSource.current = null;
    // 权限撤销或外部权威替换即取消本地预览；不由每次 RAF／指针重渲染触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [writable, snapshot]);
  const api: PlanarDrawingApi = {
    locale, selected, editable: !disabled && !running && frameIsExact,
    bind: (target, label = target) => ({
      role: "button", tabIndex: writable ? 0 : -1, "aria-label": label, "aria-pressed": selected === target, "aria-disabled": disabled || running || !frameIsExact,
      onPointerDown(event) {
        if (disabled || running || !frameIsExact) return;
        if (drag.start(event, { start: shown, target, source: snapshot })) {
          previousDrag.current = shown;
          beginSpatialObjectGesture(svg.current!); controls.activateSelection(); setSelected(target); setDragging(true); svg.current?.focus({ preventScroll: true });
        }
      },
      onKeyDown(event) {
        if (disabled || running || !frameIsExact || !["Enter", " "].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation(); setSelected(target); controls.activateSelection();
        if (definition.tap) commit(definition.tap(shown, target));
      },
    }),
  };
  const inertApi: PlanarDrawingApi = { ...api, selected: null, editable: false, bind: (_target, label = "") => ({
    role: "button", tabIndex: -1, "aria-label": label, "aria-pressed": false, "aria-disabled": true, onPointerDown: () => {}, onKeyDown: () => {},
  }) };
  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    controls.bindings.onKeyDown(event);
    if ((event.target as Element).closest("input, textarea, button, [role=checkbox]")) return;
    if (event.key === "Escape") { drag.cancel(); setPreview(null); setLanding(null); if (running && !disabled) publish(planarPause(authority, planarEventTime(), true)); }
    if (!disabled && !running && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault(); publish(planarHistory(authority, event.shiftKey ? "redo" : "undo"));
    }
  }
  const m = (zh: string, english: string) => en ? english : zh;
  const switches = [{ key: "grid", label: { zh: "参考网格", en: "Reference grid" } }, { key: "measures", label: { zh: "数值与测量标记", en: "Values and measurements" } }, ...(definition.toggles ?? [])].filter((entry, index, all) => all.findIndex((item) => item.key === entry.key) === index);
  return <div className={workbenchStyles.workspace} {...controls.bindings} onKeyDown={handleKey} data-planar-tool={toolId} data-planar-scene={definition.id}>
    <div className={styles.viewport}><div className={workbenchStyles.canvas}>
      <svg ref={svg} className={styles.svg} viewBox="0 0 960 720" tabIndex={-1} aria-label={textFor(definition.title, locale)} {...drag.handlers} onClick={(event) => {
        if (event.target === event.currentTarget && !dragging) { controls.onPointerMissed(event.nativeEvent); svg.current?.focus({ preventScroll: true }); }
      }}>
        <defs><pattern id={`${uid}-grid`} width="30" height="30" patternUnits="userSpaceOnUse"><path d="M 30 0 H 0 V 30" fill="none" stroke="var(--line)" strokeWidth="1" /></pattern></defs>
        {shown.flags.grid && <rect width="960" height="720" fill={`url(#${uid}-grid)`} pointerEvents="none" />}
        {definition.draw(shown, api)}
        {landing && !same(landing, shown) && <g className={styles.ghost} aria-hidden>{definition.draw(landing, inertApi)}</g>}
      </svg>
      <div role="toolbar" aria-label={m("现场与设置", "Scene and settings")} className={`${workbenchStyles.dock} ${workbenchStyles.meta}`}>
        {scenes.length > 1 && <SpatialActionButton action="pieces" label={m("选择教学现场", "Choose a teaching scene")} active={controls.panel === "scenes"} onClick={() => controls.togglePanel("scenes")} />}
        {!!definition.fields?.length && <SpatialActionButton action="dimensions" label={m("形状与准确参数", "Shape and precise parameters")} active={controls.panel === "parameters"} onClick={() => controls.togglePanel("parameters")} />}
        <SpatialActionButton action="settings" label={m("显示设置", "Display settings")} active={controls.panel === "display"} onClick={() => controls.togglePanel("display")} />
      </div>
      <div role="toolbar" aria-label={m("操作工具", "Teaching actions")} className={`${workbenchStyles.dock} ${workbenchStyles.tools}`}>
        {definition.actions?.map((action) => <SpatialActionButton key={action.id} action={action.icon} label={textFor(action.label, locale)} disabled={disabled || running || !frameIsExact || action.disabled?.(shown, { selected })} onClick={() => execute(action)} />)}
        {authority.motion && planarProgress(authority.motion, now) < 1 && <>
          <SpatialActionButton action={running ? "pause" : "play"} label={running ? m("暂停过程", "Pause motion") : m("继续过程", "Resume motion")} disabled={disabled} onClick={() => publish(planarPause(authority, planarEventTime(), running))} />
          <SpatialActionButton action="stop" label={m("停在当前位置", "Stop at the current position")} disabled={disabled} onClick={stopAtFrame} />
        </>}
        <div className={workbenchStyles.toolSeparator} />
        <SpatialActionButton action="undo" label={m("撤销", "Undo")} disabled={disabled || running || !authority.past.length} onClick={() => publish(planarHistory(authority, "undo"))} />
        <SpatialActionButton action="redo" label={m("重做", "Redo")} disabled={disabled || running || !authority.future.length} onClick={() => publish(planarHistory(authority, "redo"))} />
        <SpatialActionButton action="reset" label={m("恢复备好的起点", "Restore the prepared starting scene")} disabled={disabled} onClick={() => { commit(prepared.current, undefined, frameIsExact ? frame : authority.current); setSelected(null); }} />
      </div>
      {controls.panel && <SpatialCanvasPanel title={controls.panel === "scenes" ? m("教学现场", "Teaching scenes") : controls.panel === "parameters" ? m("形状与准确参数", "Shape and precise parameters") : m("显示设置", "Display settings")} anchor="meta" closeLabel={m("关闭面板", "Close panel")} onClose={controls.closePanel}>
        {controls.panel === "scenes" && <div className={styles.gallery}>{scenes.map((scene) => <Button key={scene.id} variant={scene.id === shown.sceneId ? "secondary" : "ghost"} disabled={disabled || running || !frameIsExact} onClick={() => { commit(scene.create()); setSelected(null); controls.closePanel(); }}>{textFor(scene.title, locale)}</Button>)}</div>}
        {controls.panel === "parameters" && definition.fields?.map((field) => <label className={styles.field} key={field.key}>{textFor(field.label, locale)}{field.options ? <Select value={String(shown.params[field.key])} disabled={disabled || running || !frameIsExact} onValueChange={(value) => setField(field.key, Number(value))}><SelectTrigger className="w-36" aria-label={textFor(field.label, locale)}><SelectValue /></SelectTrigger><SelectContent>{field.options.map((option) => <SelectItem key={option.value} value={String(option.value)}>{textFor(option.label, locale)}</SelectItem>)}</SelectContent></Select> : <Input key={`${shown.sceneId}:${field.key}:${shown.params[field.key]}`} type="number" min={field.min} max={field.max} step={field.step ?? "any"} defaultValue={shown.params[field.key] ?? field.min} disabled={disabled || running || !frameIsExact} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} onBlur={(event) => {
          const value = event.currentTarget.valueAsNumber; if (!Number.isFinite(value)) { event.currentTarget.value = String(shown.params[field.key] ?? field.min); return; }
          const rounded = field.step ? field.min + Math.round((value - field.min) / field.step) * field.step : value;
          const bounded = Math.min(field.max, Math.max(field.min, rounded));
          setField(field.key, bounded);
        }} />}</label>)}
        {controls.panel === "display" && switches.map((flag) => <label className={styles.field} key={flag.key}>{textFor(flag.label, locale)}<Checkbox checked={!!shown.flags[flag.key]} disabled={disabled || running || !frameIsExact} onCheckedChange={(value) => commit(definition.setFlag?.(shown, flag.key, value === true) ?? { ...shown, flags: { ...shown.flags, [flag.key]: value === true } })} /></label>)}
        {definition.progress && controls.panel !== "scenes" && <label className={styles.progress}>{m("演示位置", "Demonstration progress")} {Math.round(shown.phase * 100)}%
          <Slider min={0} max={1} step={0.001} value={[shown.phase]} aria-label={m("演示位置", "Demonstration progress")} disabled={disabled || running || !frameIsExact}
            onValueChange={([value]) => {
              scrubSource.current ??= { source: snapshot, start: frame };
              if (scrubSource.current.source === snapshot) setPreview({ ...scrubSource.current.start, phase: value });
            }}
            onValueCommit={([value]) => {
              // Radix 键盘操作先通知 commit 再 change；等本轮值通知完成，统一提交一次。
              queueMicrotask(() => {
                const source = scrubSource.current;
                if (source?.source === snapshot && writable && !publishing) commit({ ...source.start, phase: value }, undefined, source.start);
                scrubSource.current = null; setPreview(null);
              });
            }} />
        </label>}
      </SpatialCanvasPanel>}
      <div className={workbenchStyles.cutStatus} aria-live="polite"><strong>{textFor(definition.title, locale)}</strong><div>{textFor(definition.description, locale)}</div>{definition.summary && <div>{definition.summary(shown, locale)}</div>}{(failed || invalid) && <div role="alert">{m("这次操作未能保存，请重试。", "This change could not be saved. Please retry.")}</div>}</div>
    </div></div>
  </div>;
}
