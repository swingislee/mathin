"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Dices, Droplets, Eye, Footprints, GitCompareArrows, Hand, LocateFixed, Maximize, Move, Move3D, Orbit, Paintbrush, Redo2, RotateCcw, ScanEye, ScanFace, Settings2, Shapes, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Axis } from "@/features/spatial-math/domain";
import { SpatialAxisSnapButton, useSpatialAxisSnap } from "@/features/spatial-math/renderer-r3f/SpatialCameraControls";
import { CubeCanvasPanel, CubeColorPicker, CubeIconButton, CubeViewIcon } from "./CubeWorkbenchControls";
import { CubeOpacitySlider } from "./CubeOpacitySlider";
import { CUBE_WORKBENCH_VIEWS } from "./cube-workbench-camera";
import { CUBE_COLORS, type CubeColor, type CubeFrame, type CubeView } from "./cube-structures-contract";
import { cubeStructuresMessages } from "./cube-structures-messages";
import { closeDiceFaces, diceFaceArrow, diceSurface, restoreDiceScene, styleDiceFaces, type DiceSurfaceStyle } from "./dice-teaching-display";
import { DiceFaceInspection } from "./DiceFaceInspection";
import { diceXRayDisplay, nextDiceXRayTarget, type DiceXRayTarget } from "./dice-xray-observation";
import { sameDiceXRayTarget, type DiceXRayPresentation } from "./dice-xray-animation";
import { useCubeNetPlayback } from "./useCubeNetPlayback";
import { diceTeachingMessages } from "./dice-teaching-messages";
import { commitDiceDrag } from "./dice-drag-adapter";
import type { CubeMoveOperation } from "./cube-structures-drag";
import { DICE_FACES, DICE_TEACHING_VERSION, FACE_NORMALS, MAX_DICE, arrangeDice, canPlaceDie, closeDieFaces, contactVisibility, controlledRoll, createDiceScene, createDie, diceContacts, faceValue, interpolateDice, isDiceFaceMoved, nearestDiceRotation, openDieFaces, oppositeFace, sampleControlledRoll, solveDicePuzzle, turnDie, worldFace, type DiceFace, type DiceHand, type DicePuzzle, type DiceScene, type DiceVector, type RollDirection, type TeachingDie } from "./dice-teaching-model";
import styles from "./CubeStructuresWorkbench.module.css";
import diceStyles from "./DiceTeachingWorkspace.module.css";
import type { DiceTeachingSnapshot } from "../courseware/spatial-teaching-content";
import { teachingRandom, type DiceLiveSnapshot, type DiceTeachingCommand, type TeachingWorkbenchPort } from "../courseware/workbench-classroom-contract";
import type { DiceThrow } from "./dice-physics";
type DiceInitial = DiceTeachingSnapshot & Partial<Pick<DiceLiveSnapshot, "xrayTarget" | "observation">>;

const DiceTeachingCanvas = dynamic(() => import("./DiceTeachingCanvas"), { ssr: false });
type Panel = "settings" | "arrange" | "pips" | "opposite" | "puzzle" | "roll" | "throwing" | "color" | "transparent" | "restore" | "observe" | null;
const easing = (t: number) => t * t * (3 - 2 * t);
const topOnly = (dice: TeachingDie[]) => dice.map((die) => ({ ...die, hidden: DICE_FACES.filter((face) => face !== worldFace(die, "y+")) }));
function fitFrame(dice: readonly TeachingDie[]): CubeFrame {
  const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
  dice.forEach((die) => {
    for (const axis of ["x", "y", "z"] as const) { min[axis] = Math.min(min[axis], die.position[axis] - 1.3); max[axis] = Math.max(max[axis], die.position[axis] + 1.3); }
    for (const face of DICE_FACES.filter((item) => isDiceFaceMoved(die, item))) {
      const point = diceFaceArrow(die, face, "").center;
      for (const axis of ["x", "y", "z"] as const) { min[axis] = Math.min(min[axis], point[axis] - 1); max[axis] = Math.max(max[axis], point[axis] + 1); }
    }
  });
  return { center: { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 }, radius: Math.max(2, (max.x - min.x) / 2, (max.y - min.y) / 2, (max.z - min.z) / 2) };
}
function Check({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <label className="flex items-center gap-2 text-xs"><Checkbox aria-label={label} checked={checked} disabled={disabled} onCheckedChange={(value) => onChange(value === true)} />{label}</label>;
}
function DiceActions({ items, busy }: { items: readonly { label: string; run: () => void; disabled?: boolean }[]; busy: boolean }) {
  return <div className="flex flex-wrap gap-1">{items.map((item) => <Button key={item.label} type="button" size="sm" variant="secondary" disabled={busy || item.disabled} onClick={item.run}>{item.label}</Button>)}</div>;
}
export default function DiceTeachingWorkspace({ locale, workspaceSelector, initial, onSnapshot, readOnly = false, courseware = false, classroom }: {
  locale: string; workspaceSelector?: ReactNode; initial?: DiceInitial;
  classroom?: TeachingWorkbenchPort<DiceLiveSnapshot, DiceTeachingCommand>;
  onSnapshot?: (snapshot: DiceTeachingSnapshot | null) => void; readOnly?: boolean; courseware?: boolean;
}) {
  const m = diceTeachingMessages(locale);
  const structureMessages = cubeStructuresMessages(locale === "en" ? "en" : "zh");
  const snap = useSpatialAxisSnap();
  const [moveAxis, setMoveAxis] = useState<Axis>("x");
  const [history, setHistory] = useState<{ past: DiceScene[]; present: DiceScene; future: DiceScene[] }>(() => ({ past: [], present: initial?.scene ?? createDiceScene(), future: [] }));
  const scene = history.present;
  const [selectedId, setSelectedId] = useState(initial?.selectedId ?? "dice-1");
  const selected = scene.dice.find((die) => die.id === selectedId) ?? scene.dice[0];
  const [panel, setPanel] = useState<Panel>(initial?.observation?.panel ?? null);
  const [tool, setTool] = useState<"orbit" | "pan" | "move" | "pips" | "color" | "transparent" | "inspect" | "xray">(initial?.xrayTarget ? "xray" : "orbit");
  const [xrayTarget, setXRayTarget] = useState<DiceXRayTarget | null>(initial?.xrayTarget ?? null);
  const [xrayPresentation, setXRayPresentation] = useState<DiceXRayPresentation>({ target: initial?.xrayTarget ?? null, phase: initial?.xrayTarget ? "open" : "closed" });
  const [color, setColor] = useState<CubeColor>(CUBE_COLORS[0]);
  const [surfaceScope, setSurfaceScope] = useState<"face" | "die">("face");
  const [surfaceTarget, setSurfaceTarget] = useState<{ id: string; face: DiceFace } | null>(null);
  const [opacityPreview, setOpacityPreview] = useState<number | null>(null);
  const [arrows, setArrows] = useState(initial?.arrows ?? false);
  const [inspectionFace, setInspectionFace] = useState<DiceFace>(initial?.observation?.face ?? "y+");
  const [grid, setGrid] = useState(initial?.grid ?? true), [axes, setAxes] = useState(initial?.axes ?? false), [floor, setFloor] = useState(initial?.floor ?? true);
  const [view, setView] = useState<CubeView | "bottom">(initial?.view ?? "angle");
  const [cameraKey, setCameraKey] = useState(0);
  const [frame, setFrame] = useState<CubeFrame>(() => initial?.frame ?? fitFrame(createDiceScene().dice));
  const [notice, setNotice] = useState("");
  const [leaveTrail, setLeaveTrail] = useState(true);
  const [onlyTopAfterThrow, setOnlyTopAfterThrow] = useState(true);
  const [scope, setScope] = useState<DicePuzzle["scope"]>("each");
  const [target, setTarget] = useState(7);
  const [pairFace, setPairFace] = useState<DiceFace>(initial?.observation?.pair ?? "y+");
  const [preparing, setPreparing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const request = useRef(0);
  const playback = useCubeNetPlayback<TeachingDie[]>({ essential: true, interactive: false });
  const cancelPlayback = playback.cancel;
  const busy = preparing || playback.playing;
  const capture = classroom?.capture;
  useEffect(() => {
    const snapshot = busy || dragging || opacityPreview !== null ? null : { scene, selectedId: selected.id, arrows, grid, axes, floor, view, frame };
    onSnapshot?.(snapshot);
    const xraySettled = sameDiceXRayTarget(xrayTarget, xrayPresentation.target) && xrayPresentation.phase === (xrayTarget ? "open" : "closed");
    capture?.(snapshot && xraySettled ? { ...snapshot, xrayTarget, observation: { panel: panel === "observe" || panel === "opposite" ? panel : null, face: inspectionFace, pair: pairFace } } : null, cameraKey);
  }, [onSnapshot, capture, busy, dragging, opacityPreview, scene, selected.id, arrows, grid, axes, floor, view, frame, xrayTarget, xrayPresentation, panel, inspectionFace, pairFace, cameraKey, classroom?.pending]);
  const selectedFace = surfaceTarget?.id === selected.id ? surfaceTarget.face : null;
  const surfaceFaces = surfaceScope === "die" ? DICE_FACES : selectedFace ? [selectedFace] : [];
  const opacity = Math.round(diceSurface(selected, selectedFace ?? "y+").opacity * 100);
  const displayed = opacityPreview !== null && !busy ? styleDiceFaces(scene.dice, selected.id, surfaceFaces, { opacity: opacityPreview / 100 }) : playback.frame ?? scene.dice;
  const xray = !busy ? diceXRayDisplay(displayed, xrayPresentation.target) : null;
  const commit = useCallback((next: DiceScene) => { setXRayTarget(null); setHistory((h) => ({ past: [...h.past, h.present].slice(-100), present: next, future: [] })); }, [setXRayTarget, setHistory]);
  const cancelClassroom = classroom?.cancel;
  const invalidateRequest = useCallback(() => { request.current++; }, []);
  const cancel = useCallback(() => { cancelClassroom?.(); request.current++; setPreparing(false); setXRayTarget(null); cancelPlayback(); }, [cancelPlayback, cancelClassroom, setPreparing, setXRayTarget]);
  useEffect(() => {
    const stop = (event: KeyboardEvent) => { if (event.key === "Escape") cancel(); };
    if (!readOnly) { window.addEventListener("keydown", stop); window.addEventListener("blur", cancel); }
    return () => { invalidateRequest(); window.removeEventListener("keydown", stop); window.removeEventListener("blur", cancel); };
  }, [cancel, readOnly, invalidateRequest]);
  const animateLocal = (next: DiceScene, duration = 650) => {
    if (busy) return;
    setXRayTarget(null);
    setNotice("");
    const from = scene.dice;
    playback.start({ durationMs: duration, sample: (elapsed) => interpolateDice(from, next.dice, easing(elapsed / duration)), onFinish: () => commit(next) });
  };
  const runCommand = (command: DiceTeachingCommand, execute: () => void | Promise<void>) => {
    const perform = () => { playback.seekFrom(null); return execute(); };
    if (classroom) classroom.command(command, perform); else void perform();
  };
  const animate = (next: DiceScene, duration = 650) => { if (!busy) runCommand({ kind: "tween", target: next, durationMs: duration }, () => animateLocal(next, duration)); };
  const applyXRay = (target: DiceXRayTarget | null) => { if (target) { setTool("xray"); setPanel(null); } setXRayTarget(target); };
  const requestXRay = (target: DiceXRayTarget | null) => {
    if (!sameDiceXRayTarget(target, xrayTarget)) runCommand({ kind: "xray", target }, () => applyXRay(target));
  };
  const changed = (dice: TeachingDie[], extra: Partial<DiceScene> = {}) => ({ ...scene, dice, puzzle: null, ...extra });
  const selectPanel = (next: Exclude<Panel, null>) => {
    const open = panel !== next;
    setPanel(open ? next : null);
    setTool(!open ? "orbit" : next === "arrange" ? "move" : next === "observe" ? "inspect" : ["pips", "color", "transparent"].includes(next) ? next as "pips" | "color" | "transparent" : "orbit");
    setNotice(""); setOpacityPreview(null); requestXRay(null);
  };
  const closePanel = () => { setPanel(null); setTool("orbit"); setOpacityPreview(null); requestXRay(null); };
  const navigate = (next: "orbit" | "pan") => { setTool(next); requestXRay(null); };
  const toggleXRay = () => {
    if (busy) return;
    setTool(tool === "xray" ? "orbit" : "xray"); requestXRay(null); setPanel(null);
    setNotice(""); setOpacityPreview(null);
  };
  const fit = (dice = scene.dice) => { const bounds = fitFrame(dice); setFrame({ ...bounds, radius: bounds.radius + (arrows ? 1 : 0) }); setCameraKey((key) => key + 1); };
  const selectView = (next: CubeView | "bottom") => { setView(next); setCameraKey((key) => key + 1); };
  const updateDie = (id: string, change: (die: TeachingDie) => TeachingDie, geometric = false) => {
    const next = { ...scene, dice: scene.dice.map((die) => die.id === id ? change(die) : die), puzzle: geometric ? null : scene.puzzle };
    if (geometric) animate(next); else commit(next);
  };
  const place = (id: string, position: DiceVector) => {
    if (busy) return;
    if (!canPlaceDie(scene.dice, id, position)) { setNotice(m.placeBlocked); return; }
    updateDie(id, (die) => ({ ...die, position, rotation: nearestDiceRotation(die.rotation) }), true);
  };
  const dragCommit = (operation: CubeMoveOperation) => {
    if (busy) return;
    const next = commitDiceDrag(scene, operation);
    if (!next) { setNotice(m.placeBlocked); return; }
    setNotice(""); commit(next);
  };
  const add = (hand: DiceHand) => {
    if (busy || scene.dice.length >= MAX_DICE) return;
    const id = `dice-${scene.nextId}`;
    let position: DiceVector | null = null;
    for (let z = 0; z <= 5 && !position; z++) for (let x = -4; x <= 4 && !position; x++) if (canPlaceDie(scene.dice, id, { x, y: 0.5, z })) position = { x, y: 0.5, z };
    if (!position) { setNotice(m.placeBlocked); return; }
    const dice = [...scene.dice, createDie(id, hand, position)]; commit(changed(dice, { nextId: scene.nextId + 1 })); setSelectedId(id); fit(dice);
  };
  const arrange = (layout: "row" | "stack" | "corner" | "apart") => {
    const dice = arrangeDice(scene.dice, layout); animate(changed(dice, { trail: [] })); fit(dice);
  };
  const toggleFace = (id: string, face: DiceFace) => {
    if (!busy) updateDie(id, (die) => ({ ...die, hidden: die.hidden.includes(face) ? die.hidden.filter((item) => item !== face) : [...die.hidden, face] }));
  };
  const applyStyle = (style: DiceSurfaceStyle) => { if (!busy && surfaceFaces.length) commit({ ...scene, dice: styleDiceFaces(scene.dice, selected.id, surfaceFaces, style) }); };
  const chooseFace = (id: string, face: DiceFace) => {
    if (busy) return;
    if (tool === "xray") { requestXRay(nextDiceXRayTarget(xrayTarget, { id, face })); return; }
    setSurfaceTarget({ id, face }); setOpacityPreview(null);
    if (tool === "inspect") setInspectionFace(face);
    if (tool === "pips") toggleFace(id, face);
    if (tool === "color") commit({ ...scene, dice: styleDiceFaces(scene.dice, id, surfaceScope === "die" ? DICE_FACES : [face], { color }) });
  };
  const inspect = (id: string, face: DiceFace) => { setSelectedId(id); setInspectionFace(face); setPanel("observe"); setTool("inspect"); requestXRay(null); setOpacityPreview(null); setNotice(""); };
  const openFaces = (id: string, faces: readonly DiceFace[]) => {
    if (busy) return;
    const dice = scene.dice.map((die) => die.id === id ? openDieFaces(die, faces) : die);
    if (dice.some((die, index) => die !== scene.dice[index])) animate({ ...scene, dice }, 850);
  };
  const moveFace = (id: string, face: DiceFace) => {
    const die = scene.dice.find((item) => item.id === id);
    if (!die || busy) return;
    if (isDiceFaceMoved(die, face)) animate({ ...scene, dice: scene.dice.map((item) => item.id === id ? closeDieFaces(item, [face]) : item) }, 850);
    else openFaces(id, [face]);
  };
  const movePair = () => openFaces(selected.id, [pairFace, oppositeFace(pairFace)]);
  const closeFaces = () => animate({ ...scene, dice: scene.dice.map((die) => die.id === selected.id ? closeDieFaces(die) : die) }, 850);
  const toggleArrows = () => {
    if (busy) return;
    if (tool === "xray") { setTool("orbit"); requestXRay(null); setArrows(true); return; }
    setArrows((value) => !value);
  };
  const rollLocal = (id: string, direction: RollDirection, trail: boolean) => {
    const next = controlledRoll(scene, id, direction, trail);
    if (!next) { setNotice(m.rollBlocked); return; }
    setNotice("");
    playback.start({ durationMs: 700, sample: (elapsed) => scene.dice.map((die) => die.id === id ? sampleControlledRoll(die, direction, easing(elapsed / 700)) : die), onFinish: () => commit(next) });
  };
  const roll = (direction: RollDirection) => { if (!busy) runCommand({ kind: "roll", id: selected.id, direction, trail: leaveTrail }, () => rollLocal(selected.id, direction, leaveTrail)); };
  const generatePuzzle = () => {
    if (busy) return;
    const solution = solveDicePuzzle(scene.dice, scope, target);
    if (!solution.ok) { setNotice(solution.reason === "no-contacts" ? m.noContacts : solution.reason === "search-limit" ? m.searchLimit : m.impossible); return; }
    animate({ ...scene, dice: solution.dice, puzzle: { scope, target, revealed: false } });
  };
  const revealPuzzle = () => {
    if (!scene.puzzle) return;
    const revealed = !scene.puzzle.revealed;
    commit({ ...scene, dice: contactVisibility(scene.dice, !revealed), puzzle: { ...scene.puzzle, revealed } });
  };
  const preparedThrow = useRef<{ seed: number; result: DiceThrow } | null>(null);
  const playThrow = async (command: Extract<DiceTeachingCommand, { kind: "throw" }>) => {
    const token = ++request.current;
    setNotice(""); setPreparing(true); setXRayTarget(null);
    try {
      const { simulateDiceThrow, sampleDiceThrow } = await import("./dice-physics");
      const result = preparedThrow.current?.seed === command.seed ? preparedThrow.current.result
        : await simulateDiceThrow(scene.dice, teachingRandom(command.seed), () => request.current !== token);
      preparedThrow.current = null;
      if (request.current !== token) return;
      setPreparing(false); setFrame({ center: { x: 0, y: 0.7, z: 0 }, radius: 6.5 }); setCameraKey((key) => key + 1);
      playback.start({ durationMs: command.durationMs, sample: (elapsed) => elapsed < 400 ? interpolateDice(scene.dice, result.frames[0], easing(elapsed / 400))
        : sampleDiceThrow(result, (elapsed - 400) * result.durationMs / Math.max(1, command.durationMs - 400)),
      onFinish: () => { commit(command.target); if (!command.settled) setNotice(m.cocked); } });
    } catch {
      // 物理表现加载失败时仍采用教师权威结果，不在展示端重新抽点数。
      if (request.current === token) { setPreparing(false); commit(command.target); setNotice(m.throwFailed); }
    }
  };
  const executeCommand = (command: DiceTeachingCommand) => {
    switch (command.kind) {
      case "tween": animateLocal(command.target, command.durationMs); break;
      case "roll": rollLocal(command.id, command.direction, command.trail); break;
      case "throw": return playThrow(command);
      case "xray": applyXRay(command.target); break;
    }
  };
  const replayed = useRef<unknown>(null);
  useEffect(() => {
    if (classroom?.replay && replayed.current !== classroom.replay) {
      replayed.current = classroom.replay; playback.seekFrom(classroom.replay.startedAt); void executeCommand(classroom.replay.command);
    }
  });
  const throwDice = async () => {
    if (busy) return;
    const token = ++request.current, before = scene;
    setNotice(""); setPreparing(true);
    try {
      const { simulateDiceThrow } = await import("./dice-physics");
      const seed = Math.floor(Math.random() * 0x100000000);
      const result = await simulateDiceThrow(before.dice, teachingRandom(seed), () => request.current !== token);
      if (request.current !== token) return;
      const finalDice = result.frames[result.frames.length - 1];
      const next = { ...before, dice: onlyTopAfterThrow ? topOnly(finalDice) : finalDice, puzzle: null, trail: [] };
      preparedThrow.current = { seed, result };
      const command: Extract<DiceTeachingCommand, { kind: "throw" }> = { kind: "throw", seed, target: next, durationMs: result.durationMs + 400, settled: result.settled };
      runCommand(command, () => playThrow(command));
    } catch { if (request.current === token) { setPreparing(false); setNotice(m.throwFailed); } }
  };
  const diePicker = <div className="space-y-2"><p className="text-xs text-muted">{m.selected}</p><div className="flex flex-wrap gap-1">{scene.dice.map((die) => <Button key={die.id} type="button" size="sm" variant={selected.id === die.id ? "secondary" : "ghost"} disabled={busy} onClick={() => setSelectedId(die.id)} title={`${m.die} ${die.id.replace("dice-", "")} · ${m[die.hand]}`}>
    {die.id.replace("dice-", "")} · {m[die.hand]}
  </Button>)}</div></div>;
  const pairValue = (face: DiceFace) => selected.hidden.includes(face) ? "?" : String(faceValue(selected.hand, face));
  const worldFaces = DICE_FACES.map((direction) => ({ direction, face: worldFace({ ...selected, rotation: nearestDiceRotation(selected.rotation) }, direction) }));
  return <section className={styles.workspace} data-dice-teaching={DICE_TEACHING_VERSION} data-workbench-mode={courseware ? "courseware" : undefined} inert={readOnly || classroom?.pending}>
    <div className={styles.viewport}><div className={`${styles.canvas} ${diceStyles.canvas}`} data-dice-stage>
      <DiceTeachingCanvas dice={displayed} trail={scene.trail} selectedId={selected.id} locale={locale} tool={tool} arrows={arrows} busy={busy} grid={grid} axes={axes} floor={floor} frame={frame} view={view} cameraKey={cameraKey}
        xrayTarget={xrayTarget} initialXRayTarget={initial?.xrayTarget} onClearXRay={() => requestXRay(null)} onXRayPresentation={setXRayPresentation}
        snap={snap} moveAxis={moveAxis} onMoveAxis={setMoveAxis} onDragCommit={dragCommit} onDraggingChange={setDragging} onMoveUnavailable={() => setNotice(structureMessages.moveAxisHidden)}
        onSelect={setSelectedId} onFace={chooseFace} onMoveFace={moveFace} />
      <div className={`${styles.dock} ${styles.meta}`} data-dice-overlay><CubeIconButton label={m.settings} active={panel === "settings"} onClick={() => selectPanel("settings")}><Settings2 /></CubeIconButton><span className="self-center pr-1 text-xs">{m.title}</span></div>
      <div className={`${styles.dock} ${styles.views} ${diceStyles.views}`} role="toolbar" aria-label={m.orbit}>
        {CUBE_WORKBENCH_VIEWS.map((item) => <CubeIconButton key={item} label={m.views[item]} active={view === item} onClick={() => selectView(item)}><CubeViewIcon view={item} /></CubeIconButton>)}
        <CubeIconButton label={m.bottom} active={view === "bottom"} onClick={() => selectView("bottom")}><CubeViewIcon view="bottom" /></CubeIconButton><CubeIconButton label={m.fit} onClick={() => fit()}><Maximize /></CubeIconButton>
        <SpatialAxisSnapButton messages={tool === "move" ? { axisSnap: structureMessages.cellSnap, enableAxisSnap: structureMessages.enableCellSnap, disableAxisSnap: structureMessages.disableCellSnap } : m} iconOnly className={styles.icon} disabled={busy} />
      </div>
      <div className={`${styles.dock} ${styles.tools}`} role="toolbar" aria-label={m.tools}>
        <CubeIconButton label={m.orbit} active={tool === "orbit"} onClick={() => navigate("orbit")}><Orbit /></CubeIconButton>
        <CubeIconButton label={m.pan} active={tool === "pan"} onClick={() => navigate("pan")}><Hand /></CubeIconButton>
        <CubeIconButton label={m.xray} active={tool === "xray"} disabled={busy} onClick={toggleXRay}><ScanEye /></CubeIconButton>
        <CubeIconButton label={m.reset} disabled={busy} onClick={() => { arrange("apart"); setView("angle"); }}><LocateFixed /></CubeIconButton>
        <CubeIconButton label={m.arrange} active={panel === "arrange"} onClick={() => selectPanel("arrange")}><Move /></CubeIconButton>
        <CubeIconButton label={m.arrows} active={arrows && tool !== "xray"} disabled={busy} onClick={toggleArrows}><Move3D /></CubeIconButton>
        <CubeIconButton label={m.observe} active={panel === "observe"} onClick={() => selectPanel("observe")}><ScanFace /></CubeIconButton>
        <CubeIconButton label={m.restore} active={panel === "restore"} onClick={() => selectPanel("restore")}><RotateCcw /></CubeIconButton>
        <div className={styles.toolSeparator} />
        <CubeIconButton label={m.pips} active={panel === "pips"} onClick={() => selectPanel("pips")}><Eye /></CubeIconButton>
        <CubeIconButton label={m.color} active={panel === "color"} onClick={() => selectPanel("color")}><Paintbrush /></CubeIconButton>
        <CubeIconButton label={m.transparent} active={panel === "transparent"} onClick={() => selectPanel("transparent")}><Droplets /></CubeIconButton>
        <CubeIconButton label={m.opposite} active={panel === "opposite"} onClick={() => selectPanel("opposite")}><GitCompareArrows /></CubeIconButton>
        <CubeIconButton label={m.puzzle} active={panel === "puzzle"} onClick={() => selectPanel("puzzle")}><Shapes /></CubeIconButton>
        <div className={styles.toolSeparator} />
        <CubeIconButton label={m.roll} active={panel === "roll"} onClick={() => selectPanel("roll")}><Footprints /></CubeIconButton>
        <CubeIconButton label={m.throwing} active={panel === "throwing"} onClick={() => selectPanel("throwing")}><Dices /></CubeIconButton>
        <div className={styles.toolSeparator} />
        <CubeIconButton label={m.undo} disabled={busy || !history.past.length} onClick={() => { setXRayTarget(null); setHistory((h) => ({ past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] })); }}><Undo2 /></CubeIconButton>
        <CubeIconButton label={m.redo} disabled={busy || !history.future.length} onClick={() => { setXRayTarget(null); setHistory((h) => ({ past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) })); }}><Redo2 /></CubeIconButton>
      </div>
      {panel && <CubeCanvasPanel title={m[panel]} closeLabel={m.close} onClose={closePanel} anchor={panel === "settings" ? "meta" : panel === "roll" ? "bottom" : "tool"}>
        <div className="space-y-3 text-xs">
          {panel === "settings" ? <>{workspaceSelector}<div className="space-y-2"><Check label={m.floor} checked={floor} onChange={setFloor} /><Check label={m.grid} checked={grid} onChange={setGrid} /><Check label={m.axes} checked={axes} onChange={setAxes} /></div>{!courseware && <p className="leading-5 text-muted">{m.memory}</p>}</>
            : panel === "roll" ? <div className={diceStyles.rollDock}>
              <Select value={selected.id} disabled={busy} onValueChange={setSelectedId}><SelectTrigger aria-label={m.selected} className="h-9 w-auto min-w-28"><SelectValue /></SelectTrigger><SelectContent>{scene.dice.map((die) => <SelectItem key={die.id} value={die.id}>{m.die} {die.id.replace("dice-", "")} · {m[die.hand]}</SelectItem>)}</SelectContent></Select>
              <div className={diceStyles.rollButtons}>{([{ direction: "x-", label: m.rollLeft, icon: <ArrowLeft /> }, { direction: "z-", label: m.rollBack, icon: <ArrowUp /> }, { direction: "z+", label: m.rollForward, icon: <ArrowDown /> }, { direction: "x+", label: m.rollRight, icon: <ArrowRight /> }] as const).map((item) => <Button key={item.direction} size="sm" variant="secondary" disabled={busy} title={item.label} aria-label={item.label} onClick={() => roll(item.direction)}>{item.icon}{item.direction[1]}{item.direction[0].toUpperCase()}</Button>)}</div>
              <Check label={m.trail} checked={leaveTrail} onChange={setLeaveTrail} disabled={busy} />
              <DiceActions busy={busy} items={[{ label: m.clearTrail, run: () => commit({ ...scene, trail: [] }), disabled: !scene.trail.length }, { label: m.gridReady, run: () => arrange("apart") }]} />
              <p className="w-full text-muted">{m.rollHint}</p>
            </div> : <>
              {diePicker}
              {panel === "observe" && <>
                <p className="text-muted leading-5">{m.observationHint}</p>
                <div className="grid grid-cols-2 gap-1">{worldFaces.map(({ direction, face }) => <Button key={direction} size="sm" variant={face === inspectionFace ? "secondary" : "ghost"} aria-pressed={face === inspectionFace} disabled={busy || !face} onClick={() => face && setInspectionFace(face)}>{m.faces[direction]}</Button>)}</div>
                <DiceFaceInspection die={selected} face={inspectionFace} locale={locale} label={m.faces[worldFaces.find((item) => item.face === inspectionFace)?.direction ?? inspectionFace]} />
                <div className="flex flex-wrap gap-1"><Button size="sm" variant="secondary" disabled={busy} onClick={() => moveFace(selected.id, inspectionFace)}>{isDiceFaceMoved(selected, inspectionFace) ? m.returnOneFace : m.moveOneFace}</Button><Button size="sm" variant="secondary" disabled={busy} onClick={() => toggleFace(selected.id, inspectionFace)}>{selected.hidden.includes(inspectionFace) ? m.revealOneFace : m.hideOneFace}</Button></div>
              </>}
              {panel === "restore" && <><p className="leading-5 text-muted">{m.restoreHint}</p><DiceActions busy={busy} items={[{ label: m.closeFaces, run: closeFaces }, { label: m.closeAllFaces, run: () => animate(closeDiceFaces(scene)) }, { label: m.restoreScene, run: () => { const next = restoreDiceScene(scene); animate(next); fit(next.dice); setView("angle"); } }]} />{classroom && <Button size="sm" variant="secondary" disabled={busy} onClick={classroom.reset} data-teaching-reset>{classroom.resetLabel ?? m.restoreScene}</Button>}</>}
              {(panel === "color" || panel === "transparent") && <>
                <p className="leading-5 text-muted">{panel === "color" ? m.colorHint : m.transparentHint}</p>
                <div className="flex gap-1" role="group" aria-label={m.surfaceScope}>{(["face", "die"] as const).map((scope) => <Button key={scope} size="sm" variant={surfaceScope === scope ? "secondary" : "ghost"} disabled={busy} aria-pressed={surfaceScope === scope} onClick={() => { setSurfaceScope(scope); setOpacityPreview(null); }}>{scope === "face" ? m.oneFace : m.wholeDie}</Button>)}</div>
                <div className="grid grid-cols-2 gap-1">{worldFaces.map(({ direction, face }) => <Button key={direction} size="sm" variant={selectedFace === face ? "secondary" : "ghost"} disabled={busy || !face} aria-pressed={selectedFace === face} onClick={() => face && chooseFace(selected.id, face)}>{m.faces[direction]}</Button>)}</div>
                {surfaceScope === "face" && !selectedFace && <p className="text-muted">{m.chooseFace}</p>}
                {panel === "color" ? <><CubeColorPicker value={color} labels={cubeStructuresMessages(locale === "en" ? "en" : "zh").colors} label={m.color} disabled={busy} onChange={(value) => { setColor(value); applyStyle({ color: value }); }} /><DiceActions busy={busy} items={[{ label: m.white, disabled: !surfaceFaces.length, run: () => applyStyle({ color: undefined }) }]} /></>
                  : <><CubeOpacitySlider key={`${selected.id}:${selectedFace}:${surfaceScope}:${opacity}`} value={opacity} label={m.opacity} disabled={busy || !surfaceFaces.length} onPreview={setOpacityPreview} onCommit={(value) => applyStyle({ opacity: value / 100 })} /><DiceActions busy={busy} items={[{ label: m.opaque, disabled: !surfaceFaces.length, run: () => applyStyle({ opacity: 1 }) }]} /></>}
              </>}
              {panel === "arrange" && <><p className="text-muted leading-5">{m.dragHint}</p><DiceActions busy={busy} items={[{ label: m.addRight, run: () => add("right"), disabled: scene.dice.length >= MAX_DICE }, { label: m.addLeft, run: () => add("left"), disabled: scene.dice.length >= MAX_DICE }, { label: m.remove, run: () => { commit(changed(scene.dice.filter((die) => die.id !== selected.id))); }, disabled: scene.dice.length <= 1 }]} />
                <div className="flex items-center gap-1" role="group" aria-label={structureMessages.moveAxis}><span className="mr-1">{structureMessages.moveAxis}</span>{(["x", "y", "z"] as const).map((axis) => <Button key={axis} size="sm" variant={moveAxis === axis ? "secondary" : "ghost"} disabled={busy} aria-pressed={moveAxis === axis} onClick={() => setMoveAxis(axis)}>{axis.toUpperCase()}</Button>)}</div>
                <DiceActions busy={busy} items={(["row", "stack", "corner", "apart"] as const).map((layout) => ({ label: m[layout], run: () => arrange(layout) }))} />
                <p>{m.move}</p><DiceActions busy={busy} items={DICE_FACES.map((face) => ({ label: `${face[1]}${face[0].toUpperCase()}`, run: () => { const d = FACE_NORMALS[face]; place(selected.id, { x: selected.position.x + d.x, y: selected.position.y + d.y, z: selected.position.z + d.z }); } }))} />
                <p>{m.turn}</p><DiceActions busy={busy} items={(["x", "y", "z"] as const).map((axis) => ({ label: `${axis.toUpperCase()} ↻`, run: () => updateDie(selected.id, (die) => turnDie(die, axis), true) }))} />
              </>}
              {panel === "pips" && <><p className="leading-5 text-muted">{m.pipHint}</p><div className="grid grid-cols-2 gap-1">{worldFaces.map(({ direction, face }) => <Button key={direction} variant="secondary" size="sm" disabled={busy || !face} aria-pressed={face ? !selected.hidden.includes(face) : false} onClick={() => face && toggleFace(selected.id, face)}>{m.faces[direction]} · {face && !selected.hidden.includes(face) ? faceValue(selected.hand, face) : "?"}</Button>)}</div>
                <DiceActions busy={busy} items={[{ label: m.showAll, run: () => commit({ ...scene, dice: scene.dice.map((die) => ({ ...die, hidden: [] })) }) }, { label: m.hideAll, run: () => commit({ ...scene, dice: scene.dice.map((die) => ({ ...die, hidden: [...DICE_FACES] })) }) }, { label: m.topOnly, run: () => commit({ ...scene, dice: topOnly(scene.dice) }) }]} />
              </>}
              {panel === "opposite" && <><p className="leading-5 text-muted">{m.pairHint}</p><div className="grid grid-cols-2 gap-1">{worldFaces.map(({ direction, face }) => <Button key={direction} size="sm" variant={face === pairFace ? "secondary" : "ghost"} disabled={busy || !face} onClick={() => face && setPairFace(face)}>{m.faces[direction]}</Button>)}</div>
                <p className="text-center text-lg tabular-nums">{pairValue(pairFace)} + {pairValue(oppositeFace(pairFace))} = 7</p>
                <Button size="sm" variant="secondary" disabled={busy} onClick={movePair}>{m.revealPair}</Button>
                <DiceActions busy={busy} items={[{ label: m.showPair, run: () => updateDie(selected.id, (die) => ({ ...die, hidden: die.hidden.filter((face) => face !== pairFace && face !== oppositeFace(pairFace)) })) }, { label: m.closeFaces, run: closeFaces }]} />
              </>}
              {panel === "puzzle" && <><p className="leading-5 text-muted">{m.puzzleHint}</p><DiceActions busy={busy} items={(["row", "stack", "corner"] as const).map((layout) => ({ label: m[layout], run: () => arrange(layout) }))} />
                <Select value={scope} disabled={busy} onValueChange={(value) => setScope(value as DicePuzzle["scope"])}><SelectTrigger aria-label={m.contactClue} className="h-9 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="each">{m.each}</SelectItem><SelectItem value="total">{m.total}</SelectItem></SelectContent></Select>
                <label className="flex items-center gap-2">{m.target}<Input type="number" min={2} max={144} step={1} value={target} disabled={busy} onChange={(event) => setTarget(Number(event.target.value))} className="h-8 w-20 px-2 py-1" /></label>
                <DiceActions busy={busy} items={[{ label: m.generate, run: generatePuzzle }, { label: scene.puzzle?.revealed ? m.hideAnswer : m.reveal, run: revealPuzzle, disabled: !scene.puzzle }]} />
                {scene.puzzle && <p>{m[scene.puzzle.scope]} = {scene.puzzle.target}</p>}
                {scene.puzzle?.revealed && <div className="space-y-1">{diceContacts(scene.dice).map((contact) => <p key={`${contact.a}:${contact.b}`}>{m.die} {contact.a.replace("dice-", "")} ↔ {contact.b.replace("dice-", "")}：{contact.valueA} + {contact.valueB} = {contact.valueA + contact.valueB}</p>)}</div>}
              </>}
              {panel === "throwing" && <><p className="leading-5 text-muted">{m.throwHint}</p><DiceActions busy={busy} items={[{ label: m.addRight, run: () => add("right"), disabled: scene.dice.length >= MAX_DICE }, { label: m.addLeft, run: () => add("left"), disabled: scene.dice.length >= MAX_DICE }]} /><Check label={m.topAfterThrow} checked={onlyTopAfterThrow} onChange={setOnlyTopAfterThrow} disabled={busy} /><Button disabled={busy} onClick={() => { void throwDice(); }} className="w-full"><Dices className="mr-2 size-4" />{m.throwNow}</Button><DiceActions busy={busy} items={[{ label: m.showAll, run: () => commit({ ...scene, dice: scene.dice.map((die) => ({ ...die, hidden: [] })) }) }]} /></>}
            </>}
        </div>
      </CubeCanvasPanel>}
      {(notice || busy) && <div className={styles.notice} role="status" data-dice-overlay>{preparing ? m.preparing : playback.playing ? m.animating : notice}{busy ? <Button variant="ghost" size="sm" onClick={cancel}>{m.cancel}</Button> : <Button variant="ghost" size="sm" onClick={() => setNotice("")}>{m.close}</Button>}</div>}
      {(tool === "xray" || xray) && !busy && !panel && <div className={`${styles.cutStatus} ${diceStyles.xrayStatus}`} role="status" data-dice-overlay data-dice-xray={xray ? xrayPresentation.phase : "ready"}>
        <p className="font-medium">{xray ? `${xrayPresentation.phase === "opening" ? m.xrayOpening : xrayPresentation.phase === "closing" ? m.xrayClosing : m.xrayActive} · ${m.die} ${xray.die.id.replace("dice-", "")} · ${m.faces[xray.direction]}` : m.xray}</p>
        <p className="text-muted">{xray ? m.xrayExitHint : m.xrayHint}</p>
        {xray && <div className="mt-1 flex gap-1"><Button size="sm" variant="secondary" onClick={() => inspect(xray.die.id, xray.face)}>{m.observe}</Button><Button size="sm" variant="ghost" onClick={() => requestXRay(null)}>{m.xrayClear}</Button></div>}
      </div>}
      {!panel && !busy && tool !== "xray" && !xray && scene.puzzle && <p className={styles.cutStatus}>{m[scene.puzzle.scope]} = {scene.puzzle.target}</p>}
    </div></div>
  </section>;
}
