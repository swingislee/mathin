"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { COLOR_TOKENS, type StrokeItem, type WhiteboardMeta, type WhiteboardRecord } from "./types";

const MAX_SNAPSHOT_BYTES = 1024 * 1024;

const snapshotSchema = z.array(
  z.object({
    id: z.string().min(1).max(64),
    mode: z.enum(["ink", "erase"]),
    color: z.enum(COLOR_TOKENS),
    wNorm: z.number().min(0.0005).max(0.25),
    points: z.array(z.tuple([z.number().min(-0.5).max(1.5), z.number().min(-0.5).max(1.5)])).min(1).max(4000),
  }),
).max(4000);

interface WhiteboardRow {
  id: string;
  title: string;
  updated_at: string;
}

async function authenticatedClient() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return { supabase, user };
}

function toMeta(row: WhiteboardRow): WhiteboardMeta {
  return { id: row.id, title: row.title, updatedAt: row.updated_at };
}

export async function listWhiteboards(): Promise<WhiteboardMeta[]> {
  const { supabase } = await authenticatedClient();
  const { data, error } = await supabase
    .from("whiteboards")
    .select("id,title,updated_at")
    .order("updated_at", { ascending: false })
    .returns<WhiteboardRow[]>();
  if (error) throw new Error(error.message);
  return (data ?? []).map(toMeta);
}

export async function createWhiteboard(): Promise<WhiteboardMeta> {
  const { supabase, user } = await authenticatedClient();
  const { data, error } = await supabase
    .from("whiteboards")
    .insert({ owner_id: user.id, title: "" })
    .select("id,title,updated_at")
    .single<WhiteboardRow>();
  if (error) throw new Error(error.message);
  return toMeta(data);
}

export async function renameWhiteboard(id: string, title: string): Promise<void> {
  const { supabase } = await authenticatedClient();
  const { error } = await supabase
    .from("whiteboards")
    .update({ title: title.trim().slice(0, 200) })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteWhiteboard(id: string): Promise<void> {
  const { supabase } = await authenticatedClient();
  const { error } = await supabase.from("whiteboards").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function getWhiteboard(id: string): Promise<WhiteboardRecord | null> {
  const { supabase, user } = await authenticatedClient();
  const { data, error } = await supabase
    .from("whiteboards")
    .select("id,title,snapshot,updated_at,owner_id")
    .eq("id", id)
    .maybeSingle<WhiteboardRow & { snapshot: unknown; owner_id: string }>();
  if (error) throw new Error(error.message);
  if (!data) return null;

  let canEdit = data.owner_id === user.id;
  if (!canEdit) {
    const { data: membership } = await supabase
      .from("whiteboard_members")
      .select("can_edit")
      .eq("whiteboard_id", id)
      .eq("user_id", user.id)
      .maybeSingle<{ can_edit: boolean }>();
    canEdit = membership?.can_edit ?? false;
  }

  const parsed = snapshotSchema.safeParse(data.snapshot ?? []);
  return {
    ...toMeta(data),
    snapshot: (parsed.success ? parsed.data : []) as StrokeItem[],
    canEdit,
  };
}

export async function saveSnapshot(id: string, items: unknown): Promise<void> {
  const { supabase } = await authenticatedClient();
  const parsed = snapshotSchema.safeParse(items);
  if (!parsed.success) throw new Error("INVALID");
  const snapshot = parsed.data;
  if (JSON.stringify(snapshot).length > MAX_SNAPSHOT_BYTES) throw new Error("TOO_LARGE");
  const { data, error } = await supabase
    .from("whiteboards")
    .update({ snapshot })
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("FORBIDDEN");
}
