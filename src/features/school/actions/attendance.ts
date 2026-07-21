"use server";

// ---------------------------------------------------------------------------
// 点名（P4B-5 §5.5）：花名册逐人四态 upsert；有账号且该 session 有其 user
// 事件的默认预填 present，其余默认 absent，抽屉里都可手动改。请假/调课同属点名域。
// ---------------------------------------------------------------------------

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { ATTENDANCE_STATUSES, type AttendanceStatus } from "../learning";
import { authorizedClient } from "./guards";
import { COMMON_CODES, parse, text, uuid } from "./schemas";
import type { AttendanceDrawerRow, SessionChangeOptions } from "./types";

export async function getAttendanceDrawerData(sessionId: string): Promise<ActionResult<AttendanceDrawerRow[]>> {
  try {
    const id = parse(uuid, sessionId);
    const { supabase } = await authorizedClient("attendance.mark");

    const { data: session, error: sessionError } = await supabase
      .from("class_sessions")
      .select("classroom_id")
      .eq("id", id)
      .maybeSingle<{ classroom_id: string }>();
    if (sessionError) throw new Error(sessionError.message);
    if (!session) throw new Error("NOT_FOUND");

    const [{ data: rosterRows, error: rosterError }, { data: existingRows, error: existingError }, { data: eventRows, error: eventError }] =
      await Promise.all([
        supabase
          .from("enrollments")
          .select("student_id,students(name,user_id)")
          .eq("classroom_id", session.classroom_id)
          .eq("status", "active")
          .returns<Array<{ student_id: string; students: { name: string; user_id: string | null } | null }>>(),
        supabase
          .from("session_attendance")
          .select("student_id,status,note")
          .eq("session_id", id)
          .returns<Array<{ student_id: string; status: AttendanceStatus; note: string }>>(),
        supabase
          .from("session_events")
          .select("user_id")
          .eq("session_id", id)
          .returns<Array<{ user_id: string }>>(),
      ]);
    if (rosterError) throw new Error(rosterError.message);
    if (existingError) throw new Error(existingError.message);
    if (eventError) throw new Error(eventError.message);

    const existingByStudent = new Map((existingRows ?? []).map((row) => [row.student_id, row]));
    const participatedUserIds = new Set((eventRows ?? []).map((row) => row.user_id));

    const rows = (rosterRows ?? []).map((row) => {
      const existing = existingByStudent.get(row.student_id);
      const userId = row.students?.user_id ?? null;
      const defaultStatus: AttendanceStatus = userId && participatedUserIds.has(userId) ? "present" : "absent";
      return {
        studentId: row.student_id,
        studentName: row.students?.name ?? "-",
        status: existing?.status ?? defaultStatus,
        note: existing?.note ?? "",
      };
    });
    return { ok: true, data: rows };
  } catch (error) {
    return actionError<AttendanceDrawerRow[]>(error, ["NOT_FOUND", ...COMMON_CODES]);
  }
}

const saveAttendanceSchema = z.object({
  sessionId: uuid,
  records: z
    .array(z.object({ studentId: uuid, status: z.enum(ATTENDANCE_STATUSES), note: text(500) }))
    .max(200),
});

export async function saveAttendanceAction(
  sessionId: string,
  records: Array<{ studentId: string; status: AttendanceStatus; note: string }>,
): Promise<ActionResult> {
  try {
    const value = parse(saveAttendanceSchema, { sessionId, records });
    const { supabase } = await authorizedClient("attendance.mark");
    if (value.records.length === 0) return { ok: true };
    const { error } = await supabase.from("session_attendance").upsert(
      value.records.map((record) => ({
        session_id: value.sessionId,
        student_id: record.studentId,
        status: record.status,
        note: record.note,
      })),
      { onConflict: "session_id,student_id" },
    );
    if (error) throw new Error(error.message);

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
