"use client";

import { useEffect, useEffectEvent, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { bindSpatialPointerGuard } from "@/features/spatial-math/renderer-r3f/spatial-pointer-guard";
import { beginSpatialObjectGesture } from "@/features/spatial-math/renderer-r3f/spatial-object-gesture";
import { usePlanarDrag, type PlanarDragFrame } from "../planar-interaction/usePlanarDrag";
import { planePointFromClient } from "../planar-interaction/geometry";
import { useToolSnapshot } from "../scenes/useToolSnapshot";
import { SpatialActionButton } from "../spatial-interaction/SpatialActionButton";
import { SpatialActionIcon } from "../spatial-interaction/SpatialActionIcon";
import { SpatialCanvasPanel } from "../spatial-interaction/SpatialWorkbenchControls";
import { useSpatialDirectCommit } from "../spatial-interaction/useSpatialDirectCommit";
import { useSpatialToolState } from "../spatial-interaction/useSpatialToolState";
import workbenchStyles from "../spatial-lab/CubeStructuresWorkbench.module.css";
import { ALL_PLANAR_TOOLS, planarSnapshot, planarSnapshotForTool, planarStateSchema, type PlanarPoint, type PlanarSnapshot, type PlanarState, type PlanarToolId, type PlanarVersion } from "./contract";
import { planarCommit, planarEventTime, planarFrame, planarHistory, planarPause, planarProgress } from "./presentation";
import { planarScene, scenesForPlanarTool } from "./scene-registry";
import { textFor, type PlanarAction, type PlanarDrawingApi, type PlanarField } from "./types";
import styles from "./PlanarWorkbench.module.css";

interface Props {
  toolId: PlanarToolId; version?: PlanarVersion; locale?: string; initial?: PlanarState; readOnly?: boolean;
  classroom?: { state?: PlanarSnapshot; onChange?: (next: PlanarSnapshot) => Promise<void> };
  onSnapshot?: (scene: PlanarState | null) => void;
}
type Drag = { start: PlanarState; target: string; source: PlanarSnapshot; construction?: { tool: string; kind: "point" | "drag" | "points"; points: readonly PlanarPoint[] } };
type Panel = "scenes" | "parameters" | "display" | "materials" | "construction" | "operation";
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** 2D 教具共用唯一宿主：领域提供几何与动作，备课、历史、动画与课堂接线由这里维护。 */
export function PlanarWorkbench({ toolId, version, locale: suppliedLocale, initial, readOnly = false, classroom, onSnapshot }: Props) {
  const resolvedVersion = version ?? ALL_PLANAR_TOOLS.find((tool) => tool.id === toolId && (!initial || (tool.scenes as readonly string[]).includes(initial.sceneId)))?.version;
  return <PlanarWorkbenchStage key={`${toolId}:${resolvedVersion}:${JSON.stringify(initial ?? null)}`} toolId={toolId} version={resolvedVersion} locale={suppliedLocale} initial={initial} readOnly={readOnly} classroom={classroom} onSnapshot={onSnapshot} />;
}
function PlanarWorkbenchStage({ toolId, version, locale: suppliedLocale, initial, readOnly = false, classroom, onSnapshot }: Props) {
  const defaultLocale = useLocale(), locale = suppliedLocale ?? defaultLocale, en = locale === "en";
  const scenes = useMemo(() => scenesForPlanarTool(toolId, version), [toolId, version]);
  const prepared = useMemo(() => planarSnapshot(initial ?? scenes[0].create()), [initial, scenes]);
  const schema = useMemo(() => planarSnapshotForTool(toolId, version), [toolId, version]);
  const { snapshot, update, publishing, failed } = useToolSnapshot(prepared, classroom);
  const direct = useSpatialDirectCommit(snapshot, failed), authority = direct.displayed;
  const definition = planarScene(authority.current.sceneId);
  const [now, setNow] = useState(() => planarEventTime());
  const [preview, setPreview] = useState<PlanarState | null>(null);
  const [landing, setLanding] = useState<PlanarState | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [drawingTool, setDrawingTool] = useState<string | null>(null);
  const [draftPoints, setDraftPoints] = useState<readonly PlanarPoint[]>([]);
  const [draftPreview, setDraftPreview] = useState<readonly PlanarPoint[] | null>(null);
  const [draftInvalid, setDraftInvalid] = useState(false);
  const [operation, setOperation] = useState<string | null>(null);
  const svg = useRef<SVGSVGElement>(null), uid = useId();
  const previousDrag = useRef<PlanarState | undefined>(undefined);
  const scrubSource = useRef<{ source: PlanarSnapshot; start: PlanarState } | null>(null);
  useEffect(() => {
    const cancelScrub = () => { if (scrubSource.current) { scrubSource.current = null; setPreview(null); } };
    window.addEventListener("blur", cancelScrub);
    return () => { window.removeEventListener("blur", cancelScrub); scrubSource.current = null; };
  }, []);
  const controls = useSpatialToolState<"direct", Panel>({
    defaultTool: "direct", panels: { scenes: "direct", parameters: "direct", display: "direct", materials: "direct", construction: "direct", operation: "direct" }, onClearSelection: () => setSelected(null),
  });
  const activeOperation = controls.panel === "operation" ? definition.operations?.find((item) => item.id === operation) : undefined;
  const activeDrawingTool = definition.construction?.tools.find((tool) => tool.id === drawingTool);
  const operationDrawingTool = definition.construction?.tools.find((tool) => tool.id === activeOperation?.constructionTool);
  const running = !!authority.motion && !authority.motion.paused && planarProgress(authority.motion, now) < 1;
  const frame = planarFrame(authority, definition, now), shown = preview ?? frame;
  const frameIsExact = planarStateSchema.safeParse(frame).success;
  const writable = !readOnly && (!classroom || !!classroom.onChange);
  const disabled = !writable || publishing || dragging || draftPoints.length > 0;
  const stable = !running && !dragging && !preview && !publishing && !draftPoints.length;
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
    if (definition.selectionAfterChange) setSelected(definition.selectionAfterChange(authority.current, checked.data.current, selected));
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
  function clearDraft() { setDraftPoints([]); setDraftPreview(null); setDraftInvalid(false); }
  function finishConstruction(tool: string, points: readonly PlanarPoint[], start = shown) {
    if (definition.construction?.tools.find((item) => item.id === tool)?.disabled?.(start)) return false;
    const next = definition.construction?.create(start, tool, points);
    if (!next || !planarStateSchema.safeParse(next).success) { setDraftInvalid(true); return false; }
    if (!commit(next, undefined, start)) return false;
    if (definition.construction?.tools.find((item) => item.id === tool)?.once) setDrawingTool(null);
    clearDraft(); return true;
  }
  const drag = usePlanarDrag<Drag>(svg, {
    onMove(data) {
      if (!writable || data.data.source !== snapshot) { drag.cancel(); return; }
      if (data.data.construction) {
        const drawing = data.data.construction;
        setDraftPreview(drawing.kind === "point" ? [data.point] : drawing.kind === "points" ? [...drawing.points, data.point] : [{ x: data.point.x - data.delta.x, y: data.point.y - data.delta.y }, data.point]);
        return;
      }
      if (!data.moved) return;
      const next = dragFrame(data); setPreview(next); setLanding(definition.snap?.(next, data.data.target) ?? null);
    },
    onFinish(data) {
      if (!writable || data.data.source !== snapshot) { clearDrag(); clearDraft(); return; }
      if (data.data.construction) {
        const drawing = data.data.construction;
        setDraftPreview(null); setDragging(false);
        if (drawing.kind === "point") {
          if (!data.moved) finishConstruction(drawing.tool, [data.point], data.data.start);
        } else if (drawing.kind === "drag") {
          if (data.moved) finishConstruction(drawing.tool, [{ x: data.point.x - data.delta.x, y: data.point.y - data.delta.y }, data.point], data.data.start);
        } else if (drawing.points.length >= 3 && Math.hypot(data.point.x - drawing.points[0].x, data.point.y - drawing.points[0].y) <= 14) {
          finishConstruction(drawing.tool, drawing.points, data.data.start);
        } else if (drawing.points.length < (definition.construction?.maxPoints ?? 32)) {
          setDraftPoints([...drawing.points, data.point]); setDraftInvalid(false);
        }
        return;
      }
      const next = data.moved ? dragFrame(data) : definition.tap?.(data.data.start, data.data.target) ?? data.data.start;
      const snapped = data.moved ? definition.snap?.(next, data.data.target) : null;
      // 手动过程已经展示；只有吸附的最后一小段播放，回执不会从起点重播拖动。
      const changed = planarCommit(authority, data.data.start, snapped ?? next);
      const settled = snapped && !same(snapped, next) ? { ...changed, motion: planarCommit(authority, next, snapped, { id: "snap", duration: 180, now: planarEventTime() }).motion } : changed;
      if (!same(next, data.data.start) || snapped) publish(settled);
      clearDrag();
    },
    onCancel() { clearDrag(); clearDraft(); },
  });
  function cancelConstruction() { drag.cancel(); clearDraft(); setDrawingTool(null); }
  const cancelDraftOnBlur = useEffectEvent(cancelConstruction);
  useEffect(() => { window.addEventListener("blur", cancelDraftOnBlur); return () => window.removeEventListener("blur", cancelDraftOnBlur); }, []);
  function togglePanel(panel: Panel) { cancelConstruction(); controls.togglePanel(panel); }
  function closePanel() { cancelConstruction(); controls.closePanel(); }
  useEffect(() => {
    // 外部权限/权威替换时必须同步撤销已捕获指针和本地预览，避免过期编辑留在舞台。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    drag.cancel(); clearDrag(); clearDraft(); setDrawingTool(null); scrubSource.current = null;
    // 权限撤销或外部权威替换即取消本地预览；不由每次 RAF／指针重渲染触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [writable, snapshot]);
  const api: PlanarDrawingApi = {
    locale, selected, editable: !disabled && !running && frameIsExact && !drawingTool,
    operation: activeOperation?.id ?? null,
    ghostState: authority.motion?.from,
    bind: (target, label = target) => ({
      role: "button", tabIndex: writable && !drawingTool ? 0 : -1, "aria-label": label, "aria-pressed": selected === target, "aria-disabled": disabled || running || !frameIsExact || !!drawingTool,
      onPointerDown(event) {
        if (disabled || running || !frameIsExact || drawingTool) return;
        if (drag.start(event, { start: shown, target, source: snapshot })) {
          previousDrag.current = shown;
          beginSpatialObjectGesture(svg.current!); controls.activateSelection(); setSelected(target); setDragging(true); svg.current?.focus({ preventScroll: true });
        }
      },
      onKeyDown(event) {
        if (disabled || running || !frameIsExact || drawingTool || !["Enter", " "].includes(event.key)) return;
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
    if ((event.target as Element).closest("input, textarea, [contenteditable=true]")) return;
    if (event.key === "Escape") { cancelConstruction(); setPreview(null); setLanding(null); if (running && !disabled) publish(planarPause(authority, planarEventTime(), true)); }
    if (drawingTool && writable && !publishing && !dragging && draftPoints.length) {
      if (event.key === "Enter" && draftPoints.length >= 3) { event.preventDefault(); finishConstruction(drawingTool, draftPoints); }
      if (event.key === "Backspace" || event.key === "Delete") { event.preventDefault(); setDraftPoints(draftPoints.slice(0, -1)); setDraftInvalid(false); }
      return;
    }
    if ((event.target as Element).closest("button, [role=checkbox]")) return;
    if (!disabled && !running && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault(); publish(planarHistory(authority, event.shiftKey ? "redo" : "undo"));
    }
  }
  const m = (zh: string, english: string) => en ? english : zh;
  const materialGroups = [...new Map((definition.materials ?? []).map((material) => [material.group.en, material.group])).values()];
  const renderField = (field: PlanarField) => {
    const currentValue = field.read?.(shown) ?? shown.params[field.key] ?? field.min;
    const fieldDisabled = disabled || running || !frameIsExact || field.disabled?.(shown);
    return <label className={styles.field} key={field.key}>{textFor(field.label, locale)}{field.options ? <Select value={String(currentValue)} disabled={fieldDisabled} onValueChange={(value) => setField(field.key, Number(value))}><SelectTrigger className="w-36" aria-label={textFor(field.label, locale)}><SelectValue /></SelectTrigger><SelectContent>{field.options.map((option) => <SelectItem key={option.value} value={String(option.value)}>{textFor(option.label, locale)}</SelectItem>)}</SelectContent></Select> : <Input key={`${shown.sceneId}:${field.key}:${currentValue}`} aria-label={textFor(field.label, locale)} type="number" min={field.min} max={field.max} step={field.step ?? "any"} defaultValue={currentValue} disabled={fieldDisabled} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} onBlur={(event) => {
      if (fieldDisabled) return;
      const value = event.currentTarget.valueAsNumber; if (!Number.isFinite(value)) { event.currentTarget.value = String(currentValue); return; }
      const rounded = field.step ? field.min + Math.round((value - field.min) / field.step) * field.step : value;
      setField(field.key, Math.min(field.max, Math.max(field.min, rounded)));
    }} />}</label>;
  };
  const switches = [{ key: "grid", label: { zh: "参考网格", en: "Reference grid" } }, { key: "measures", label: { zh: "数值与测量标记", en: "Values and measurements" } }, ...(definition.toggles ?? [])].filter((entry, index, all) => all.findIndex((item) => item.key === entry.key) === index);
  return <div className={workbenchStyles.workspace} {...controls.bindings} onKeyDown={handleKey} data-planar-tool={toolId} data-planar-scene={definition.id}>
    <div className={styles.viewport}><div className={workbenchStyles.canvas}>
      <svg ref={svg} className={styles.svg} viewBox="0 0 960 720" tabIndex={-1} aria-label={textFor(definition.title, locale)} data-drawing-tool={drawingTool ?? undefined} {...drag.handlers} onPointerDownCapture={(event) => {
        drag.handlers.onPointerDownCapture(event);
        if (event.isPropagationStopped() || !activeDrawingTool || activeDrawingTool.disabled?.(shown) || !writable || publishing || running || !frameIsExact) return;
        const matrix = svg.current?.getScreenCTM();
        const point = matrix && planePointFromClient({ x: event.clientX, y: event.clientY }, matrix);
        if (!point || !drag.start(event, { start: shown, target: "construction", source: snapshot, construction: { tool: activeDrawingTool.id, kind: activeDrawingTool.kind, points: draftPoints } })) return;
        beginSpatialObjectGesture(svg.current!); setDragging(true); setDraftInvalid(false);
        setDraftPreview(activeDrawingTool.kind === "points" ? [...draftPoints, point] : [point]);
        svg.current?.focus({ preventScroll: true });
      }} onClick={(event) => {
        if (event.target === event.currentTarget && !dragging && !drawingTool) { controls.onPointerMissed(event.nativeEvent); svg.current?.focus({ preventScroll: true }); }
      }}>
        <defs><pattern id={`${uid}-grid`} width="30" height="30" patternUnits="userSpaceOnUse"><path d="M 30 0 H 0 V 30" fill="none" stroke="var(--line)" strokeWidth="1" /></pattern></defs>
        {shown.flags.grid && <rect width="960" height="720" fill={`url(#${uid}-grid)`} pointerEvents="none" />}
        {definition.draw(shown, api)}
        {landing && !same(landing, shown) && <g className={styles.ghost} aria-hidden>{definition.draw(landing, inertApi)}</g>}
        {drawingTool && definition.construction?.preview(drawingTool, draftPreview ?? draftPoints, shown)}
      </svg>
      <div role="toolbar" aria-label={m("现场与设置", "Scene and settings")} className={`${workbenchStyles.dock} ${workbenchStyles.meta}`}>
        {scenes.length > 1 && <SpatialActionButton action="pieces" label={m("选择教学现场", "Choose a teaching scene")} active={controls.panel === "scenes"} onClick={() => togglePanel("scenes")} />}
        {!!definition.fields?.length && <SpatialActionButton action="dimensions" label={m("形状与准确参数", "Shape and precise parameters")} active={controls.panel === "parameters"} onClick={() => togglePanel("parameters")} />}
        <SpatialActionButton action="settings" label={m("显示设置", "Display settings")} active={controls.panel === "display"} onClick={() => togglePanel("display")} />
      </div>
      <div role="toolbar" aria-label={m("操作工具", "Teaching actions")} className={`${workbenchStyles.dock} ${workbenchStyles.tools}`}>
        {definition.construction && <SpatialActionButton action="drawShape" label={m("绘制图形", "Draw shape")} active={controls.panel === "construction"} disabled={!writable || publishing || running || !frameIsExact} onClick={() => togglePanel("construction")} />}
        {!!definition.materials?.length && <SpatialActionButton action="add" label={m("添加图形或生活实例", "Add a shape or everyday example")} active={controls.panel === "materials"} disabled={disabled || running || !frameIsExact} onClick={() => togglePanel("materials")} />}
        {definition.operations?.map((item) => <SpatialActionButton key={item.id} action={item.icon} label={textFor(item.label, locale)} active={activeOperation?.id === item.id} disabled={disabled || running || !frameIsExact} onClick={() => {
          cancelConstruction(); setOperation(item.id);
          if (activeOperation?.id === item.id) controls.closePanel(); else {
            controls.setPanel("operation");
            if (item.constructionTool) setDrawingTool(item.constructionTool);
          }
        }} />)}
        {definition.actions?.map((action) => <SpatialActionButton key={action.id} action={action.icon} label={textFor(action.label, locale)} active={action.active?.(shown)} disabled={disabled || running || !frameIsExact || action.disabled?.(shown, { selected })} onClick={() => execute(action)} />)}
        {authority.motion && planarProgress(authority.motion, now) < 1 && <>
          <SpatialActionButton action={running ? "pause" : "play"} label={running ? m("暂停过程", "Pause motion") : m("继续过程", "Resume motion")} disabled={disabled} onClick={() => publish(planarPause(authority, planarEventTime(), running))} />
          <SpatialActionButton action="stop" label={m("停在当前位置", "Stop at the current position")} disabled={disabled} onClick={stopAtFrame} />
        </>}
        <div className={workbenchStyles.toolSeparator} />
        <SpatialActionButton action="undo" label={m("撤销", "Undo")} disabled={disabled || running || !authority.past.length} onClick={() => publish(planarHistory(authority, "undo"))} />
        <SpatialActionButton action="redo" label={m("重做", "Redo")} disabled={disabled || running || !authority.future.length} onClick={() => publish(planarHistory(authority, "redo"))} />
        <SpatialActionButton action="reset" label={m("恢复备好的起点", "Restore the prepared starting scene")} disabled={disabled} onClick={() => { commit(prepared.current, undefined, frameIsExact ? frame : authority.current); setSelected(null); }} />
      </div>
      {controls.panel && <SpatialCanvasPanel title={controls.panel === "construction" ? m("绘制图形", "Draw shape") : activeOperation ? textFor(activeOperation.label, locale) : controls.panel === "materials" ? m("添加到当前舞台", "Add to this stage") : controls.panel === "scenes" ? m("教学现场", "Teaching scenes") : controls.panel === "parameters" ? m("形状与准确参数", "Shape and precise parameters") : m("显示设置", "Display settings")} anchor={["materials", "construction", "operation"].includes(controls.panel) ? "tool" : "meta"} closeLabel={m("关闭面板", "Close panel")} onClose={closePanel}>
        {controls.panel === "construction" && <div className={styles.gallery}>
          {definition.construction?.tools.map((tool) => <Button key={tool.id} variant={drawingTool === tool.id ? "secondary" : "ghost"} aria-pressed={drawingTool === tool.id} aria-label={`${m("绘制", "Draw ")}${textFor(tool.label, locale)}`} disabled={!writable || publishing || running || tool.disabled?.(shown)} onClick={() => {
            drag.cancel(); clearDraft(); setDrawingTool(drawingTool === tool.id ? null : tool.id); setSelected(null); svg.current?.focus({ preventScroll: true });
          }}>{textFor(tool.label, locale)}</Button>)}
        </div>}
        {activeOperation && <>
          {operationDrawingTool && <Button aria-pressed={drawingTool === operationDrawingTool.id} aria-label={`${m("绘制", "Draw ")}${textFor(operationDrawingTool.label, locale)}`} disabled={!writable || publishing || running || !frameIsExact || operationDrawingTool.disabled?.(shown)} onClick={() => {
            drag.cancel(); clearDraft(); setDrawingTool(drawingTool === operationDrawingTool.id ? null : operationDrawingTool.id); svg.current?.focus({ preventScroll: true });
          }}><SpatialActionIcon action={activeOperation.icon} className="size-4" />{textFor(operationDrawingTool.label, locale)}</Button>}
          {activeOperation.fields?.map(renderField)}
          <div className={styles.gallery}>{activeOperation.actions?.map((action) => <Button key={action.id} aria-label={textFor(action.label, locale)} disabled={disabled || running || !frameIsExact || action.disabled?.(shown, { selected })} onClick={() => execute(action)}><SpatialActionIcon action={action.icon} className="size-4" />{textFor(action.label, locale)}</Button>)}</div>
        </>}
        {activeDrawingTool && <>
          <p className={styles.hint}>{activeDrawingTool.hint ? textFor(activeDrawingTool.hint, locale) : activeDrawingTool.kind === "point" ? m("在舞台轻点放置；Esc 退出。", "Tap the stage to place; Esc exits.") : activeDrawingTool.kind === "points" ? m("依次点顶点，点回起点或点完成闭合；退格撤回一点，Esc 取消。", "Tap vertices, then the first vertex or Finish to close. Backspace removes one point; Esc cancels.") : activeDrawingTool.id === "circle" ? m("从圆心拖到圆周；松手完成，Esc 取消。", "Drag from the center to the circle boundary; release to finish, Esc to cancel.") : m("拖出两个对角点；松手完成，Esc 取消。", "Drag between two opposite corners; release to finish, Esc to cancel.")}</p>
          {activeDrawingTool.kind === "points" && <Button aria-label={m("完成绘制", "Finish drawing")} disabled={!writable || publishing || dragging || draftPoints.length < 3} onClick={() => finishConstruction(activeDrawingTool.id, draftPoints)}><SpatialActionIcon action="confirm" className="size-4" />{m("完成绘制", "Finish drawing")}</Button>}
          {draftInvalid && <p role="status" className={styles.hint}>{definition.construction?.invalidHint ? textFor(definition.construction.invalidHint, locale) : m("请调整顶点，围出不交叉且有面积的图形；也请检查材料数量是否已满。", "Adjust the points to enclose a non-crossing shape with area, and check the material limit.")}</p>}
        </>}
        {controls.panel === "materials" && materialGroups.map((group) => <section key={group.en} className={styles.materialGroup}>
          <h3>{textFor(group, locale)}</h3>
          <div className={styles.materials}>{definition.materials?.filter((material) => material.group.en === group.en).map((material) => <Button key={material.id} variant="ghost" aria-label={`${m("添加", "Add ")}${textFor(material.label, locale)}`} disabled={disabled || running || !frameIsExact || material.disabled?.(shown)} onClick={() => {
            if (commit(material.add(shown))) { if (!definition.selectionAfterChange) setSelected(null); controls.closePanel(); }
          }}><span aria-hidden>{material.preview}</span><span>{textFor(material.label, locale)}</span></Button>)}</div>
        </section>)}
        {controls.panel === "scenes" && <div className={styles.gallery}>{scenes.map((scene) => <Button key={scene.id} variant={scene.id === shown.sceneId ? "secondary" : "ghost"} disabled={disabled || running || !frameIsExact} onClick={() => { commit(scene.create()); setSelected(null); controls.closePanel(); }}>{textFor(scene.title, locale)}</Button>)}</div>}
        {controls.panel === "parameters" && definition.fields?.map(renderField)}
        {controls.panel === "display" && switches.map((flag) => <label className={styles.field} key={flag.key}>{textFor(flag.label, locale)}<Checkbox checked={!!shown.flags[flag.key]} disabled={disabled || running || !frameIsExact} onCheckedChange={(value) => commit(definition.setFlag?.(shown, flag.key, value === true) ?? { ...shown, flags: { ...shown.flags, [flag.key]: value === true } })} /></label>)}
        {definition.progress && controls.panel !== "scenes" && controls.panel !== "materials" && <label className={styles.progress}>{m("演示位置", "Demonstration progress")} {Math.round(shown.phase * 100)}%
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
