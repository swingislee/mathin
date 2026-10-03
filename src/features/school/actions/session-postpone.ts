"use server";

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { staffRpcClient } from "./guards";
import { COMMON_CODES, datetime, intInRange, parse, text, uuid } from "./schemas";
import {
  MAX_SESSION_POSTPONE_DAYS,
  type ApplySessionPostponeInput,
  type SessionPostponeInput,
  type SessionPostponePreview,
} from "../session-postpone-contract";

const inputSchema = z.object({ sessionId: uuid, days: intInRange(1, MAX_SESSION_POSTPONE_DAYS) });
const applySchema = inputSchema.extend({
  expectedToken: z.string().regex(/^[a-f0-9]{32}$/),
  confirmClosedDays: z.boolean(),
  closedDayReason: text(500),
});
const previewSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{32}$/),
  classroomId: uuid,
  sessionId: uuid,
  days: intInRange(1, MAX_SESSION_POSTPONE_DAYS),
  timeZone: z.string().min(1),
  skippedCount: z.number().int().nonnegative(),
  sessions: z.array(z.object({
    id: uuid, title: z.string(), no: z.number().int().nullable(),
    previousScheduledAt: datetime, scheduledAt: datetime,
    durationMin: z.number().nullable(), roomId: uuid.nullable(),
    closedDayId: uuid.nullable(), closedDayName: z.string().nullable(),
  })).min(1),
});
const ERROR_CODES = [
  "FORBIDDEN_SCOPE", "SESSION_NOT_FOUND", "SESSION_NOT_EDITABLE", "SESSION_ALREADY_STARTED",
  "CLASSROOM_NOT_ACTIVE", "SCHEDULE_PREVIEW_STALE", "CLOSED_DAY_CONFIRMATION_REQUIRED",
  "INVALID_SCHEDULE", ...COMMON_CODES,
] as const;

export async function previewSessionPostponeAction(input: SessionPostponeInput): Promise<ActionResult<SessionPostponePreview>> {
  try {
    const value = parse(inputSchema, input);
    // 与单节排课共用数据库作用域：管理员、教务或本班教师。
    const { supabase } = await staffRpcClient();
    const { data, error } = await supabase.rpc("preview_session_schedule_postpone", {
      p_session_id: value.sessionId, p_days: value.days,
    });
    if (error) throw new Error(error.message);
    return { ok: true, data: previewSchema.parse(data) };
  } catch (error) {
    return actionError(error, ERROR_CODES);
  }
}

export async function applySessionPostponeAction(input: ApplySessionPostponeInput): Promise<ActionResult<{ updatedCount: number }>> {
  try {
    const value = parse(applySchema, input);
    const { supabase } = await staffRpcClient();
    const { data, error } = await supabase.rpc("apply_session_schedule_postpone", {
      p_session_id: value.sessionId, p_days: value.days, p_expected_token: value.expectedToken,
      p_confirm_closed_days: value.confirmClosedDays, p_closed_day_reason: value.closedDayReason,
    });
    if (error) throw new Error(error.message);
    return { ok: true, data: z.object({ updatedCount: z.number().int().positive() }).parse(data) };
  } catch (error) {
    return actionError(error, ERROR_CODES);
  }
}
