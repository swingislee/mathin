import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { createIsolatedRealtimeClient } from "@/lib/supabase/client";
import type { SessionEvent } from "../types";
import type { SessionEventLog } from "./eventlog";
import { createLocalTransport, createP2PSignalBus, createP2PTransport, type FxMessage, type P2PHealth, type P2PSignalBus, type Transport } from "./transports";

export function rehearsalRoomId(userId: string, kind: "session" | "activity", resourceId: string) {
  return `rehearsal:${userId}:${kind}:${resourceId}`;
}

/** 私有试讲频道仅供同一教师账号的设备使用，正式课堂订阅保持独立。 */
export function createRehearsalRealtimeTransport(
  client: SupabaseClient,
  roomId: string,
  onEvent: (event: SessionEvent) => void,
  onFx: (fx: FxMessage) => void,
  signaling: P2PSignalBus,
  onStatus: (connected: boolean) => void,
): Transport {
  let channel: RealtimeChannel | null = null;
  let joined = false;
  let closed = false;
  const send = (event: string, payload: unknown) => {
    if (joined && channel) void channel.send({ type: "broadcast", event, payload });
  };
  const disconnect = signaling.connect((signal) => send("signal", signal));
  const start = async () => {
    const { data: { session } } = await client.auth.getSession();
    if (closed) return;
    await client.realtime.setAuth(session?.access_token ?? null);
    if (closed) return;
    channel = client.channel(roomId, { config: { private: true, broadcast: { self: false } } });
    channel.on("broadcast", { event: "ev" }, ({ payload }) => {
      if (payload?.sessionId === roomId) onEvent(payload as SessionEvent);
    });
    channel.on("broadcast", { event: "fx" }, ({ payload }) => onFx(payload as FxMessage));
    channel.on("broadcast", { event: "signal" }, ({ payload }) => signaling.deliver(payload));
    channel.subscribe((status) => {
      if (closed) return;
      joined = status === "SUBSCRIBED";
      onStatus(joined);
    });
  };
  void start().catch(() => { if (!closed) onStatus(false); });
  const { data: authListener } = client.auth.onAuthStateChange((_event, session) => {
    if (!closed) void client.realtime.setAuth(session?.access_token ?? null);
  });
  return {
    kind: "realtime",
    send: (event) => send("ev", event),
    sendFx: (fx) => send("fx", fx),
    close() {
      closed = true;
      joined = false;
      disconnect();
      authListener.subscription.unsubscribe();
      if (channel) void client.removeChannel(channel);
    },
  };
}

/** 试讲只保留内存事件；同窗、局域网和在线通道共用去重与晚加入重放。 */
export function attachRehearsalTransports(log: SessionEventLog, {
  onHealth,
  onStatus,
  client = createIsolatedRealtimeClient(),
}: {
  onHealth: (health: P2PHealth) => void;
  onStatus: (connected: boolean) => void;
  client?: SupabaseClient;
}) {
  if (!log.ephemeral || !log.sessionId.startsWith(`rehearsal:${log.userId}:`)) throw new Error("REHEARSAL_SCOPE_REQUIRED");
  const transports: Transport[] = [];
  const signaling = createP2PSignalBus();
  let closed = false;
  let peerCount = 0;
  let requestTimer: ReturnType<typeof setTimeout> | undefined;
  const requestReplay = () => {
    if (closed || requestTimer) return;
    requestTimer = setTimeout(() => {
      requestTimer = undefined;
      log.sendFx({ scope: "rehearsal-replay-request", payload: { version: 1, deviceId: log.deviceId } });
    }, 100);
  };
  const offFx = log.onFx((fx) => {
    if (fx.scope !== "rehearsal-replay-request" || fx.payload?.version !== 1 || fx.payload.deviceId === log.deviceId) return;
    for (const event of log.rehearsalEvents) {
      for (const transport of transports) transport.send(event);
    }
  });
  const receive = (event: SessionEvent) => {
    if (event?.sessionId === log.sessionId && event.userId === log.userId) log.ingest(event);
  };
  const add = (transport: Transport | null) => { if (transport) transports.push(transport); };
  add(createLocalTransport(log.sessionId, receive, log.ingestFx));
  add(createP2PTransport(signaling, log.deviceId, true, receive, log.ingestFx, (health) => {
    if (closed) return;
    onHealth(health);
    if (health.peers > peerCount) requestReplay();
    peerCount = health.peers;
  }));
  add(createRehearsalRealtimeTransport(client, log.sessionId, receive, log.ingestFx, signaling, (connected) => {
    if (closed) return;
    onStatus(connected);
    if (connected) requestReplay();
  }));
  log.attach({
    kind: "realtime",
    send: (event) => { for (const transport of transports) transport.send(event); },
    sendFx: (fx) => { for (const transport of transports) transport.sendFx(fx); },
    close() {
      closed = true;
      if (requestTimer) clearTimeout(requestTimer);
      offFx();
      for (const transport of transports) transport.close();
    },
  });
  requestReplay();
}
