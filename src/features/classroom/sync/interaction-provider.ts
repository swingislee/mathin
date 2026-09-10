export const CLASSROOM_INTERACTION_SYNC_SCHEMA = "mathin-classroom-interaction-sync";
export const CLASSROOM_INTERACTION_SYNC_VERSION = 1;

export type ClassroomInteractionSyncMode = "snapshot" | "commands" | "read-only";
export type ClassroomInteractionSyncProtocol =
  | "page-navigation-v1"
  | "viewport-v1"
  | "game-mirror-v1"
  | "doc-step-v1"
  | "h5-state-v1"
  | "tool-state-v1"
  | "spatial-command-v1"
  | "unregistered-v1";

export interface ClassroomInteractionSyncProvider {
  schema: typeof CLASSROOM_INTERACTION_SYNC_SCHEMA;
  version: typeof CLASSROOM_INTERACTION_SYNC_VERSION;
  mode: ClassroomInteractionSyncMode;
  protocol: ClassroomInteractionSyncProtocol;
  /** Durable event type. Read-only providers deliberately publish no event. */
  eventType: "page" | "game_state" | "doc_step" | "tool_state" | "session_ctl" | null;
  /** Hard payload budget for one durable event. Read-only providers use zero. */
  maxPayloadBytes: number;
}

export const CLASSROOM_GAME_MIRROR_SYNC_V1 = Object.freeze({
  schema: CLASSROOM_INTERACTION_SYNC_SCHEMA,
  version: CLASSROOM_INTERACTION_SYNC_VERSION,
  mode: "snapshot",
  protocol: "game-mirror-v1",
  eventType: "game_state",
  maxPayloadBytes: 32 * 1_024,
} satisfies ClassroomInteractionSyncProvider);

export const CLASSROOM_DOC_STEP_SYNC_V1 = Object.freeze({
  schema: CLASSROOM_INTERACTION_SYNC_SCHEMA,
  version: CLASSROOM_INTERACTION_SYNC_VERSION,
  mode: "commands",
  protocol: "doc-step-v1",
  eventType: "doc_step",
  maxPayloadBytes: 4 * 1_024,
} satisfies ClassroomInteractionSyncProvider);

/** 窗口和 iframe 翻页键均由教师写入既有 page 事件；晚加入者读取 current_page 基线。 */
export const CLASSROOM_PAGE_NAVIGATION_SYNC_V1 = Object.freeze({
  schema: CLASSROOM_INTERACTION_SYNC_SCHEMA,
  version: CLASSROOM_INTERACTION_SYNC_VERSION,
  mode: "commands",
  protocol: "page-navigation-v1",
  eventType: "page",
  maxPayloadBytes: 64,
} satisfies ClassroomInteractionSyncProvider);

export const CLASSROOM_VIEWPORT_SYNC_V1 = Object.freeze({
  schema: CLASSROOM_INTERACTION_SYNC_SCHEMA,
  version: CLASSROOM_INTERACTION_SYNC_VERSION,
  mode: "snapshot",
  protocol: "viewport-v1",
  eventType: "session_ctl",
  maxPayloadBytes: 1024,
} satisfies ClassroomInteractionSyncProvider);

/** Mathin-authored H5 remains classroom-read-only until it implements state replay. */
export const CLASSROOM_H5_STATE_SYNC_REQUIRED_V1 = Object.freeze({
  schema: CLASSROOM_INTERACTION_SYNC_SCHEMA,
  version: CLASSROOM_INTERACTION_SYNC_VERSION,
  mode: "read-only",
  protocol: "h5-state-v1",
  eventType: null,
  maxPayloadBytes: 0,
} satisfies ClassroomInteractionSyncProvider);

/** 已接入的固定立方体组件逐实例回放；预算为整条 payload 的 UTF-8 字节。 */
export const CLASSROOM_TOOL_STATE_SYNC_V1 = Object.freeze({
  schema: CLASSROOM_INTERACTION_SYNC_SCHEMA,
  version: CLASSROOM_INTERACTION_SYNC_VERSION,
  mode: "snapshot",
  protocol: "tool-state-v1",
  eventType: "tool_state",
  maxPayloadBytes: 512_000,
} satisfies ClassroomInteractionSyncProvider);

/** 尚未接入回放的工具保留只读合同。 */
export const CLASSROOM_TOOL_STATE_SYNC_REQUIRED_V1 = Object.freeze({
  schema: CLASSROOM_INTERACTION_SYNC_SCHEMA,
  version: CLASSROOM_INTERACTION_SYNC_VERSION,
  mode: "read-only",
  protocol: "tool-state-v1",
  eventType: null,
  maxPayloadBytes: 0,
} satisfies ClassroomInteractionSyncProvider);

/** Spatial pages stay read-only until semantic commands and snapshots join the event log. */
export const CLASSROOM_SPATIAL_COMMAND_SYNC_REQUIRED_V1 = Object.freeze({
  schema: CLASSROOM_INTERACTION_SYNC_SCHEMA,
  version: CLASSROOM_INTERACTION_SYNC_VERSION,
  mode: "read-only",
  protocol: "spatial-command-v1",
  eventType: null,
  maxPayloadBytes: 0,
} satisfies ClassroomInteractionSyncProvider);

export const CLASSROOM_UNREGISTERED_INTERACTION_READ_ONLY_V1 = Object.freeze({
  schema: CLASSROOM_INTERACTION_SYNC_SCHEMA,
  version: CLASSROOM_INTERACTION_SYNC_VERSION,
  mode: "read-only",
  protocol: "unregistered-v1",
  eventType: null,
  maxPayloadBytes: 0,
} satisfies ClassroomInteractionSyncProvider);

export function isClassroomInteractionSyncProvider(
  value: unknown,
): value is ClassroomInteractionSyncProvider {
  if (!value || typeof value !== "object") return false;
  const provider = value as Partial<ClassroomInteractionSyncProvider>;
  const protocol = provider.protocol;
  const protocolValid = protocol === "page-navigation-v1"
    || protocol === "viewport-v1"
    || protocol === "game-mirror-v1"
    || protocol === "doc-step-v1"
    || protocol === "h5-state-v1"
    || protocol === "tool-state-v1"
    || protocol === "spatial-command-v1"
    || protocol === "unregistered-v1";
  if (provider.schema !== CLASSROOM_INTERACTION_SYNC_SCHEMA
    || provider.version !== CLASSROOM_INTERACTION_SYNC_VERSION
    || !protocolValid) return false;
  if (provider.mode === "read-only") {
    return (provider.protocol === "h5-state-v1"
      || provider.protocol === "tool-state-v1"
      || provider.protocol === "spatial-command-v1"
      || provider.protocol === "unregistered-v1")
      && provider.eventType === null
      && provider.maxPayloadBytes === 0;
  }
  const activeProtocolValid = (provider.protocol === "page-navigation-v1"
      && provider.mode === "commands"
      && provider.eventType === "page")
    || (provider.protocol === "viewport-v1"
      && provider.mode === "snapshot"
      && provider.eventType === "session_ctl")
    || (provider.protocol === "game-mirror-v1"
      && provider.mode === "snapshot"
      && provider.eventType === "game_state")
    || (provider.protocol === "doc-step-v1"
      && provider.mode === "commands"
      && provider.eventType === "doc_step")
    || (provider.protocol === "tool-state-v1"
      && provider.mode === "snapshot"
      && provider.eventType === "tool_state");
  return activeProtocolValid
    && typeof provider.maxPayloadBytes === "number"
    && Number.isSafeInteger(provider.maxPayloadBytes)
    && provider.maxPayloadBytes > 0;
}

export function classroomInteractionSyncAttributes(
  surface: string,
  provider: ClassroomInteractionSyncProvider | null,
) {
  return {
    "data-classroom-sync-surface": surface,
    "data-classroom-sync-provider": provider?.schema,
    "data-classroom-sync-version": provider?.version,
    "data-classroom-sync-mode": provider?.mode,
    "data-classroom-sync-protocol": provider?.protocol,
    "data-classroom-sync-event": provider?.eventType ?? undefined,
  } as const;
}

export function classroomInteractionPayloadWithinBudget(
  provider: ClassroomInteractionSyncProvider,
  payload: unknown,
): boolean {
  if (provider.mode === "read-only" || provider.maxPayloadBytes <= 0) return false;
  try {
    return new TextEncoder().encode(JSON.stringify(payload)).byteLength <= provider.maxPayloadBytes;
  } catch {
    return false;
  }
}
