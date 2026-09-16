// @vitest-environment jsdom
import { act, createElement, StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTeachingWorkbench } from "@/features/tools/courseware/useTeachingWorkbench";
import type { TeachingWorkbenchState } from "@/features/tools/courseware/workbench-classroom-contract";

type Snapshot = { value: number; view: string };
type Command = { kind: "move" };
type State = TeachingWorkbenchState<Snapshot, Command>;
const initial: Snapshot = { value: 0, view: "top" };
const state = (id: string, value: number, extra: Partial<State> = {}): State => ({ id, snapshot: { ...initial, value }, motion: null, settles: null, ...extra });
let host: HTMLDivElement, root: Root, current: ReturnType<typeof useTeachingWorkbench<Snapshot, Command>>;
let runtime: { state?: State; onChange?: (value: State) => Promise<void> };
function Probe() { const host = useTeachingWorkbench(initial, runtime); useEffect(() => { current = host; }); return null; }
const render = () => act(async () => { root.render(createElement(StrictMode, null, createElement(Probe))); });
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // 局域网 HTTP 不能依赖 randomUUID；宿主沿用共享降级实现。
  vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); runtime = {};
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("shared teaching workbench host", () => {
  it("does not publish on mount, preserves key order independence and waits for durable commands", async () => {
    let release!: () => void;
    const writer = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    runtime.onChange = writer; await render();
    await act(async () => current.port.capture({ view: "top", value: 0 }));
    expect(writer).not.toHaveBeenCalled();
    const execute = vi.fn(); const key = current.key;
    await act(async () => current.port.command({ kind: "move" }, execute));
    expect(execute).not.toHaveBeenCalled(); expect(current.port.pending).toBe(true);
    await act(async () => { current.port.capture({ value: 0, view: "left" }); current.port.command({ kind: "move" }, execute); });
    expect(writer).toHaveBeenCalledTimes(1);
    const packet = (writer.mock.calls as unknown as [State][])[0][0];
    runtime.state = packet; await render();
    expect(current.key).toBe(key); expect(current.port.replay).toBeNull();
    await act(async () => release());
    expect(execute).toHaveBeenCalledTimes(1); expect(current.port.pending).toBe(false);
  });

  it("publishes only motion and stable final state, not preview frames, then restores the frozen starting scene", async () => {
    const writer = vi.fn<(value: State) => Promise<void>>().mockResolvedValue(undefined); runtime.onChange = writer; await render();
    await act(async () => current.port.command({ kind: "move" }, () => {}));
    const motion = writer.mock.calls[0][0], key = current.key;
    await act(async () => { current.port.capture(null); current.port.capture(null); });
    expect(writer).toHaveBeenCalledTimes(1);
    await act(async () => current.port.capture({ ...initial, value: 2 }));
    expect(writer).toHaveBeenCalledTimes(2);
    const final = writer.mock.calls[1][0]; expect(final.settles).toBe(motion.id); expect(final.motion).toBeNull();
    runtime.state = final; await render(); expect(current.key).toBe(key);
    await act(async () => current.port.reset());
    expect(writer.mock.lastCall![0].snapshot).toEqual(initial); expect(current.initial).toEqual(initial);
    expect(current.key).not.toBe(key);
    await act(async () => current.port.capture(initial)); expect(writer).toHaveBeenCalledTimes(3);
  });

  it("queues an early final snapshot until the original replay completes and accepts a terminal-only late join", async () => {
    const motion = state("moving", 0, { motion: { command: { kind: "move" }, startedAt: 1000 } });
    runtime.state = motion; await render(); const key = current.key;
    await act(async () => current.port.capture(initial));
    await act(async () => current.port.capture(null));
    runtime.state = state("finished", 3, { settles: "moving" }); await render();
    expect(current.key).toBe(key); expect(current.port.replay).toEqual(motion.motion);
    await act(async () => current.port.capture({ ...initial, value: 2 }));
    expect(current.initial.value).toBe(3); expect(current.port.replay).toBeNull();
    runtime.state = state("late-join", 9, { settles: "old-command" }); await render();
    expect(current.initial.value).toBe(9); expect(current.port.replay).toBeNull();
  });

  it("cancels an active animation immediately across peers and keeps read-only ports inert", async () => {
    const writer = vi.fn<(value: State) => Promise<void>>().mockResolvedValue(undefined); runtime.onChange = writer; await render();
    await act(async () => current.port.command({ kind: "move" }, () => {}));
    await act(async () => current.port.capture(null));
    await act(async () => current.port.cancel());
    expect(writer.mock.lastCall![0]).toMatchObject({ snapshot: initial, motion: null, settles: null });
    runtime = { state: state("incoming", 6) }; await render(); const key = current.key, execute = vi.fn();
    await act(async () => { current.port.command({ kind: "move" }, execute); current.port.reset(); current.port.cancel(); current.port.capture({ ...initial, value: 8 }); });
    expect(execute).not.toHaveBeenCalled(); expect(writer).toHaveBeenCalledTimes(2); expect(current.key).toBe(key);
  });

  it("rolls back failed persistence and discards work queued for a superseded instance", async () => {
    runtime.onChange = vi.fn(async () => { throw new Error("storage unavailable"); }); await render();
    const execute = vi.fn();
    await act(async () => current.port.command({ kind: "move" }, execute));
    expect(current.failed).toBe(true); expect(current.initial).toEqual(initial); expect(execute).not.toHaveBeenCalled();
    let release!: () => void;
    runtime.onChange = () => new Promise<void>((resolve) => { release = resolve; }); await render();
    await act(async () => current.port.command({ kind: "move" }, execute));
    runtime.state = state("new-authority", 7); await render();
    await act(async () => release());
    expect(execute).not.toHaveBeenCalled(); expect(current.initial.value).toBe(7);
  });

  it("does not loop replay and automatic writes when a terminal snapshot cannot be saved", async () => {
    const writer = vi.fn<(value: State) => Promise<void>>().mockResolvedValueOnce(undefined).mockRejectedValue(new Error("outbox full"));
    runtime.onChange = writer; await render();
    await act(async () => current.port.command({ kind: "move" }, () => {}));
    await act(async () => { current.port.capture(null); current.port.capture({ ...initial, value: 4 }); });
    expect(current.failed).toBe(true); expect(writer).toHaveBeenCalledTimes(2);
    expect(current.port.replay?.command).toEqual({ kind: "move" });
    await act(async () => { current.port.capture(null); current.port.capture({ ...initial, value: 4 }); });
    expect(writer).toHaveBeenCalledTimes(2);
    writer.mockResolvedValue(undefined);
    await act(async () => current.port.reset());
    expect(current.failed).toBe(false); expect(current.initial).toEqual(initial);
  });
});
