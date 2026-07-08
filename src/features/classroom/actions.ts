"use server";

import { createClient } from "@/lib/supabase/server";
import type { ClassroomMember, ClassroomMeta, ClassroomRecord, ClassroomRole } from "./types";

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

export async function getMyProfileRole(): Promise<"student" | "teacher" | "admin"> {
  const { supabase, user } = await authenticatedClient();
  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle<{ role: "student" | "teacher" | "admin" }>();
  return data?.role ?? "student";
}
