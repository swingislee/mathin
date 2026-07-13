import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SessionEventLog } from "@/features/classroom/sync/eventlog";
import { flushOutbox } from "@/features/classroom/sync/flush";
import { STORE_OUTBOX, idbListByIndex } from "@/features/classroom/sync/idb";
import { createLocalTransport } from "@/features/classroom/sync/transports";
import type { SessionEvent } from "@/features/classroom/types";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("P4E classroom offline reliability", () => {
  beforeAll(() => {
    vi.stubGlobal("sessionStorage", new MemoryStorage());
    vi.stubGlobal("navigator", { onLine: false });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("persists events before rendering and resumes the sequence after restart", async () => {
    const sessionId = crypto.randomUUID();
    const log = await SessionEventLog.create(sessionId, crypto.randomUUID());
    const sent: SessionEvent[] = [];
    const rendered: Array<{ event: SessionEvent; local: boolean }> = [];
    log.attach({ kind: "local", send: (event) => sent.push(event), sendFx: () => {}, close: () => {} });
    log.subscribe((event, local) => rendered.push({ event, local }));

    const first = await log.append("page", { page: 1 });
    const rowsAfterFirst = await idbListByIndex<SessionEvent>(STORE_OUTBOX, "sessionId", sessionId);
    expect(rowsAfterFirst).toEqual([first]);
    expect(rendered).toEqual([{ event: first, local: true }]);
    expect(sent).toEqual([first]);

    const restored = await SessionEventLog.create(sessionId, first.userId);
    const second = await restored.append("page", { page: 2 });
    expect(second.deviceId).toBe(first.deviceId);
    expect(second.seq).toBe(first.seq + 1);

    const pending = await idbListByIndex<SessionEvent>(STORE_OUTBOX, "sessionId", sessionId);
    expect(pending.map((event) => event.seq).sort((a, b) => a - b)).toEqual([1, 2]);
    expect(await flushOutbox(sessionId)).toBe(0);
    expect((await idbListByIndex<SessionEvent>(STORE_OUTBOX, "sessionId", sessionId))).toHaveLength(2);
  });

  it("keeps same-device classroom windows connected without a server", async () => {
    const sessionId = crypto.randomUUID();
    const event: SessionEvent = {
      id: crypto.randomUUID(),
      sessionId,
      userId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
      seq: 1,
      type: "page",
      payload: { page: 3 },
      at: new Date().toISOString(),
    };
    let resolveReceived!: (value: SessionEvent) => void;
    const received = new Promise<SessionEvent>((resolve) => { resolveReceived = resolve; });
    const receiver = createLocalTransport(sessionId, resolveReceived);
    const sender = createLocalTransport(sessionId, () => {});
    expect(receiver).not.toBeNull();
    expect(sender).not.toBeNull();

    sender?.send(event);
    await expect(received).resolves.toEqual(event);
    sender?.close();
    receiver?.close();
  });
});
