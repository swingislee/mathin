import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { SessionEvent } from "../types";
import { newId } from "@/lib/uuid";

// 课堂事件的传输层（08-§3.4）：同一事件流的多种通道，事件层对来源无感知。
// T0 BroadcastChannel（同设备双窗，零网络依赖）——物理课堂保底形态；
// T1 WebRTC DataChannel（局域网多设备，T2 只负责候课信令）；
// T2 Supabase Realtime（在线时并行）。
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

export interface P2PHealth {
  state: "unsupported" | "signaling" | "connecting" | "connected" | "failed";
  peers: number;
  latencyMs: number | null;
  reason?: "no-signal" | "no-candidate" | "ice-failed";
  candidateTypes?: string[];
}

type WirePayload = { kind: "ev"; event: SessionEvent } | { kind: "fx"; fx: FxMessage };
type Signal = {
  from: string;
  to?: string;
  action: "hello" | "offer" | "answer" | "ice";
  initiator?: boolean;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

export interface P2PSignalBus {
  send(signal: Signal): void;
  subscribe(listener: (signal: Signal) => void): () => void;
  /** 仅由 T2 transport 绑定实际 Realtime 发送函数。 */
  connect(sender: (signal: Signal) => void): () => void;
  /** 仅由 T2 transport 投递远端信令。 */
  deliver(signal: Signal): void;
}

/** T1 与 T2 共用一个 Supabase channel，避免同 topic 重复订阅破坏 presence 注册。 */
export function createP2PSignalBus(): P2PSignalBus {
  const listeners = new Set<(signal: Signal) => void>();
  let sender: ((signal: Signal) => void) | null = null;
  return {
    send(signal) { sender?.(signal); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    connect(next) { sender = next; return () => { if (sender === next) sender = null; }; },
    deliver(signal) { for (const listener of listeners) listener(signal); },
  };
}

const CHUNK_BYTES = 9 * 1024;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * ICE 服务器（env 内联，构建期确定）。浏览器把 host 候选混淆成 mDNS `.local`，
 * 同机双窗能解析、跨设备（手机↔电脑）经常解析不了——所以**局域网内的 coturn 是
 * 直连成败的关键**：LAN STUN 返回的 srflx 就是客户端真实局域网地址（中间无 NAT），
 * 完全绕开 mDNS；LAN TURN 兜底 AP 隔离（中继仍在局域网内，断外网可用）。
 * 未配置时回落公网 STUN（Google 国内不可达、Cloudflare 不稳，仅聊胜于无）。
 */
function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [];
  const stun = process.env.NEXT_PUBLIC_WEBRTC_STUN;
  if (stun) {
    for (const part of stun.split(",")) {
      const url = part.trim();
      if (url) servers.push({ urls: url });
    }
  }
  const turn = process.env.NEXT_PUBLIC_WEBRTC_TURN;
  const turnUser = process.env.NEXT_PUBLIC_WEBRTC_TURN_USER;
  const turnPass = process.env.NEXT_PUBLIC_WEBRTC_TURN_PASS;
  if (turn && turnUser && turnPass) servers.push({ urls: turn, username: turnUser, credential: turnPass });
  if (servers.length === 0) {
    servers.push({ urls: "stun:stun.cloudflare.com:3478" }, { urls: "stun:stun.l.google.com:19302" });
  }
  return servers;
}

/** 单轮配对超时：超过该时长仍未打开任何 DataChannel 就拆掉重来（周期 hello 触发新一轮）。 */
const PAIR_TIMEOUT_MS = 12000;

/**
 * T1：控制端与展示/学生端组成星形局域网。Realtime 仅交换 SDP/ICE；DataChannel
 * 一旦连通，即使拔掉外网也会继续工作。优先使用 host candidate；STUN/TURN 用于
 * host（mDNS）跨设备解析失败时发现可达地址，课堂数据仅在 AP 隔离时走 TURN 中继。
 */
export function createP2PTransport(
  signaling: P2PSignalBus,
  peerId: string,
  initiator: boolean,
  onEvent: (ev: SessionEvent) => void,
  onFx: (fx: FxMessage) => void,
  onHealth: (health: P2PHealth) => void,
): Transport | null {
  if (typeof RTCPeerConnection === "undefined") {
    onHealth({ state: "unsupported", peers: 0, latencyMs: null });
    return null;
  }

  const peers = new Map<string, { pc: RTCPeerConnection; dc: RTCDataChannel | null; ice: RTCIceCandidateInit[]; since: number }>();
  const chunks = new Map<string, { total: number; parts: string[] }>();
  const pings = new Map<string, number>();
  const candidateTypes = new Set<string>();
  const startedAt = Date.now();
  let latencyMs: number | null = null;
  let helloTimer: ReturnType<typeof setInterval> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let watchdogTimer: ReturnType<typeof setInterval> | null = null;

  const report = (state?: P2PHealth["state"], reason?: P2PHealth["reason"]) => {
    const connected = [...peers.values()].filter((peer) => peer.dc?.readyState === "open").length;
    onHealth({
      state: state ?? (connected > 0 ? "connected" : "connecting"),
      peers: connected,
      latencyMs,
      reason,
      candidateTypes: [...candidateTypes],
    });
  };

  const signal = (payload: Omit<Signal, "from">) => {
    signaling.send({ ...payload, from: peerId });
  };

  const consumeText = (text: string, dc: RTCDataChannel) => {
    try {
      const message = JSON.parse(text) as
        | WirePayload
        | { kind: "chunk"; id: string; index: number; total: number; data: string }
        | { kind: "ping" | "pong"; id: string };
      if (message.kind === "ev") onEvent(message.event);
      else if (message.kind === "fx") onFx(message.fx);
      else if (message.kind === "ping") dc.send(JSON.stringify({ kind: "pong", id: message.id }));
      else if (message.kind === "pong") {
        const sent = pings.get(message.id);
        if (sent) {
          latencyMs = Math.round(performance.now() - sent);
          pings.delete(message.id);
          report("connected");
        }
      } else if (message.kind === "chunk") {
        const entry = chunks.get(message.id) ?? { total: message.total, parts: new Array<string>(message.total) };
        entry.parts[message.index] = message.data;
        chunks.set(message.id, entry);
        if (entry.parts.filter(Boolean).length === entry.total) {
          chunks.delete(message.id);
          const byteParts = entry.parts.map(base64ToBytes);
          const size = byteParts.reduce((sum, part) => sum + part.length, 0);
          const merged = new Uint8Array(size);
          let offset = 0;
          for (const part of byteParts) { merged.set(part, offset); offset += part.length; }
          consumeText(new TextDecoder().decode(merged), dc);
        }
      }
    } catch {
      // 畸形/过期数据不影响课堂主通道。
    }
  };

  const bindDataChannel = (remoteId: string, dc: RTCDataChannel) => {
    const peer = peers.get(remoteId);
    if (!peer) return;
    peer.dc = dc;
    dc.onmessage = (event) => { if (typeof event.data === "string") consumeText(event.data, dc); };
    dc.onopen = () => report("connected");
    dc.onclose = () => report();
    dc.onerror = () => report("failed");
  };

  const ensurePeer = (remoteId: string) => {
    const existing = peers.get(remoteId);
    if (existing) return existing;
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    const peer = { pc, dc: null as RTCDataChannel | null, ice: [] as RTCIceCandidateInit[], since: Date.now() };
    peers.set(remoteId, peer);
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        candidateTypes.add(candidate.type || "host");
        signal({ action: "ice", to: remoteId, candidate: candidate.toJSON() });
      }
    };
    pc.onicecandidateerror = () => {
      // 单个 STUN 不可达不判失败；host 或另一个 STUN candidate 仍可能成功。
      report();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") report("failed", "ice-failed");
      else report();
    };
    pc.ondatachannel = ({ channel: dc }) => bindDataChannel(remoteId, dc);
    return peer;
  };

  const makeOffer = async (remoteId: string) => {
    const peer = ensurePeer(remoteId);
    if (peer.dc && peer.dc.readyState !== "closed") return;
    if (peer.pc.signalingState !== "stable") return;
    bindDataChannel(remoteId, peer.pc.createDataChannel("mathin-class", { ordered: true }));
    const description = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(description);
    signal({ action: "offer", to: remoteId, description });
    report("connecting");
  };

  const handleSignal = async (message: Signal) => {
    if (!message?.from || message.from === peerId || (message.to && message.to !== peerId)) return;
    if (message.action === "hello") {
      // 两台设备都用教师默认 URL 时都会是 control。此时按 device id 确定唯一
      // offer 方，避免双方同时 offer 后互相拒绝（WebRTC glare）。普通 control ↔
      // display/viewer 仍由 control 发起；两个非 control 也能确定性配对。
      const remoteInitiator = Boolean(message.initiator);
      const shouldOffer = initiator !== remoteInitiator ? initiator : peerId < message.from;
      if (shouldOffer) await makeOffer(message.from);
      return;
    }
    const peer = ensurePeer(message.from);
    if (message.action === "offer" && message.description) {
      await peer.pc.setRemoteDescription(message.description);
      for (const candidate of peer.ice.splice(0)) await peer.pc.addIceCandidate(candidate);
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      signal({ action: "answer", to: message.from, description: answer });
    } else if (message.action === "answer" && message.description) {
      await peer.pc.setRemoteDescription(message.description);
      for (const candidate of peer.ice.splice(0)) await peer.pc.addIceCandidate(candidate);
    } else if (message.action === "ice" && message.candidate) {
      if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(message.candidate);
      else peer.ice.push(message.candidate);
    }
  };

  onHealth({ state: "signaling", peers: 0, latencyMs: null });
  const unsubscribeSignal = signaling.subscribe((message) => {
    void handleSignal(message).catch(() => report("failed"));
  });
  signal({ action: "hello", initiator });
  helloTimer = setInterval(() => signal({ action: "hello", initiator }), 3000);
  // 看门狗每轮都生效（不是只在首轮）：任何一轮协商卡死都会被拆掉，
  // 周期 hello 自动触发新一轮——手机切 WiFi、关 VPN 后无需刷新页面即可恢复。
  watchdogTimer = setInterval(() => {
    if (Date.now() - startedAt < PAIR_TIMEOUT_MS) return;
    if ([...peers.values()].some((peer) => peer.dc?.readyState === "open")) return;
    let toreDown = false;
    for (const [id, peer] of peers) {
      if (Date.now() - peer.since < PAIR_TIMEOUT_MS) continue;
      peer.dc?.close();
      peer.pc.close();
      peers.delete(id);
      toreDown = true;
    }
    if (toreDown || peers.size === 0) {
      report("failed", !toreDown ? "no-signal" : candidateTypes.size === 0 ? "no-candidate" : "ice-failed");
    }
  }, 4000);
  pingTimer = setInterval(() => {
    for (const peer of peers.values()) {
      if (peer.dc?.readyState !== "open") continue;
      const id = newId();
      pings.set(id, performance.now());
      peer.dc.send(JSON.stringify({ kind: "ping", id }));
    }
  }, 2000);

  const broadcast = (payload: WirePayload) => {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    for (const peer of peers.values()) {
      const dc = peer.dc;
      if (dc?.readyState !== "open") continue;
      if (bytes.length <= CHUNK_BYTES) dc.send(new TextDecoder().decode(bytes));
      else {
        const id = newId();
        const total = Math.ceil(bytes.length / CHUNK_BYTES);
        for (let index = 0; index < total; index += 1) {
          dc.send(JSON.stringify({ kind: "chunk", id, index, total, data: bytesToBase64(bytes.slice(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES)) }));
        }
      }
    }
  };

  return {
    kind: "p2p",
    send: (event) => broadcast({ kind: "ev", event }),
    sendFx: (fx) => broadcast({ kind: "fx", fx }),
    close() {
      unsubscribeSignal();
      if (helloTimer) clearInterval(helloTimer);
      if (pingTimer) clearInterval(pingTimer);
      if (watchdogTimer) clearInterval(watchdogTimer);
      for (const peer of peers.values()) { peer.dc?.close(); peer.pc.close(); }
      peers.clear();
      onHealth({ state: "signaling", peers: 0, latencyMs: null });
    },
  };
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
  signaling?: P2PSignalBus,
): Transport {
  const authoritativeTopic = `session:${sessionId}:authoritative`;
  const clientTopic = `session:${sessionId}:client`;
  const presenceTopic = `session:${sessionId}`;
  let authoritativeChannel: RealtimeChannel | null = null;
  let clientChannel: RealtimeChannel | null = null;
  let presenceChannel: RealtimeChannel | null = null;
  let authoritativeJoined = false;
  let clientJoined = false;
  let presenceJoined = !presence;
  let closed = false;
  let disconnectSignal: (() => void) | null = null;

  const start = async () => {
    // 私有频道必须先注入用户 token（supabase-js 不会自动做，P4-2 验证过的坑）
    const { data: { session } } = await supabase.auth.getSession();
    await supabase.realtime.setAuth(session?.access_token ?? null);
    if (closed) return;
    const reportStatus = () => onStatus?.(authoritativeJoined && clientJoined && presenceJoined);
    authoritativeChannel = supabase.channel(authoritativeTopic, {
      config: { private: true, broadcast: { self: false } },
    });
    clientChannel = supabase.channel(clientTopic, {
      config: { private: true, broadcast: { self: false } },
    });
    authoritativeChannel.on("broadcast", { event: "ev" }, ({ payload }) => {
      onEvent(payload as SessionEvent);
    });
    clientChannel.on("broadcast", { event: "ev" }, ({ payload }) => {
      onEvent(payload as SessionEvent);
    });
    authoritativeChannel.on("broadcast", { event: "fx" }, ({ payload }) => {
      onFx?.(payload as FxMessage);
    });
    if (signaling) {
      clientChannel.on("broadcast", { event: "p2p-signal" }, ({ payload }) => {
        signaling.deliver(payload as Signal);
      });
      disconnectSignal = signaling.connect((payload) => {
        if (clientJoined && clientChannel) void clientChannel.send({ type: "broadcast", event: "p2p-signal", payload });
      });
    }
    if (presence) {
      presenceChannel = supabase.channel(presenceTopic, {
        config: { private: true, presence: { key: presence.key } },
      });
      presenceChannel.on("presence", { event: "sync" }, () => {
        const state = presenceChannel?.presenceState<PresencePeer>() ?? {};
        presence.onPeers(
          Object.values(state)
            .map((metas) => metas[0])
            .filter((peer): peer is PresencePeer & { presence_ref: string } => Boolean(peer?.userId)),
        );
      });
      presenceChannel.subscribe((status) => {
        presenceJoined = status === "SUBSCRIBED";
        reportStatus();
        if (presenceJoined && presenceChannel) void presenceChannel.track(presence.meta);
      });
    }
    authoritativeChannel.subscribe((status) => {
      authoritativeJoined = status === "SUBSCRIBED";
      reportStatus();
    });
    clientChannel.subscribe((status) => {
      clientJoined = status === "SUBSCRIBED";
      reportStatus();
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
      const isClientEvent = ev.type === "hand" || ev.type === "answer";
      const channel = isClientEvent ? clientChannel : authoritativeChannel;
      const joined = isClientEvent ? clientJoined : authoritativeJoined;
      if (joined && channel) void channel.send({ type: "broadcast", event: "ev", payload: ev });
    },
    sendFx(fx) {
      if (authoritativeJoined && authoritativeChannel) {
        void authoritativeChannel.send({ type: "broadcast", event: "fx", payload: fx });
      }
    },
    close() {
      closed = true;
      authoritativeJoined = false;
      clientJoined = false;
      presenceJoined = false;
      authListener.subscription.unsubscribe();
      disconnectSignal?.();
      if (authoritativeChannel) void supabase.removeChannel(authoritativeChannel);
      if (clientChannel) void supabase.removeChannel(clientChannel);
      if (presenceChannel) void supabase.removeChannel(presenceChannel);
      onStatus?.(false);
    },
  };
}
