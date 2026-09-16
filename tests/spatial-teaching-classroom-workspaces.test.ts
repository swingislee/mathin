// @vitest-environment jsdom
import { act, createElement, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import DiceWorkspace from "@/features/tools/spatial-lab/DiceTeachingWorkspace";
import { CubeNetFoldWorkspace } from "@/features/tools/spatial-lab/CubeNetFoldWorkspace";
import type DiceCanvas from "@/features/tools/spatial-lab/DiceTeachingCanvas";
import type { CubeNetFoldViewport } from "@/features/tools/spatial-lab/CubeNetFoldViewport";
import { useTeachingWorkbench } from "@/features/tools/courseware/useTeachingWorkbench";
import { diceWorkbenchStateSchema, netWorkbenchStateSchema, type DiceLiveSnapshot, type DiceTeachingCommand, type NetLiveSnapshot, type NetTeachingCommand, type TeachingWorkbenchState } from "@/features/tools/courseware/workbench-classroom-contract";
import { controlledRoll, type TeachingDie } from "@/features/tools/spatial-lab/dice-teaching-model";
import { diceTeachingMessages } from "@/features/tools/spatial-lab/dice-teaching-messages";
import { buildNet, diceTool, legalNetEntries, netTool } from "./fixtures/spatial-teaching-content";
import { analyzePolyhedronTopology } from "@/features/spatial-math/domain";

type DiceState = TeachingWorkbenchState<DiceLiveSnapshot, DiceTeachingCommand>;
type NetState = TeachingWorkbenchState<NetLiveSnapshot, NetTeachingCommand>;
const canvases = vi.hoisted(() => ({ dice: null as ComponentProps<typeof DiceCanvas> | null, net: null as ComponentProps<typeof CubeNetFoldViewport> | null }));
const simulate = vi.hoisted(() => vi.fn());
vi.mock("./../src/features/tools/spatial-lab/dice-physics", () => ({
  simulateDiceThrow: simulate,
  sampleDiceThrow: (result: { frames: TeachingDie[][] }) => result.frames[0],
}));
vi.mock("next/dynamic", () => ({ default: (loader: () => unknown) => {
  const dice = String(loader).includes("DiceTeachingCanvas");
  return function CanvasStub(props: ComponentProps<typeof DiceCanvas> & ComponentProps<typeof CubeNetFoldViewport>) { if (dice) canvases.dice = props; else canvases.net = props; return null; };
} }));
let host: HTMLDivElement, root: Root, time: number, frameId: number;
const frames = new Map<number, FrameRequestCallback>();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  canvases.dice = null; canvases.net = null; time = 0; frameId = 0; frames.clear(); simulate.mockReset();
  simulate.mockImplementation(async (dice: TeachingDie[], random: () => number) => ({
    frames: [dice, dice.map((die) => ({ ...die, position: { ...die.position, z: random() * 3 } }))], durationMs: 800, settled: true,
  }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function mount(child: ReturnType<typeof createElement>) {
  // eslint-disable-next-line react/no-children-prop
  await act(async () => { root.render(createElement(NextIntlClientProvider, { locale: "en", messages: en, timeZone: "UTC", children: child })); });
}
async function tick(ms: number) {
  time += ms;
  await act(async () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback(time)); });
}
async function finish() { await tick(0); await tick(30_000); await tick(0); await tick(30_000); }
async function click(label: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.getAttribute("aria-label") === label || node.textContent === label);
  expect(button, label).toBeDefined(); await act(async () => button!.click());
}
const initialDice = (): DiceLiveSnapshot => ({ ...diceTool().payload.initial, xrayTarget: null, observation: { panel: null, face: "y+", pair: "y+" } });
async function diceRig(initial = initialDice(), incoming?: DiceState, writer = true) {
  const sent: DiceState[] = []; let replace!: (next: DiceState) => void;
  function Harness() {
    const [state, setState] = useState(incoming); replace = setState;
    const host = useTeachingWorkbench(initial, { state, onChange: writer ? async (next) => { diceWorkbenchStateSchema.parse(next); sent.push(next); setState(next); } : undefined });
    return createElement(DiceWorkspace, { key: host.key, locale: "en", initial: host.initial, readOnly: !writer, classroom: host.port, courseware: true });
  }
  await mount(createElement(Harness));
  return { sent, replace: (next: DiceState) => act(async () => replace(next)) };
}
async function netRig(initial: NetLiveSnapshot, incoming?: NetState, writer = true) {
  const sent: NetState[] = []; let replace!: (next: NetState) => void;
  function Harness() {
    const [state, setState] = useState(incoming); replace = setState;
    const host = useTeachingWorkbench(initial, { state, onChange: writer ? async (next) => { netWorkbenchStateSchema.parse(next); sent.push(next); setState(next); } : undefined });
    return createElement(CubeNetFoldWorkspace, { key: host.key, locale: "en", initial: host.initial, readOnly: !writer, classroom: host.port, courseware: true });
  }
  await mount(createElement(Harness));
  await vi.waitFor(async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); expect(canvases.net).not.toBeNull(); });
  return { sent, replace: (next: NetState) => act(async () => replace(next)) };
}

describe("original workbenches with the shared classroom port", () => {
  it("syncs a stable dice drag once without repeating its animation, and animates normal face displacement", async () => {
    const initial = initialDice(), rig = await diceRig(initial), die = initial.scene.dice[0];
    expect(rig.sent).toHaveLength(0);
    await act(async () => canvases.dice!.onDraggingChange!(true));
    await act(async () => canvases.dice!.onDragCommit({ kind: "move", ids: [die.id], axis: "z", distance: 2 }));
    expect(rig.sent).toHaveLength(0);
    await act(async () => canvases.dice!.onDraggingChange!(false));
    expect(rig.sent).toHaveLength(1); expect(rig.sent[0].motion).toBeNull(); expect(frames.size).toBe(0);
    expect(canvases.dice!.dice[0].position.z).toBe(die.position.z + 2);
    await act(async () => canvases.dice!.onMoveFace(die.id, "y-"));
    expect(rig.sent).toHaveLength(2); expect(rig.sent[1].motion?.command.kind).toBe("tween");
    await tick(0); await tick(400);
    expect(canvases.dice!.dice[0].offsets["y-"]).toBeGreaterThan(0);
    expect(canvases.dice!.dice[0].offsets["y-"]).toBeLessThan(0.9);
    expect(rig.sent).toHaveLength(2);
    await finish(); expect(rig.sent).toHaveLength(3); expect(rig.sent[2].settles).toBe(rig.sent[1].id);
    expect(canvases.dice!.dice[0].offsets["y-"]).toBe(0.9);
    expect(initial.scene.dice[0].offsets).toEqual({});
  });

  it("replays a pivot roll and footprints on a read-only display, including a final snapshot arriving early", async () => {
    const snapshot = initialDice(), command: DiceTeachingCommand = { kind: "roll", id: snapshot.selectedId, direction: "z+", trail: true };
    const moving: DiceState = { id: "roll-start", snapshot, motion: { command, startedAt: Date.now() }, settles: null };
    const rig = await diceRig(snapshot, moving, false), result = controlledRoll(snapshot.scene, snapshot.selectedId, "z+", true)!;
    expect(host.querySelector("[data-dice-teaching][inert]")).not.toBeNull();
    await tick(0); await tick(300);
    const halfway = canvases.dice!.dice[0].rotation;
    expect(halfway).not.toEqual(snapshot.scene.dice[0].rotation); expect(halfway).not.toEqual(result.dice[0].rotation);
    await rig.replace({ id: "roll-final", snapshot: { ...snapshot, scene: result }, motion: null, settles: moving.id });
    expect(canvases.dice!.dice[0].rotation).toEqual(halfway);
    await act(async () => window.dispatchEvent(new Event("blur")));
    expect(frames.size).toBeGreaterThan(0);
    await finish(); expect(canvases.dice!.dice).toEqual(result.dice); expect(canvases.dice!.trail).toEqual(result.trail); expect(rig.sent).toHaveLength(0);
  });

  it("restores an open x-ray before animating its closing command", async () => {
    const snapshot = initialDice(); snapshot.xrayTarget = { id: snapshot.selectedId, face: "y+" };
    const moving: DiceState = { id: "closing", snapshot, motion: { command: { kind: "xray", target: null }, startedAt: Date.now() }, settles: null };
    const rig = await diceRig(snapshot, moving, false);
    expect(canvases.dice!.initialXRayTarget).toEqual(snapshot.xrayTarget); expect(canvases.dice!.xrayTarget).toBeNull();
    await act(async () => canvases.dice!.onXRayPresentation({ target: snapshot.xrayTarget, phase: "closing" }));
    await rig.replace({ id: "closed", snapshot: { ...snapshot, xrayTarget: null }, motion: null, settles: "closing" });
    expect(canvases.dice!.initialXRayTarget).toEqual(snapshot.xrayTarget);
    await act(async () => canvases.dice!.onXRayPresentation({ target: null, phase: "closed" }));
    expect(canvases.dice!.xrayTarget).toBeNull(); expect(rig.sent).toHaveLength(0);
  });

  it("sends one seeded throw intent with the teacher result, and followers adopt that result even if their simulation differs", async () => {
    const rig = await diceRig(), m = diceTeachingMessages("en");
    await click(m.throwing); await click(m.throwNow);
    await vi.waitFor(() => expect(rig.sent.some((value) => value.motion?.command.kind === "throw")).toBe(true));
    const packet = rig.sent.find((value) => value.motion?.command.kind === "throw")!;
    const command = packet.motion!.command; expect(command.kind).toBe("throw"); if (command.kind !== "throw") throw new Error("expected throw");
    expect(simulate).toHaveBeenCalledTimes(1); expect(command.target.dice[0].hidden).toHaveLength(5);
    await finish(); expect(canvases.dice!.dice).toEqual(command.target.dice);
    expect(rig.sent.filter((value) => value.motion)).toHaveLength(1);
    // 同一 renderer 接收远端动作；终点按 packet.target，而不是本机临时物理轨迹决定。
    await rig.replace({ ...packet, id: "remote-throw", motion: { ...packet.motion!, startedAt: Date.now() } });
    await act(async () => { await Promise.resolve(); }); await finish();
    expect(canvases.dice!.dice).toEqual(command.target.dice);
  });

  it("routes manual folds and all-unfold through the existing net renderer and retains its stable classroom snapshot", async () => {
    const initial: NetLiveSnapshot = { ...netTool(await buildNet()).payload.initial, judgment: null, galleryOpen: false };
    const rig = await netRig(initial), edgeId = Object.keys(initial.angles)[0];
    const support = canvases.net!.model.faces[0];
    await act(async () => canvases.net!.onCommit({ edgeId, degrees: 60, anchor: { faceId: support.faceId,
      vertices: [support.vertices[0].position, support.vertices[1].position, support.vertices[2].position] } }));
    expect(rig.sent[0].motion?.command).toMatchObject({ kind: "fold", degrees: 60 });
    expect(rig.sent.at(-1)?.snapshot.angles[edgeId]).toBe(60);
    const label = en.tools.spatialLab.cubeNet.manual.unfold;
    await click(label); expect(rig.sent.at(-1)?.motion?.command.kind).toBe("unfold");
    const start = rig.sent.length;
    await tick(0); await tick(150); expect(host.querySelector("[data-cube-net-animation]")).not.toBeNull(); expect(rig.sent).toHaveLength(start);
    await finish(); expect(Object.values(rig.sent.at(-1)!.snapshot.angles)).toEqual([0, 0, 0, 0, 0]);
    const target = legalNetEntries().find((entry) => entry.id !== initial.source.entryId)!;
    const next: NetState = { id: "gallery-start", snapshot: rig.sent.at(-1)!.snapshot, motion: { command: { kind: "gallery", entryId: target.id }, startedAt: Date.now() }, settles: null };
    await rig.replace(next);
    await vi.waitFor(async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); expect(frames.size).toBeGreaterThan(0); });
    await finish(); expect(host.querySelector("[data-folding-entry]")?.getAttribute("data-folding-entry")).toBe(target.id);
  });

  it("syncs individual edge cuts, unfolds one available face and cancels a later reveal without waiting for its end", async () => {
    const build = await buildNet(), initial: NetLiveSnapshot = { ...netTool(build).payload.initial, judgment: null, galleryOpen: false };
    const rig = await netRig(initial), labels = en.tools.spatialLab.cubeNet.manual;
    await click(labels.cutTool); await finish();
    expect(rig.sent.at(-1)!.snapshot.cutting).not.toBeNull();
    const edges = analyzePolyhedronTopology(build.sceneInput.topology).edges;
    const faceId = build.sceneInput.layout.rootFaceId;
    const boundary = edges.filter((edge) => edge.faceIds.includes(faceId));
    for (const edge of boundary.slice(1)) await act(async () => canvases.net!.onCutToggle!(edge.edgeId));
    expect(rig.sent.at(-1)!.snapshot.cutting!.cuts).toHaveLength(3);
    await act(async () => canvases.net!.onCutFaceOpen!(faceId));
    expect(rig.sent.at(-1)!.motion?.command).toEqual({ kind: "unfold-cuts", faceId });
    await tick(0); await tick(120);
    expect(host.querySelector("[data-cube-net-animation]")).not.toBeNull();
    await finish(); expect(Object.keys(rig.sent.at(-1)!.snapshot.cutting!.poses).length).toBeGreaterThan(0);
    await click(labels.faceReveal); await act(async () => canvases.net!.onFaceMove!(faceId));
    await tick(0); await tick(150);
    await click(labels.cancelAnimation);
    expect(rig.sent.at(-1)!).toMatchObject({ motion: null, settles: null });
    expect(rig.sent.at(-1)!.snapshot.faceOffsets).toEqual({}); expect(frames.size).toBe(0);
  });
});
