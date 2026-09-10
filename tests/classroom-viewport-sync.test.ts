import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SessionEventLog } from "@/features/classroom/sync/eventlog";
import { createLocalTransport, createRealtimeTransport } from "@/features/classroom/sync/transports";
import { useClassroomViewport } from "@/features/classroom/live/useClassroomViewport";
import { CLASSROOM_VIEWPORT_PROTOCOL, CLASSROOM_VIEWPORT_REQUEST, type ClassroomViewport } from "@/features/classroom/live/classroom-viewport";
import { idbPut } from "@/features/classroom/sync/idb";
import type { SessionEvent } from "@/features/classroom/types";

const lifecycle = vi.hoisted(() => ({ cleanups: [] as Array<() => void> }));
vi.mock("react", () => ({
  useRef: (value: unknown) => ({ current: value }), useState: (value: unknown) => [value, vi.fn()], useCallback: (fn: unknown) => fn,
  useLayoutEffect: (fn: () => void) => fn(), useEffect: (fn: () => void | (() => void)) => { const cleanup = fn(); if (cleanup) lifecycle.cleanups.push(cleanup); },
}));
vi.mock("@/features/classroom/sync/idb", () => ({
  STORE_META: "meta", STORE_OUTBOX: "outbox", idbPut: vi.fn(async () => {}), idbGet: vi.fn(), idbListByIndex: vi.fn(async () => []),
}));

class Channel {
  static all = new Set<Channel>();
  onmessage?: (event: { data: unknown }) => void;
  constructor(readonly name: string) { Channel.all.add(this); }
  postMessage(data: unknown) {
    for (const peer of Channel.all) if (peer !== this && peer.name === this.name) queueMicrotask(() => peer.onmessage?.({ data }));
  }
  close() { Channel.all.delete(this); }
}
const logs: SessionEventLog[] = [];
const teacher = "teacher-1";
const members = [{ userId: teacher, displayName: "Teacher", role: "teacher" as const }];
async function open(controller: boolean, room = "session-viewport", initialEvents: SessionEvent[] = []) {
  const log = await SessionEventLog.create(room, controller ? teacher : "student-1"); logs.push(log);
  log.attach(createLocalTransport(room, log.ingest, log.ingestFx));
  const view: ClassroomViewport = { focused: false, zoom: 1, centerY: 0.5 };
  const display = {
    viewport: view, focused: false, size: { width: 1920, height: 1080 }, value: 75, bounds: { fitPercent: 75 },
    applyViewport: vi.fn((next: ClassroomViewport) => { display.viewport = next; display.focused = next.focused; }),
    rememberViewport: vi.fn(), resize: vi.fn(), reset: vi.fn(),
  };
  // 测试用 React 生命周期桩执行真实 hook 的订阅与提交逻辑。
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const controls = useClassroomViewport({ log, controller, userId: log.userId, members, initialEvents,
    display: display as unknown as Parameters<typeof useClassroomViewport>[0]["display"], connectionKey: "connected" });
  return { log, display, controls };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  vi.clearAllMocks(); vi.stubGlobal("window", new EventTarget()); vi.stubGlobal("BroadcastChannel", Channel);
  // 局域网 HTTP 缺少 randomUUID 时，桥接窗口身份仍可正常分配。
  vi.stubGlobal("crypto", { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
});
afterEach(() => {
  for (const cleanup of lifecycle.cleanups.splice(0).reverse()) cleanup();
  for (const log of logs.splice(0)) log.close(); Channel.all.clear();
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
});

describe("teacher viewport replay and following", () => {
  it("coalesces gesture frames into one durable view and restores a late device", async () => {
    const control = await open(true), viewer = await open(false);
    await vi.advanceTimersByTimeAsync(101);
    vi.mocked(idbPut).mockClear();
    for (let i = 0; i < 60; i++) control.controls.change({ focused: true, zoom: 1 + i / 180, centerY: 0.6 });
    await vi.advanceTimersByTimeAsync(80);
    expect(viewer.display.viewport).toMatchObject({ focused: true, zoom: 1 + 59 / 180, centerY: 0.6 });
    expect(vi.mocked(idbPut).mock.calls.filter(([store]) => store === "outbox")).toHaveLength(0);
    control.controls.commit();
    await vi.advanceTimersByTimeAsync(1);
    expect(vi.mocked(idbPut).mock.calls.filter(([store]) => store === "outbox")).toHaveLength(1);
    const event = control.log.latestViewportEvent!;
    expect(event.payload).toMatchObject({ action: "viewport", revision: expect.any(Number) });
    const late = await open(false);
    await vi.advanceTimersByTimeAsync(101);
    expect(late.display.viewport).toMatchObject({ focused: true, zoom: 1 + 59 / 180, centerY: 0.6 });
    expect(late.log.latestViewportEvent?.id).toBe(event.id);
    expect(vi.mocked(idbPut).mock.calls.filter(([store]) => store === "outbox")).toHaveLength(1);
    const restoredControl = await open(true, event.sessionId, [JSON.parse(JSON.stringify(event))]);
    expect(restoredControl.display.viewport).toMatchObject({ focused: true, zoom: 1 + 59 / 180, centerY: 0.6 });
  });

  it("ignores duplicates, stale frames, other rooms and students; manual views can rejoin", async () => {
    const viewer = await open(false);
    const packet = (revision: number, userId = teacher, sessionId = viewer.log.sessionId) => ({ scope: CLASSROOM_VIEWPORT_PROTOCOL,
      payload: { sessionId, userId, snapshot: { action: "viewport", version: 1, revision, writer: "teacher-window", focused: true, zoom: 1.3, centerY: revision / 10 } } });
    viewer.log.ingestFx(packet(5)); viewer.log.ingestFx(packet(5)); viewer.log.ingestFx(packet(4));
    viewer.log.ingestFx(packet(6, "student-1")); viewer.log.ingestFx(packet(6, teacher, "other-room"));
    expect(viewer.display.applyViewport).toHaveBeenCalledTimes(1);
    viewer.controls.change({ focused: true, zoom: 1, centerY: 0.5 }, true);
    expect(viewer.display.rememberViewport).toHaveBeenCalledWith({ focused: true, zoom: 1, centerY: 0.5 });
    viewer.log.ingestFx(packet(6));
    expect(viewer.display.viewport.zoom).toBe(1);
    viewer.controls.follow();
    expect(viewer.display.viewport).toMatchObject({ zoom: 1.3, centerY: 0.6 });
    expect(vi.mocked(idbPut).mock.calls.filter(([store]) => store === "outbox")).toHaveLength(0);
  });

  it("retains one rehearsal viewport while preserving other classroom events", async () => {
    const log = await SessionEventLog.create("rehearsal:teacher-1:session:a", teacher, { ephemeral: true }); logs.push(log);
    for (let revision = 1; revision <= 5; revision++) await log.append("session_ctl", { action: "viewport", version: 1, revision, writer: log.deviceId, focused: true, zoom: 1, centerY: 0.5 });
    await log.append("session_ctl", { action: "quiz_open", quizId: "quiz-1", options: 4 });
    expect(log.rehearsalEvents).toHaveLength(2);
    expect(log.rehearsalEvents[0].payload.revision).toBe(5);
    expect(idbPut).not.toHaveBeenCalled();
  });

  it("returns abandoned temporary motion to the durable snapshot", async () => {
    const control = await open(true), viewer = await open(false);
    control.controls.change({ focused: true, zoom: 1.2, centerY: 0.5 }, true);
    await vi.advanceTimersByTimeAsync(100);
    const saved = control.log.latestViewportEvent!;
    const abandoned = { scope: CLASSROOM_VIEWPORT_PROTOCOL, payload: { sessionId: viewer.log.sessionId, userId: teacher,
      snapshot: { ...saved.payload, revision: Number(saved.payload.revision) + 100, zoom: 1.3 } } };
    viewer.log.ingestFx(abandoned);
    expect(viewer.display.viewport.zoom).toBe(1.3);
    await vi.advanceTimersByTimeAsync(1501);
    expect(viewer.display.viewport.zoom).toBe(1.2);
    viewer.log.ingestFx(abandoned);
    expect(viewer.display.viewport.zoom).toBe(1.2);
  });

  it("keeps member requests separate from teacher viewport states on Realtime", async () => {
    const channels = new Map<string, { handlers: Map<string, (event: { payload: unknown }) => void>; send: ReturnType<typeof vi.fn> }>();
    const client = {
      auth: { getSession: async () => ({ data: { session: { access_token: "fixture-token" } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
      realtime: { setAuth: async () => {} }, removeChannel: vi.fn(),
      channel(topic: string) {
        const handlers = new Map<string, (event: { payload: unknown }) => void>(), send = vi.fn(); channels.set(topic, { handlers, send });
        return { on(_type: string, filter: { event: string }, callback: (event: { payload: unknown }) => void) { handlers.set(filter.event, callback); }, subscribe(callback: (status: string) => void) { callback("SUBSCRIBED"); }, send };
      },
    } as unknown as SupabaseClient;
    const events = vi.fn(), fx = vi.fn();
    const transport = createRealtimeTransport(client, "room", events, vi.fn(), fx);
    await vi.advanceTimersByTimeAsync(1);
    const member = channels.get("session:room:client")!, authoritative = channels.get("session:room:authoritative")!;
    const view = { type: "session_ctl", payload: { action: "viewport" } };
    member.handlers.get("ev")!({ payload: view }); expect(events).not.toHaveBeenCalled();
    authoritative.handlers.get("ev")!({ payload: view }); expect(events).toHaveBeenCalledWith(view);
    member.handlers.get("fx")!({ payload: { scope: CLASSROOM_VIEWPORT_PROTOCOL, payload: {} } }); expect(fx).not.toHaveBeenCalled();
    member.handlers.get("fx")!({ payload: { scope: CLASSROOM_VIEWPORT_REQUEST, payload: { version: 1, extra: "discard" } } });
    expect(fx).toHaveBeenCalledWith({ scope: CLASSROOM_VIEWPORT_REQUEST, payload: { version: 1 } });
    transport.sendFx({ scope: CLASSROOM_VIEWPORT_REQUEST, payload: { version: 1 } });
    expect(member.send).toHaveBeenCalled(); expect(authoritative.send).not.toHaveBeenCalled();
    transport.close();
  });
});
