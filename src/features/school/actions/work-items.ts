"use server";

// ---------------------------------------------------------------------------
// 今日工作的用户状态动作（P4I-17）：已读/稍后处理/置顶/确认/关注。
// 五个 RPC 是 P4I-6 就建好的（`work_item_user_state` 表 + 5 个 SECURITY DEFINER
// 函数），本文件只是「入参校验 + 透传」，业务规则（now 桶禁止 snooze、
// overdue/today 上限 24h、其余上限 14 天、置顶只在同一 urgency_bucket 内生效）
// 全部在 RPC/`list_my_work_items` 里，这里不重复实现。
// ---------------------------------------------------------------------------

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { staffRpcClient } from "./guards";
import { COMMON_CODES, datetime, parse, requiredText } from "./schemas";

const WORK_ITEM_CODES = ["INVALID_WORK_KEY", "INVALID_SNOOZE_UNTIL", "SNOOZE_NOT_ALLOWED", "NOT_FOUND", ...COMMON_CODES] as const;

const workKeySchema = z.object({ workKey: requiredText(200) });

export async function markWorkItemSeenAction(workKey: string): Promise<ActionResult> {
  try {
    const value = parse(workKeySchema, { workKey });
    const { supabase } = await staffRpcClient();
    const { error } = await supabase.rpc("set_work_item_seen", { p_work_key: value.workKey });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, WORK_ITEM_CODES);
  }
}

const snoozeSchema = z.object({ workKey: requiredText(200), until: datetime });

export async function snoozeWorkItemAction(workKey: string, until: string): Promise<ActionResult> {
  try {
    const value = parse(snoozeSchema, { workKey, until });
    const { supabase } = await staffRpcClient();
    const { error } = await supabase.rpc("snooze_work_item", { p_work_key: value.workKey, p_until: value.until });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, WORK_ITEM_CODES);
  }
}

const pinSchema = z.object({ workKey: requiredText(200), pinned: z.boolean() });

export async function pinWorkItemAction(workKey: string, pinned: boolean): Promise<ActionResult> {
  try {
    const value = parse(pinSchema, { workKey, pinned });
    const { supabase } = await staffRpcClient();
    const { error } = await supabase.rpc("pin_work_item", { p_work_key: value.workKey, p_pinned: value.pinned });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, WORK_ITEM_CODES);
  }
}

export async function acknowledgeWorkItemAction(workKey: string): Promise<ActionResult> {
  try {
    const value = parse(workKeySchema, { workKey });
    const { supabase } = await staffRpcClient();
    const { error } = await supabase.rpc("acknowledge_work_item", { p_work_key: value.workKey });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, WORK_ITEM_CODES);
  }
}

const watchSchema = z.object({ workKey: requiredText(200), watching: z.boolean() });

export async function watchWorkItemAction(workKey: string, watching: boolean): Promise<ActionResult> {
  try {
    const value = parse(watchSchema, { workKey, watching });
    const { supabase } = await staffRpcClient();
    const { error } = await supabase.rpc("watch_work_item", { p_work_key: value.workKey, p_watching: value.watching });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, WORK_ITEM_CODES);
  }
}
