import { newId } from "@/lib/uuid";
import type { SessionEvent, SessionEventType } from "../types";
import { STORE_META, STORE_OUTBOX, idbGet, idbListByIndex, idbPut } from "./idb";
import type { FxMessage, Transport } from "./transports";
import { classroomToolInstanceKey, parseClassroomToolState } from "@/features/tools/courseware/cube-structures-classroom";

// 课堂事件流（08-§3.4）：一切操作先写本地（内存 + outbox），UI 零等待网络；
// 幂等靠客户端 uuid 主键 + (deviceId, seq)，排序靠单写者天然有序。

const DEVICE_KEY = "mathin-session-writer";

/**
 * 写者身份按「窗口」而非「设备」——T0 双窗同源共享 localStorage，共用一个
 * device_id 会撞 seq，所以存 sessionStorage（每标签页独立、刷新存续）。
 */
export function getDeviceId(): string {
  try {
    const existing = sessionStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const id = newId();
    sessionStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return newId();
  }
}

type Listener = (ev: SessionEvent, local: boolean) => void;

export class SessionEventLog {
  readonly sessionId: string;
  readonly userId: string;
  readonly deviceId: string;
  /** 试讲模式：事件只在本窗口内存里生效——不写 outbox、不回传 DB（传输层也不挂）。 */
  readonly ephemeral: boolean;
  private seq = 0;
  private seen = new Set<string>();
  private listeners = new Set<Listener>();
  private fxListeners = new Set<(fx: FxMessage) => void>();
  private transports: Transport[] = [];
  private restoredTools: SessionEvent[] = [];
  private toolReplay = new Map<string, { event: SessionEvent; sequences: Record<string, number> }>();

  /** 刷新后补回尚未入库的本账号工具快照；试讲始终为空。 */
  get recoveredToolEvents(): readonly SessionEvent[] { return this.restoredTools; }
  get latestToolEvents(): readonly SessionEvent[] { return [...this.toolReplay.values()].map(({ event }) => event); }

  /** 为晚加入／重连保留每个组件的最新完整快照，重发沿用原 ID，不新增课堂记录。 */
  rememberToolStates(events: readonly SessionEvent[]): void {
    for (const event of events) {
      if (event.type !== "tool_state" || event.sessionId !== this.sessionId || !event.deviceId || !Number.isSafeInteger(event.seq) || event.seq < 1) continue;
      const payload = parseClassroomToolState(event.payload);
      if (!payload) continue;
      const key = `${payload.pageId}:${classroomToolInstanceKey(payload.docId, payload.instanceId, payload.originHash)}`;
      const previous = this.toolReplay.get(key);
      if ((previous?.sequences[event.deviceId] ?? 0) >= event.seq) continue;
      this.toolReplay.set(key, { event, sequences: { ...previous?.sequences, [event.deviceId]: event.seq } });
    }
  }

  rebroadcastToolStates(): void {
    for (const { event } of this.toolReplay.values()) {
      this.sendToolEvent(event);
    }
  }

  private sendToolEvent(event: SessionEvent): void {
    for (const transport of this.transports) {
      // 已持久化的快照可从其他链路和 outbox 恢复；单路断连保留其成功保存状态。
      try { transport.send(event); } catch { /* 重连后沿用原 ID 重放。 */ }
    }
  }

  private constructor(sessionId: string, userId: string, deviceId: string, ephemeral: boolean) {
    this.sessionId = sessionId;
    this.userId = userId;
    this.deviceId = deviceId;
    this.ephemeral = ephemeral;
  }

  /** seq 水位取 max(meta 记录, outbox 残留)——崩溃恢复后不回退、不撞唯一约束。 */
  static async create(sessionId: string, userId: string, opts?: { ephemeral?: boolean }): Promise<SessionEventLog> {
    const log = new SessionEventLog(sessionId, userId, getDeviceId(), Boolean(opts?.ephemeral));
    if (log.ephemeral) return log;
    const saved = (await idbGet<number>(STORE_META, log.metaKey())) ?? 0;
    const pending = await idbListByIndex<SessionEvent>(STORE_OUTBOX, "sessionId", sessionId);
    log.restoredTools = pending.filter((ev) => ev.type === "tool_state" && ev.userId === userId)
      .sort((a, b) => a.at.localeCompare(b.at) || a.seq - b.seq);
    let maxPending = 0;
    for (const ev of pending) {
      log.seen.add(ev.id);
      if (ev.deviceId === log.deviceId && ev.seq > maxPending) maxPending = ev.seq;
    }
    log.seq = Math.max(saved, maxPending);
    return log;
  }

  private metaKey(): string {
    return `${this.sessionId}:${this.deviceId}`;
  }

  attach(transport: Transport | null): void {
    if (transport) this.transports.push(transport);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 从 DB 加载的历史事件先标已见，避免 T2 迟到重放造成重复应用。 */
  markSeen(ids: Iterable<string>): void {
    for (const id of ids) this.seen.add(id);
  }

  /** 追加本地事件：写 outbox → 本地立即生效 → 发往所有传输层。 */
  async append(type: SessionEventType, payload: Record<string, unknown>): Promise<SessionEvent> {
    this.seq += 1;
    const ev: SessionEvent = {
      id: newId(),
      sessionId: this.sessionId,
      userId: this.userId,
      deviceId: this.deviceId,
      seq: this.seq,
      type,
      payload,
      at: new Date().toISOString(),
    };
    this.seen.add(ev.id);
    if (!this.ephemeral) {
      // outbox 先落盘再回显：宁可 UI 慢一帧，不丢已展示过的事件
      await idbPut(STORE_OUTBOX, ev.id, ev);
      try { await idbPut(STORE_META, this.metaKey(), this.seq); } catch (error) {
        // 工具快照已落盘，seq 可从 outbox 恢复；元数据失败不误报模型未保存。
        if (type !== "tool_state") throw error;
      }
    }
    this.emit(ev, true);
    if (type === "tool_state") this.sendToolEvent(ev);
    else for (const transport of this.transports) transport.send(ev);
    return ev;
  }

  /** 传输层收到远端事件：按 id 去重后应用（同一事件可能从 T0/T2 各到一次）。 */
  ingest = (ev: SessionEvent): void => {
    if (!ev?.id || this.seen.has(ev.id)) return;
    if (ev.type === "tool_state" && ev.sessionId !== this.sessionId) return;
    this.seen.add(ev.id);
    this.emit(ev, false);
  };

  // --- fx 短命通道（板书笔迹流/视频对时等，高频可丢，不落库、不去重）-----

  onFx(listener: (fx: FxMessage) => void): () => void {
    this.fxListeners.add(listener);
    return () => this.fxListeners.delete(listener);
  }

  sendFx(fx: FxMessage): void {
    for (const transport of this.transports) transport.sendFx(fx);
  }

  /** 传输层收到远端 fx：直接分发（同一 fx 可能 T0/T2 各到一次，接收方需幂等，
   *  板书 op 靠 stroke id 判重、对时类天然幂等）。 */
  ingestFx = (fx: FxMessage): void => {
    if (!fx?.scope) return;
    for (const listener of this.fxListeners) listener(fx);
  };

  close(): void {
    for (const transport of this.transports) transport.close();
    this.transports = [];
    this.listeners.clear();
    this.fxListeners.clear();
    this.toolReplay.clear();
  }

  private emit(ev: SessionEvent, local: boolean): void {
    if (ev.type === "tool_state") this.rememberToolStates([ev]);
    for (const listener of this.listeners) listener(ev, local);
  }
}
