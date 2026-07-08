"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type {
  ClassroomMember,
  ClassroomMeta,
  ClassroomRecord,
  ClassroomRole,
  ClassSessionMeta,
  ClassSessionRecord,
  CoursewarePage,
  SessionEvent,
  SessionEventType,
} from "./types";

async function authenticatedClient() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return { supabase, user };
}

export async function listMyClassrooms(): Promise<ClassroomMeta[]> {
  const { supabase, user } = await authenticatedClient();
  const { data, error } = await supabase
    .from("classroom_members")
    .select("role,classrooms(id,name,owner_id,created_at)")
    .eq("user_id", user.id)
    .returns<Array<{ role: ClassroomRole; classrooms: { id: string; name: string; owner_id: string; created_at: string } | null }>>();
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((row) => row.classrooms)
    .map((row) => ({
      id: row.classrooms!.id,
      name: row.classrooms!.name,
      ownerId: row.classrooms!.owner_id,
      createdAt: row.classrooms!.created_at,
      myRole: row.role,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createClassroom(name: string): Promise<string> {
  const { supabase } = await authenticatedClient();
  const { data, error } = await supabase.rpc("create_classroom", { p_name: name.trim().slice(0, 100) });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function joinClassroom(code: string): Promise<string | null> {
  const { supabase } = await authenticatedClient();
  const { data, error } = await supabase.rpc("join_classroom", { p_code: code.trim().toLowerCase() });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

export async function getClassroom(id: string): Promise<ClassroomRecord | null> {
  const { supabase, user } = await authenticatedClient();
  const { data, error } = await supabase
    .from("classrooms")
    .select("id,name,owner_id,created_at")
    .eq("id", id)
    .maybeSingle<{ id: string; name: string; owner_id: string; created_at: string }>();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const { data: memberRows, error: memberError } = await supabase
    .from("classroom_members")
    .select("user_id,role,created_at,profiles(display_name)")
    .eq("classroom_id", id)
    .order("created_at", { ascending: true })
    .returns<Array<{ user_id: string; role: ClassroomRole; created_at: string; profiles: { display_name: string } | null }>>();
  if (memberError) throw new Error(memberError.message);

  const members: ClassroomMember[] = (memberRows ?? []).map((row) => ({
    userId: row.user_id,
    displayName: row.profiles?.display_name || "",
    role: row.role,
  }));
  const myRole = members.find((member) => member.userId === user.id)?.role
    ?? (data.owner_id === user.id ? "teacher" : null);
  if (!myRole) return null;

  let inviteCode: string | null = null;
  if (myRole === "teacher") {
    const { data: code } = await supabase.rpc("get_classroom_invite", { cid: id });
    inviteCode = (code as string | null) ?? null;
  }

  return {
    id: data.id,
    name: data.name,
    ownerId: data.owner_id,
    createdAt: data.created_at,
    myRole,
    members,
    inviteCode,
  };
}

export async function removeClassroomMember(classroomId: string, userId: string): Promise<void> {
  const { supabase } = await authenticatedClient();
  const { error } = await supabase
    .from("classroom_members")
    .delete()
    .eq("classroom_id", classroomId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

export async function leaveClassroom(classroomId: string): Promise<void> {
  const { supabase, user } = await authenticatedClient();
  const { error } = await supabase
    .from("classroom_members")
    .delete()
    .eq("classroom_id", classroomId)
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// 课次与课件（P4-4）
// ---------------------------------------------------------------------------

const pageBase = { id: z.string().uuid(), title: z.string().max(100) };
const coursewareSchema = z
  .array(
    z.discriminatedUnion("type", [
      z.object({ ...pageBase, type: z.literal("image"), path: z.string().min(1).max(500) }),
      z.object({ ...pageBase, type: z.literal("video"), path: z.string().min(1).max(500) }),
      z.object({
        ...pageBase,
        type: z.literal("game"),
        gameId: z.string().min(1).max(50),
        difficulty: z.enum(["easy", "medium", "hard"]),
        seed: z.string().min(1).max(100),
      }),
      z.object({ ...pageBase, type: z.literal("board") }),
    ]),
  )
  .max(200);

interface SessionRow {
  id: string;
  classroom_id: string;
  title: string;
  courseware: CoursewarePage[];
  current_page: number;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

function toSessionMeta(row: SessionRow): ClassSessionMeta {
  return {
    id: row.id,
    classroomId: row.classroom_id,
    title: row.title,
    pageCount: Array.isArray(row.courseware) ? row.courseware.length : 0,
    currentPage: row.current_page,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
  };
}

export async function listClassSessions(classroomId: string): Promise<ClassSessionMeta[]> {
  const { supabase } = await authenticatedClient();
  const { data, error } = await supabase
    .from("class_sessions")
    .select("id,classroom_id,title,courseware,current_page,started_at,ended_at,created_at")
    .eq("classroom_id", classroomId)
    .order("created_at", { ascending: false })
    .returns<SessionRow[]>();
  if (error) throw new Error(error.message);
  return (data ?? []).map(toSessionMeta);
}

export async function createClassSession(classroomId: string, title: string): Promise<string> {
  const { supabase } = await authenticatedClient();
  const { data, error } = await supabase
    .from("class_sessions")
    .insert({ classroom_id: classroomId, title: title.trim().slice(0, 100) })
    .select("id")
    .single<{ id: string }>();
  if (error) throw new Error(error.message);
  return data.id;
}

export async function getClassSession(sessionId: string): Promise<ClassSessionRecord | null> {
  const { supabase } = await authenticatedClient();
  const { data, error } = await supabase
    .from("class_sessions")
    .select("id,classroom_id,title,courseware,current_page,started_at,ended_at,created_at")
    .eq("id", sessionId)
    .maybeSingle<SessionRow>();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { ...toSessionMeta(data), courseware: Array.isArray(data.courseware) ? data.courseware : [] };
}

export async function renameClassSession(sessionId: string, title: string): Promise<void> {
  const { supabase } = await authenticatedClient();
  const { error } = await supabase
    .from("class_sessions")
    .update({ title: title.trim().slice(0, 100) })
    .eq("id", sessionId);
  if (error) throw new Error(error.message);
}

export async function saveCourseware(sessionId: string, pages: CoursewarePage[]): Promise<void> {
  const parsed = coursewareSchema.safeParse(pages);
  if (!parsed.success) throw new Error("INVALID_COURSEWARE");
  const { supabase } = await authenticatedClient();
  const { error } = await supabase
    .from("class_sessions")
    .update({ courseware: parsed.data })
    .eq("id", sessionId);
  if (error) throw new Error(error.message);
}

export async function deleteClassSession(sessionId: string): Promise<void> {
  const { supabase } = await authenticatedClient();
  const { error } = await supabase.from("class_sessions").delete().eq("id", sessionId);
  if (error) throw new Error(error.message);
}

export async function startClassSession(sessionId: string): Promise<void> {
  const { supabase } = await authenticatedClient();
  const { error } = await supabase
    .from("class_sessions")
    .update({ started_at: new Date().toISOString() })
    .eq("id", sessionId)
    .is("started_at", null);
  if (error) throw new Error(error.message);
}

export async function endClassSession(sessionId: string): Promise<void> {
  const { supabase } = await authenticatedClient();
  const { error } = await supabase
    .from("class_sessions")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", sessionId)
    .is("ended_at", null);
  if (error) throw new Error(error.message);
}

/** 上课页初始基线：已入库的课堂事件（离线期间产生的事件在恢复后经 flush 汇入）。 */
export async function listSessionEvents(
  sessionId: string,
  types?: SessionEventType[],
): Promise<SessionEvent[]> {
  const { supabase } = await authenticatedClient();
  let query = supabase
    .from("session_events")
    .select("id,session_id,user_id,device_id,seq,type,payload,at")
    .eq("session_id", sessionId)
    .order("at", { ascending: true })
    .limit(5000);
  if (types && types.length > 0) query = query.in("type", types);
  const { data, error } = await query.returns<
    Array<{ id: string; session_id: string; user_id: string; device_id: string; seq: number; type: SessionEventType; payload: Record<string, unknown>; at: string }>
  >();
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id,
    deviceId: row.device_id,
    seq: row.seq,
    type: row.type,
    payload: row.payload ?? {},
    at: row.at,
  }));
}

export async function getMyProfileRole(): Promise<"student" | "teacher" | "admin"> {
  const { supabase, user } = await authenticatedClient();
  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle<{ role: "student" | "teacher" | "admin" }>();
  return data?.role ?? "student";
}
