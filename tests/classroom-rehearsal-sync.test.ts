import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SessionEventLog } from "@/features/classroom/sync/eventlog";
import { attachRehearsalTransports, rehearsalRoomId } from "@/features/classroom/sync/rehearsal";
import { createLocalTransport } from "@/features/classroom/sync/transports";
import { idbPut } from "@/features/classroom/sync/idb";
import { isMediaControlEcho } from "@/features/classroom/sync/media-control";

vi.mock("@/features/classroom/sync/idb", () => ({
  STORE_META: "meta", STORE_OUTBOX: "outbox", idbPut: vi.fn(), idbGet: vi.fn(), idbListByIndex: vi.fn(async () => []),
}));

class LocalChannel {
  static channels = new Set<LocalChannel>();
  onmessage?: (message: { data: unknown }) => void;
  constructor(readonly name: string) { LocalChannel.channels.add(this); }
  postMessage(data: unknown) {
    for (const channel of LocalChannel.channels) if (channel !== this && channel.name === this.name) {
      queueMicrotask(() => { if (LocalChannel.channels.has(channel)) channel.onmessage?.({ data }); });
    }
  }
  close() { LocalChannel.channels.delete(this); }
}

function realtimeNetwork() {
  const active = new Set<{ topic: string; handlers: Map<string, (message: { payload: unknown }) => void> }>();
  const topics: string[] = [];
  const client = (): SupabaseClient => ({
    auth: {
      getSession: async () => ({ data: { session: { access_token: "test-token" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    realtime: { setAuth: async () => {} },
    removeChannel: (channel: Parameters<typeof active.delete>[0]) => { active.delete(channel); },
    channel(topic: string, options: { config: { private: boolean } }) {
      expect(options.config.private).toBe(true);
      topics.push(topic);
      const channel = {
        topic, handlers: new Map<string, (message: { payload: unknown }) => void>(),
        on(_type: string, { event }: { event: string }, handler: (message: { payload: unknown }) => void) { this.handlers.set(event, handler); },
        subscribe(handler: (status: string) => void) { active.add(channel); handler("SUBSCRIBED"); },
        send({ event, payload }: { event: string; payload: unknown }) {
          for (const peer of active) if (peer !== channel && peer.topic === topic) queueMicrotask(() => {
            if (active.has(peer)) peer.handlers.get(event)?.({ payload });
          });
        },
      };
      return channel;
    },
  } as unknown as SupabaseClient);
  return { client, topics, active };
}

const teacher = "11111111-1111-4111-8111-111111111111";
const course = "33333333-3333-4333-8333-333333333333";
const logs: SessionEventLog[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("BroadcastChannel", LocalChannel);
  vi.stubGlobal("RTCPeerConnection", undefined);
});
afterEach(() => { for (const log of logs.splice(0)) log.close(); LocalChannel.channels.clear(); vi.unstubAllGlobals(); });

describe("isolated rehearsal device synchronization", () => {
  it("does not rebroadcast replayed media events while allowing a new pause or seek", () => {
    const remote = { action: "play" as const, time: 12 };
    expect(isMediaControlEcho("play", 12.1, remote)).toBe(true);
    expect(isMediaControlEcho("seek", 12, remote)).toBe(true);
    expect(isMediaControlEcho("pause", 12.1, remote)).toBe(false);
    expect(isMediaControlEcho("seek", 20, remote)).toBe(false);
  });
  it.each(["session", "activity"] as const)("shares %s actions in both directions, restores late devices and leaves formal channels untouched", async (kind) => {
    const network = realtimeNetwork();
    const room = rehearsalRoomId(teacher, kind, course);
    const open = async (id = room, user = teacher) => {
      const log = await SessionEventLog.create(id, user, { ephemeral: true });
      logs.push(log);
      attachRehearsalTransports(log, { client: network.client(), onHealth: vi.fn(), onStatus: vi.fn() });
      return log;
    };
    const formalEvents = vi.fn();
    const formal = createLocalTransport(course, formalEvents);
    const first = await open();
    await first.append("page", { page: 2 });
    await first.append("board_snapshot", { pageKey: "page-1", items: [{ id: "stroke-1" }] });
    const second = await open();
    const received = vi.fn();
    second.subscribe(received);
    await vi.waitFor(() => expect(received).toHaveBeenCalledTimes(2));
    expect(received.mock.calls.map(([event]) => event.type)).toEqual(["page", "board_snapshot"]);
    const returned = vi.fn();
    first.subscribe(returned);
    await second.append("page", { page: 4 });
    await vi.waitFor(() => expect(returned).toHaveBeenCalledTimes(1));
    expect(returned.mock.calls[0][0].payload).toEqual({ page: 4 });
    expect(first.deviceId).not.toBe(second.deviceId);
    const otherTeacher = "22222222-2222-4222-8222-222222222222";
    const other = await open(rehearsalRoomId(otherTeacher, kind, course), otherTeacher);
    const unrelated = vi.fn(); other.subscribe(unrelated);
    await first.append("page", { page: 5 });
    await vi.waitFor(() => expect(received).toHaveBeenCalledTimes(4));
    expect(unrelated).not.toHaveBeenCalled();
    expect(formalEvents).not.toHaveBeenCalled();
    expect(idbPut).not.toHaveBeenCalled();
    expect(network.topics.every((topic) => topic.startsWith("rehearsal:"))).toBe(true);
    first.close(); second.close(); other.close(); formal?.close();
    expect(network.active.size).toBe(0);
  });
  it("rejects attaching a formal session to rehearsal transports", async () => {
    const log = await SessionEventLog.create(course, teacher, { ephemeral: true });
    logs.push(log);
    expect(() => attachRehearsalTransports(log, { client: realtimeNetwork().client(), onHealth: vi.fn(), onStatus: vi.fn() })).toThrow("REHEARSAL_SCOPE_REQUIRED");
  });
  it("converges simultaneous commands regardless of delivery order, then advances the logical clock", async () => {
    const room = rehearsalRoomId(teacher, "session", course);
    const first = await SessionEventLog.create(room, teacher, { ephemeral: true });
    const second = await SessionEventLog.create(room, teacher, { ephemeral: true });
    logs.push(first, second);
    const [a, b] = await Promise.all([first.append("page", { page: 2 }), second.append("page", { page: 4 })]);
    first.ingest(b); second.ingest(a);
    expect(first.rehearsalEvents.map((event) => event.id)).toEqual(second.rehearsalEvents.map((event) => event.id));
    expect(first.rehearsalEvents.at(-1)?.payload).toEqual(second.rehearsalEvents.at(-1)?.payload);
    const next = await first.append("page", { page: 6 });
    second.ingest(next);
    expect(next.seq).toBeGreaterThan(b.seq);
    expect(second.rehearsalEvents.at(-1)?.payload).toEqual({ page: 6 });
  });
  it("retains only current board snapshots while preserving ordered interaction steps", async () => {
    const log = await SessionEventLog.create(rehearsalRoomId(teacher, "session", course), teacher, { ephemeral: true });
    logs.push(log);
    for (let index = 0; index < 100; index++) {
      await log.append("board_snapshot", { pageKey: "board-1", items: [{ id: `stroke-${index}` }] });
    }
    await log.append("doc_step", { pageId: "page-1", scope: "page", id: "next" });
    await log.append("doc_step", { pageId: "page-1", scope: "page", id: "next" });
    expect(log.rehearsalEvents).toHaveLength(3);
    expect(log.rehearsalEvents[0].payload.items).toEqual([{ id: "stroke-99" }]);
    expect(log.rehearsalEvents.slice(1).map((event) => event.type)).toEqual(["doc_step", "doc_step"]);
  });
});
