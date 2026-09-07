import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createRealtimeTransport } from "@/features/classroom/sync/transports";

describe("cube classroom realtime lanes", () => {
  it("accepts tool states only on the teacher lane and sends resync requests on the member lane", async () => {
    const channels = new Map<string, { listeners: Map<string, (message: { payload: unknown }) => void>; send: ReturnType<typeof vi.fn> }>();
    const client = {
      auth: { getSession: async () => ({ data: { session: { access_token: "fixed-test-token" } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
      realtime: { setAuth: async () => {} }, removeChannel: vi.fn(),
      channel(topic: string) {
        const listeners = new Map<string, (message: { payload: unknown }) => void>();
        const send = vi.fn(); channels.set(topic, { listeners, send });
        return { on(_type: string, filter: { event: string }, handler: (message: { payload: unknown }) => void) { listeners.set(filter.event, handler); },
          subscribe(handler: (status: string) => void) { handler("SUBSCRIBED"); }, send };
      },
    } as unknown as SupabaseClient;
    const receive = vi.fn(), status = vi.fn(), effects = vi.fn();
    const transport = createRealtimeTransport(client, "session-1", receive, status, effects);
    await vi.waitFor(() => expect(status).toHaveBeenLastCalledWith(true));
    const member = channels.get("session:session-1:client")!, teacher = channels.get("session:session-1:authoritative")!;
    const state = { type: "tool_state" };
    member.listeners.get("ev")!({ payload: state }); expect(receive).not.toHaveBeenCalled();
    teacher.listeners.get("ev")!({ payload: state }); expect(receive).toHaveBeenCalledWith(state);
    member.listeners.get("fx")!({ payload: { scope: "board", payload: { items: [] } } }); expect(effects).not.toHaveBeenCalled();
    member.listeners.get("fx")!({ payload: { scope: "tool-state-request", payload: { version: 1, untrusted: "ignored" } } });
    expect(effects).toHaveBeenCalledWith({ scope: "tool-state-request", payload: { version: 1 } });
    transport.sendFx({ scope: "tool-state-request", payload: { version: 1 } });
    expect(member.send).toHaveBeenCalledWith({ type: "broadcast", event: "fx", payload: { scope: "tool-state-request", payload: { version: 1 } } });
    expect(teacher.send).not.toHaveBeenCalled();
    transport.close();
  });
});
