import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { SessionEvent } from "../types";

// 课堂事件的传输层（08-§3.4）：同一事件流的多种通道，事件层对来源无感知。
// T0 BroadcastChannel（同设备双窗，零网络依赖）——物理课堂保底形态；
// T2 Supabase Realtime（在线时并行）；T1 WebRTC 在 P4-6 补入同一接口。

export interface Transport {
  readonly kind: "local" | "realtime" | "p2p";
  send(ev: SessionEvent): void;
  close(): void;
}

/** T0：同设备多窗。BroadcastChannel 在非安全上下文可用；极老浏览器缺失时返回 null。 */
export function createLocalTransport(
  sessionId: string,
  onEvent: (ev: SessionEvent) => void,
): Transport | null {
  if (typeof BroadcastChannel === "undefined") return null;
  const channel = new BroadcastChannel(`mathin-session-${sessionId}`);
  channel.onmessage = (event) => {
    const data = event.data as { kind?: string; event?: SessionEvent } | null;
    if (data?.kind === "ev" && data.event) onEvent(data.event);
  };
  return {
    kind: "local",
    send(ev) {
      channel.postMessage({ kind: "ev", event: ev });
    },
    close() {
      channel.close();
    },
  };
}

/** T2：服务器私有频道。at-most-once，不承担课堂可靠性；离线时静默失联、恢复自动重连。 */
export function createRealtimeTransport(
  supabase: SupabaseClient,
  sessionId: string,
  onEvent: (ev: SessionEvent) => void,
  onStatus?: (connected: boolean) => void,
): Transport {
  const topic = `session:${sessionId}`;
  let channel: RealtimeChannel | null = null;
  let joined = false;
  let closed = false;

  const start = async () => {
    // 私有频道必须先注入用户 token（supabase-js 不会自动做，P4-2 验证过的坑）
    const { data: { session } } = await supabase.auth.getSession();
    await supabase.realtime.setAuth(session?.access_token ?? null);
    if (closed) return;
    channel = supabase.channel(topic, { config: { private: true, broadcast: { self: false } } });
    channel.on("broadcast", { event: "ev" }, ({ payload }) => {
      onEvent(payload as SessionEvent);
    });
    channel.subscribe((status) => {
      joined = status === "SUBSCRIBED";
      onStatus?.(joined);
    });
  };
  void start();

  // 长课 token 一小时过期：刷新时重新 setAuth，否则私有频道静默掉线
  const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
    void supabase.realtime.setAuth(session?.access_token ?? null);
  });

  return {
    kind: "realtime",
    send(ev) {
      if (joined && channel) void channel.send({ type: "broadcast", event: "ev", payload: ev });
    },
    close() {
      closed = true;
      joined = false;
      authListener.subscription.unsubscribe();
      if (channel) void supabase.removeChannel(channel);
      onStatus?.(false);
    },
  };
}
