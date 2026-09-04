"use server";

// ---------------------------------------------------------------------------
// 点名（P4B-5 §5.5）：花名册逐人四态按主键拆分新增/修正；有账号且该 session 有其 user
// 事件的默认预填 present，其余默认 absent，抽屉里都可手动改。请假/调课同属点名域。
// ---------------------------------------------------------------------------

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { ATTENDANCE_STATUSES, type AttendanceStatus } from "../learning";
import { authorizedClient } from "./guards";
import { COMMON_CODES, parse, text, uuid } from "./schemas";
import type { AttendanceDrawerRow, SessionChangeOptions } from "./types";

type UntypedRpc = (name: string, args?: Record<string, unknown>) => PromiseLike<{
  data: unknown;
  error: { message: string } | null;
}>;

function rpc(supabase: { rpc: unknown }): UntypedRpc {
  return supabase.rpc as UntypedRpc;
}

const attendanceDrawerRowsSchema = z.array(z.object({
  studentId: uuid,
  studentName: z.string(),
  status: z.enum(ATTENDANCE_STATUSES),
  note: z.string(),
  marked: z.boolean(),
  historyMismatch: z.boolean(),
})).max(200);

export async function getAttendanceDrawerData(sessionId: string): Promise<ActionResult<AttendanceDrawerRow[]>> {
  try {
    const id = parse(uuid, sessionId);
    const { supabase } = await authorizedClient("attendance.mark");
    const { data, error } = await rpc(supabase)("get_session_attendance_roster_v2", {
      p_session_id: id,
    });
    if (error) throw new Error(error.message);
    return { ok: true, data: parse(attendanceDrawerRowsSchema, data) as AttendanceDrawerRow[] };
  } catch (error) {
    return actionError<AttendanceDrawerRow[]>(error, ["NOT_FOUND", ...COMMON_CODES]);
  }
}

const attendanceRecordSchema = z.object({
  studentId: uuid,
  status: z.enum(ATTENDANCE_STATUSES),
  note: text(500),
});

const saveAttendanceSchema = z.object({
  sessionId: uuid,
  records: z.array(attendanceRecordSchema).max(200),
});

export async function saveAttendanceAction(
  sessionId: string,
  records: Array<{ studentId: string; status: AttendanceStatus; note: string }>,
): Promise<ActionResult> {
  try {
    const value = parse(saveAttendanceSchema, { sessionId, records });
    const { supabase } = await authorizedClient("attendance.mark");
    if (value.records.length === 0) return { ok: true };

    // INSERT RLS 要求学生属于课次锚点名单；历史 mismatch 行仍允许经 UPDATE 修正。
    // 先识别已存在主键，再把新增与更新分开，避免 ON CONFLICT 仍先触发 INSERT policy。
    const { data: existingRows, error: existingError } = await supabase
      .from("session_attendance")
      .select("student_id")
      .eq("session_id", value.sessionId)
      .in("student_id", value.records.map((record) => record.studentId))
      .returns<Array<{ student_id: string }>>();
    if (existingError) throw new Error(existingError.message);
    const existingStudentIds = new Set((existingRows ?? []).map((row) => row.student_id));
    const newRecords = value.records.filter((record) => !existingStudentIds.has(record.studentId));
    const existingRecords = value.records.filter((record) => existingStudentIds.has(record.studentId));
    const writes = [
      ...(newRecords.length > 0 ? [supabase.from("session_attendance").insert(newRecords.map((record) => ({
        session_id: value.sessionId,
        student_id: record.studentId,
        status: record.status,
        note: record.note,
      })))] : []),
      ...existingRecords.map((record) => supabase
        .from("session_attendance")
        .update({ status: record.status, note: record.note })
        .eq("session_id", value.sessionId)
        .eq("student_id", record.studentId)),
    ];
    const writeResults = await Promise.all(writes);
    const writeError = writeResults.find((result) => result.error)?.error;
    if (writeError) throw new Error(writeError.message);

    // P4I-15：点名保存后顺带把课后"点名"任务标记完成（若仍待处理），并对每个缺勤学生
    // 生成 absence_check 支持任务（record_attendance_absence 内部 on conflict 幂等，
    // 重复编辑点名不会重复生成）。这两步失败不应该让已经写入的点名数据回滚展示为失败，
    // 只在控制台记录，不向调用方抛错。
    const absentStudentIds = value.records.filter((record) => record.status === "absent").map((record) => record.studentId);
    await Promise.all(
      absentStudentIds.map((studentId) =>
        supabase.rpc("record_attendance_absence", { p_session_id: value.sessionId, p_student_id: studentId }).then(({ error: rpcError }) => {
          if (rpcError) console.error("record_attendance_absence failed", rpcError.message);
        }),
      ),
    );
    const { data: taskRow } = await supabase
      .from("session_completion_tasks")
      .select("id,status")
      .eq("session_id", value.sessionId)
      .eq("kind", "attendance")
      .maybeSingle<{ id: string; status: string }>();
    if (taskRow && taskRow.status === "pending") {
      const { error: completeError } = await supabase.rpc("complete_session_task", { p_task_id: taskRow.id, p_status: "done", p_note: "" });
      if (completeError) console.error("complete_session_task(attendance) failed", completeError.message);
    }

    return { ok: true };
  } catch (error) {
    return actionError(error, COMMON_CODES);
  }
}

const amendAttendanceStatusSchema = z.object({
  sessionId: uuid,
  record: attendanceRecordSchema,
});

/** Update one student's in-class correction without completing the whole-roster attendance task. */
export async function amendAttendanceStatusAction(
  sessionId: string,
  record: { studentId: string; status: AttendanceStatus; note: string },
): Promise<ActionResult> {
  try {
    const value = parse(amendAttendanceStatusSchema, { sessionId, record });
    const { supabase } = await authorizedClient("attendance.mark");
    const { data: existing, error: existingError } = await supabase
      .from("session_attendance")
      .select("student_id")
      .eq("session_id", value.sessionId)
      .eq("student_id", value.record.studentId)
      .maybeSingle<{ student_id: string }>();
    if (existingError) throw new Error(existingError.message);
    const payload = { status: value.record.status, note: value.record.note };
    const { error } = existing
      ? await supabase.from("session_attendance").update(payload)
        .eq("session_id", value.sessionId)
        .eq("student_id", value.record.studentId)
      : await supabase.from("session_attendance").insert({
        session_id: value.sessionId,
        student_id: value.record.studentId,
        ...payload,
      });
    if (error) throw new Error(error.message);

    if (value.record.status === "absent") {
      const { error: absenceError } = await supabase.rpc("record_attendance_absence", {
        p_session_id: value.sessionId,
        p_student_id: value.record.studentId,
      });
      if (absenceError) console.error("record_attendance_absence failed", absenceError.message);
    }
    return { ok: true };
  } catch (error) {
    return actionError(error, COMMON_CODES);
  }
}

export async function getSessionChangeOptionsAction(sessionId: string): Promise<SessionChangeOptions> {
  const id = parse(uuid, sessionId);
  const { supabase } = await authorizedClient("attendance.mark");
  const { data, error } = await supabase.rpc("get_session_change_options", { p_session_id: id });
  if (error) throw new Error(error.message);
  const value = data as Partial<SessionChangeOptions> | null;
  return { students: value?.students ?? [], targets: value?.targets ?? [] };
}

const sessionChangeSchema = z.object({
  sessionId: uuid,
  studentId: uuid,
  kind: z.enum(["leave", "makeup"]),
  targetSessionId: uuid.nullable(),
  reason: text(1000),
});

export async function recordSessionChangeAction(input: {
  sessionId: string;
  studentId: string;
  kind: "leave" | "makeup";
  targetSessionId: string | null;
  reason: string;
}): Promise<ActionResult> {
  try {
    const value = parse(sessionChangeSchema, input);
    const { supabase } = await authorizedClient("attendance.mark");
    const { error } = await supabase.rpc("record_session_change", {
      p_session_id: value.sessionId,
      p_student_id: value.studentId,
      p_kind: value.kind,
      p_to_session: value.targetSessionId ?? undefined,
      p_reason: value.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, COMMON_CODES);
  }
}
