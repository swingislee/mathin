"use server";

// ---------------------------------------------------------------------------
// 课表（P4B-4）：student/parent 经白名单 RPC；staff 直查表，RLS 按
// schedule.view.all（全校）或本人任教（otherwise）自然收窄，教师名在此合并进结果。
// ---------------------------------------------------------------------------

import { z } from "zod";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ScheduleEntry } from "../schedule";
import { datetime, parse } from "./schemas";

interface MySchedRow {
  session_id: string;
  classroom_id: string;
  classroom_name: string;
  lecture_name: string;
  scheduled_at: string;
  duration_min: number | null;
  teacher_name: string | null;
  student_name: string | null;
}

interface StaffSessionRow {
  id: string;
  title: string;
  scheduled_at: string;
  duration_min: number | null;
  classroom_id: string;
  classrooms: { name: string; room: string } | null;
}

const rangeSchema = z.object({ fromIso: datetime, toIso: datetime });

export async function getWeekSchedule(fromIso: string, toIso: string): Promise<ScheduleEntry[]> {
  const range = parse(rangeSchema, { fromIso, toIso });
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
      classroomId: row.classroom_id,
      classroomName: row.classroom_name,
      lectureName: row.lecture_name,
      scheduledAt: row.scheduled_at,
      durationMin: row.duration_min ?? 0,
      teacherName: row.teacher_name ?? "",
      studentName: row.student_name ?? "",
      room: "",
    }));
  }

  const { data: sessionRows, error } = await supabase
    .from("class_sessions")
    .select("id,title,scheduled_at,duration_min,classroom_id,classrooms(name,room)")
    .is("deleted_at", null)
    .gte("scheduled_at", range.fromIso)
    .lt("scheduled_at", range.toIso)
    .order("scheduled_at", { ascending: true })
    .returns<StaffSessionRow[]>();
  if (error) throw new Error(error.message);
  const rows = sessionRows ?? [];
  if (rows.length === 0) return [];

  const classroomIds = Array.from(new Set(rows.map((row) => row.classroom_id)));
  const { data: teacherRows, error: teacherError } = await supabase
    .from("classroom_members")
    .select("classroom_id,profiles(display_name)")
    .in("classroom_id", classroomIds)
    .eq("role", "teacher")
    .returns<Array<{ classroom_id: string; profiles: { display_name: string } | null }>>();
  if (teacherError) throw new Error(teacherError.message);
  const teacherByClassroom = new Map<string, string>();
  for (const row of teacherRows ?? []) {
    if (!teacherByClassroom.has(row.classroom_id)) teacherByClassroom.set(row.classroom_id, row.profiles?.display_name ?? "");
  }

  return rows.map((row) => ({
    sessionId: row.id,
    classroomId: row.classroom_id,
    classroomName: row.classrooms?.name || "",
    lectureName: row.title,
    scheduledAt: row.scheduled_at,
    durationMin: row.duration_min ?? 0,
    teacherName: teacherByClassroom.get(row.classroom_id) ?? "",
    studentName: "",
    room: row.classrooms?.room || "",
  }));
}
