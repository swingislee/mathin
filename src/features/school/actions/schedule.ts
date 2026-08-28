"use server";

// ---------------------------------------------------------------------------
// 课表（P4B-4）：student/parent 经白名单 RPC；staff 直查表，RLS 按
// schedule.view.all（全校）或本人任教（otherwise）自然收窄，教师名在此合并进结果。
// ---------------------------------------------------------------------------

import { z } from "zod";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ScheduleEntry } from "../schedule";
import { datetime, parse, uuid } from "./schemas";
import { nullableRpcArg } from "./guards";

interface MySchedRow {
  session_id: string;
  student_id: string;
  classroom_id: string;
  classroom_name: string;
  lecture_name: string;
  scheduled_at: string;
  duration_min: number | null;
  teacher_name: string | null;
  student_name: string | null;
}

interface StaffScheduleV2Row {
  session_id: string;
  classroom_id: string;
  classroom_name: string;
  lecture_name: string;
  scheduled_at: string;
  duration_min: number | null;
  teacher_name: string | null;
  room_id: string | null;
  room_name: string | null;
  campus_id: string | null;
  campus_name: string | null;
  room_assignment_origin: "class_default" | "session_override" | null;
}

const rangeSchema = z.object({ fromIso: datetime, toIso: datetime, campusId: uuid.nullable(), roomId: uuid.nullable() });

export async function getWeekSchedule(
  fromIso: string,
  toIso: string,
  campusId: string | null = null,
  roomId: string | null = null,
): Promise<ScheduleEntry[]> {
  const range = parse(rangeSchema, { fromIso, toIso, campusId, roomId });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  const profile = await getProfile(user.id);
  if (!profile) return [];

  if (profile.role === "student" || profile.role === "parent") {
    const { data, error } = await supabase.rpc("get_my_schedule", { p_from: range.fromIso, p_to: range.toIso });
    if (error) throw new Error(error.message);
    return ((data ?? []) as MySchedRow[]).map((row) => ({
      sessionId: row.session_id,
      studentId: row.student_id,
      classroomId: row.classroom_id,
      classroomName: row.classroom_name,
      lectureName: row.lecture_name,
      scheduledAt: row.scheduled_at,
      durationMin: row.duration_min ?? 0,
      teacherName: row.teacher_name ?? "",
      studentName: row.student_name ?? "",
      roomId: null,
      roomName: null,
      campusId: null,
      campusName: null,
      roomAssignmentOrigin: null,
    }));
  }

  const { data: sessionRows, error } = await supabase.rpc("get_staff_schedule_v2", {
    p_from: range.fromIso,
    p_to: range.toIso,
    p_campus_id: nullableRpcArg(range.campusId),
    p_room_id: nullableRpcArg(range.roomId),
  });
  if (error) throw new Error(error.message);
  return ((sessionRows ?? []) as StaffScheduleV2Row[]).map((row) => ({
    sessionId: row.session_id,
    studentId: "",
    classroomId: row.classroom_id,
    classroomName: row.classroom_name,
    lectureName: row.lecture_name,
    scheduledAt: row.scheduled_at,
    durationMin: row.duration_min ?? 0,
    teacherName: row.teacher_name ?? "",
    studentName: "",
    roomId: row.room_id,
    roomName: row.room_name,
    campusId: row.campus_id,
    campusName: row.campus_name,
    roomAssignmentOrigin: row.room_assignment_origin,
  }));
}
