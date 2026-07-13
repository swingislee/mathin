import { createClient } from "@/lib/supabase/client";
import type { Database, Json } from "@/lib/database.types";
import type { SessionEvent } from "../types";
import { STORE_OUTBOX, idbDelete, idbListByIndex } from "./idb";

// 幂等回传（08-§3.4）：分批 upsert(ignoreDuplicates) = on conflict do nothing；
// 单批失败不影响已成功批次（成功即删 outbox），失败抛错由调用方指数退避。

const BATCH_SIZE = 100;

type SessionEventInsert = Database["public"]["Tables"]["session_events"]["Insert"];

function toRow(ev: SessionEvent): SessionEventInsert {
  return {
    id: ev.id,
    session_id: ev.sessionId,
    user_id: ev.userId,
    device_id: ev.deviceId,
    seq: ev.seq,
    type: ev.type,
    payload: ev.payload as Json,
    at: ev.at,
  };
}

/** 回传该课次的全部待发事件；返回本次入库条数。离线时直接返回 0（不悬挂）。 */
export async function flushOutbox(sessionId: string): Promise<number> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return 0;
  const pending = await idbListByIndex<SessionEvent>(STORE_OUTBOX, "sessionId", sessionId);
  if (pending.length === 0) return 0;

  const supabase = createClient();
  let refreshed = false;
  let flushed = 0;
  for (let offset = 0; offset < pending.length; offset += BATCH_SIZE) {
    const batch = pending.slice(offset, offset + BATCH_SIZE);
    let { error } = await supabase
      .from("session_events")
      .upsert(batch.map(toRow), { onConflict: "id", ignoreDuplicates: true });
    if (error && !refreshed && /jwt|token|expired|401/i.test(error.message)) {
      // 长课 + 断网后旧 token 必失效：刷新一次再重试本批
      refreshed = true;
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) throw new Error(refreshError.message);
      ({ error } = await supabase
        .from("session_events")
        .upsert(batch.map(toRow), { onConflict: "id", ignoreDuplicates: true }));
    }
    if (error) throw new Error(error.message);
    await idbDelete(STORE_OUTBOX, batch.map((ev) => ev.id));
    flushed += batch.length;
  }
  return flushed;
}

/** 待回传条数（候课单/上课页角标用）。 */
export async function pendingCount(sessionId: string): Promise<number> {
  const pending = await idbListByIndex<SessionEvent>(STORE_OUTBOX, "sessionId", sessionId);
  return pending.length;
}
