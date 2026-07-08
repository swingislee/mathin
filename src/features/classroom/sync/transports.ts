import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { SessionEvent } from "../types";

// 课堂事件的传输层（08-§3.4）：同一事件流的多种通道，事件层对来源无感知。
// T0 BroadcastChannel（同设备双窗，零网络依赖）——物理课堂保底形态；
// T2 Supabase Realtime（在线时并行）；T1 WebRTC 在 P4-6 补入同一接口。
//
// 两类载荷：
//  ev = 持久事件（进 outbox 回传 DB，晚加入者可重放）；
//  fx = 短命效果（板书笔迹 op/绘制中增量、视频对时、光标——高频、可丢，
//       不落库；最终状态由对应的持久事件收敛，如 board_snapshot）。

export interface FxMessage {
  /** 路由域："board" 板书、"video" 视频对时…… 接收端按 scope 分发。 */
  scope: string;
  payload: Record<string, unknown>;
}

export interface PresencePeer {
  userId: string;
  name: string;
  role: string;
}

export interface Transport {
  readonly kind: "local" | "realtime" | "p2p";
  send(ev: SessionEvent): void;
  sendFx(fx: FxMessage): void;
  close(): void;
}

/** T0：同设备多窗。BroadcastChannel 在非安全上下文可用；极老浏览器缺失时返回 null。 */
export function createLocalTransport(
  sessionId: string,
  onEvent: (ev: SessionEvent) => void,
  onFx?: (fx: FxMessage) => void,
): Transport | null {
  if (typeof BroadcastChannel === "undefined") return null;
  const channel = new BroadcastChannel(`mathin-session-${sessionId}`);
  channel.onmessage = (event) => {
    const data = event.data as { kind?: string; event?: SessionEvent; fx?: FxMessage } | null;
    if (data?.kind === "ev" && data.event) onEvent(data.event);
    else if (data?.kind === "fx" && data.fx) onFx?.(data.fx);
  };
  return {
    kind: "local",
    send(ev) {
      channel.postMessage({ kind: "ev", event: ev });
    },
    sendFx(fx) {
      channel.postMessage({ kind: "fx", fx });
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
  onFx?: (fx: FxMessage) => void,
  presence?: { key: string; meta: PresencePeer; onPeers: (peers: PresencePeer[]) => void },
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
    channel = supabase.channel(topic, {
      config: {
        private: true,
        broadcast: { self: false },
        ...(presence ? { presence: { key: presence.key } } : {}),
      },
    });
    channel.on("broadcast", { event: "ev" }, ({ payload }) => {
      onEvent(payload as SessionEvent);
    });
    channel.on("broadcast", { event: "fx" }, ({ payload }) => {
      onFx?.(payload as FxMessage);
    });
    if (presence) {
      channel.on("presence", { event: "sync" }, () => {
        const state = channel?.presenceState<PresencePeer>() ?? {};
        presence.onPeers(
          Object.values(state)
            .map((metas) => metas[0])
            .filter((peer): peer is PresencePeer & { presence_ref: string } => Boolean(peer?.userId)),
        );
      });
    }
    channel.subscribe((status) => {
      joined = status === "SUBSCRIBED";
      onStatus?.(joined);
      if (joined && presence && channel) void channel.track(presence.meta);
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
    sendFx(fx) {
      if (joined && channel) void channel.send({ type: "broadcast", event: "fx", payload: fx });
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
