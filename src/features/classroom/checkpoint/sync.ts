"use client";

import type { Json } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/client";
import {
  deletePendingBoardCheckpointIfCurrent,
  listPendingBoardCheckpoints,
} from "./outbox";
import { flattenCheckpointChunks, parseSessionBoardCheckpoints } from "./parse";
import type { PendingBoardCheckpoint, SessionBoardCheckpoint } from "./types";

export interface SaveResult {
  accepted: boolean;
  status: "saved" | "idempotent" | "stale" | "conflict";
  version: number;
}

function parseSaveResult(value: unknown): SaveResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("CHECKPOINT_RESPONSE_INVALID");
  const row = value as Record<string, unknown>;
  const status = row.status;
  const version = Number(row.version);
  const accepted = row.accepted;
  if ((status !== "saved" && status !== "idempotent" && status !== "stale" && status !== "conflict")
    || typeof accepted !== "boolean"
    || accepted !== (status === "saved" || status === "idempotent")
    || !Number.isSafeInteger(version) || version < 0
    || (accepted && version < 1)) {
    throw new Error("CHECKPOINT_RESPONSE_INVALID");
  }
  return { accepted, status, version };
}

export async function flushPendingBoardCheckpoint(checkpoint: PendingBoardCheckpoint): Promise<SaveResult> {
  if (checkpoint.scope !== "formal") throw new Error("CHECKPOINT_REHEARSAL_NOT_SYNCABLE");
  flattenCheckpointChunks(checkpoint.chunks, checkpoint.itemCount);
  const supabase = createClient();
  const args = {
    p_session_id: checkpoint.sessionId,
    p_board_key: checkpoint.boardKey,
    p_checkpoint_id: checkpoint.checkpointId,
    p_writer_id: checkpoint.writerId,
    p_writer_seq: checkpoint.writerSeq,
    p_base_version: checkpoint.baseVersion,
    p_item_count: checkpoint.itemCount,
    p_chunks: checkpoint.chunks as unknown as Json,
  };
  let { data, error } = await supabase.rpc("save_session_board_checkpoint", args);
  if (error && /jwt|token|expired|401/i.test(error.message)) {
    const { error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) throw new Error(refreshError.message);
    ({ data, error } = await supabase.rpc("save_session_board_checkpoint", args));
  }
  if (error) throw new Error(error.message);
  const result = parseSaveResult(data);
  if (result.accepted || result.status === "stale") {
    await deletePendingBoardCheckpointIfCurrent(checkpoint.sessionId, checkpoint.boardKey, checkpoint.checkpointId, checkpoint.scope);
  }
  return result;
}

export async function flushBoardCheckpointOutbox(sessionId: string): Promise<Map<string, SaveResult>> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return new Map();
  const pending = await listPendingBoardCheckpoints(sessionId);
  const results = new Map<string, SaveResult>();
  for (const checkpoint of pending.sort((a, b) => a.boardKey.localeCompare(b.boardKey))) {
    results.set(checkpoint.boardKey, await flushPendingBoardCheckpoint(checkpoint));
  }
  return results;
}

export async function fetchBoardCheckpoint(sessionId: string, boardKey: string): Promise<SessionBoardCheckpoint | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_session_board_checkpoints", {
    p_session_id: sessionId,
    p_board_key: boardKey,
  });
  if (error) throw new Error(error.message);
  return parseSessionBoardCheckpoints(data)[0] ?? null;
}
