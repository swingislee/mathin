"use server";

import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import type { NoteMeta, NoteRecord } from "./types";

interface NoteRow {
  id: string;
  parent_id: string | null;
  title: string;
  icon: string | null;
  is_archived: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

const META_COLUMNS = "id,parent_id,title,icon,is_archived,version,created_at,updated_at";

function toMeta(row: NoteRow): NoteMeta {
  return {
    id: row.id,
    parentId: row.parent_id,
    title: row.title,
    icon: row.icon,
    isArchived: row.is_archived,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function authenticatedClient() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return { supabase, user };
}

export async function listNoteMetas(): Promise<NoteMeta[]> {
  const { supabase, user } = await authenticatedClient();
  const { data, error } = await supabase
    .from("notes")
    .select(META_COLUMNS)
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true })
    .returns<NoteRow[]>();
  if (error) throw new Error(error.message);
  return (data ?? []).map(toMeta);
}

export async function createNote(parentId: string | null, title: string): Promise<NoteMeta> {
  const { supabase, user } = await authenticatedClient();
  const cleanTitle = title.trim().slice(0, 200);
  const { data, error } = await supabase
    .from("notes")
    .insert({ owner_id: user.id, parent_id: parentId, title: cleanTitle })
    .select(META_COLUMNS)
    .single<NoteRow>();
  if (error) throw new Error(error.message);
  return toMeta(data);
}

export async function updateNoteMeta(id: string, patch: { title?: string; icon?: string | null }): Promise<NoteMeta> {
  const { supabase, user } = await authenticatedClient();
  const values: { title?: string; icon?: string | null } = {};
  if (patch.title !== undefined) values.title = patch.title.trim().slice(0, 200);
  if (patch.icon !== undefined) values.icon = patch.icon?.slice(0, 16) || null;
  const { data, error } = await supabase
    .from("notes")
    .update(values)
    .eq("id", id)
    .eq("owner_id", user.id)
    .select(META_COLUMNS)
    .single<NoteRow>();
  if (error) throw new Error(error.message);
  return toMeta(data);
}

export async function setNoteArchived(id: string, archived: boolean): Promise<NoteMeta> {
  const { supabase, user } = await authenticatedClient();
  const { data, error } = await supabase
    .from("notes")
    .update({ is_archived: archived })
    .eq("id", id)
    .eq("owner_id", user.id)
    .select(META_COLUMNS)
    .single<NoteRow>();
  if (error) throw new Error(error.message);
  return toMeta(data);
}

export async function deleteNoteForever(id: string): Promise<{ id: string }> {
  const { supabase, user } = await authenticatedClient();
  const { data: ownedNotes, error: listError } = await supabase
    .from("notes")
    .select("id,parent_id")
    .eq("owner_id", user.id)
    .returns<Array<{ id: string; parent_id: string | null }>>();
  if (listError) throw new Error(listError.message);
  const subtree = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const note of ownedNotes ?? []) {
      if (note.parent_id && subtree.has(note.parent_id) && !subtree.has(note.id)) {
        subtree.add(note.id);
        changed = true;
      }
    }
  }
  for (const noteId of subtree) {
    const prefix = `${user.id}/${noteId}`;
    const { data: files, error: storageError } = await supabase.storage.from("note-assets").list(prefix, { limit: 1000 });
    if (storageError) throw new Error(storageError.message);
    if (files?.length) {
      const { error: removeError } = await supabase.storage.from("note-assets").remove(files.map((file) => `${prefix}/${file.name}`));
      if (removeError) throw new Error(removeError.message);
    }
  }
  const { error } = await supabase.from("notes").delete().eq("id", id).eq("owner_id", user.id);
  if (error) throw new Error(error.message);
  return { id };
}

const documentSchema = z.array(z.unknown());

export type SaveNoteResult =
  | { ok: true; version: number; updatedAt: string }
  | { ok: false; reason: "conflict" | "too_large" | "invalid" };

export async function saveNoteDoc(id: string, document: unknown, baseVersion: number): Promise<SaveNoteResult> {
  const parsed = documentSchema.safeParse(document);
  if (!parsed.success || !Number.isInteger(baseVersion) || baseVersion < 0) return { ok: false, reason: "invalid" };
  const serialized = JSON.stringify(parsed.data);
  if (serialized.length >= 1_000_000) return { ok: false, reason: "too_large" };
  const { supabase, user } = await authenticatedClient();
  const { data, error } = await supabase
    .from("notes")
    .update({ document: parsed.data, version: baseVersion + 1 })
    .eq("id", id)
    .eq("owner_id", user.id)
    .eq("version", baseVersion)
    .select("version,updated_at")
    .maybeSingle<{ version: number; updated_at: string }>();
  if (error) throw new Error(error.message);
  if (!data) return { ok: false, reason: "conflict" };
  return { ok: true, version: data.version, updatedAt: data.updated_at };
}

export async function getNote(id: string): Promise<NoteRecord | null> {
  const { supabase, user } = await authenticatedClient();
  const { data, error } = await supabase
    .from("notes")
    .select(`${META_COLUMNS},document`)
    .eq("id", id)
    .eq("owner_id", user.id)
    .maybeSingle<NoteRow & { document: unknown[] | null }>();
  if (error) throw new Error(error.message);
  return data ? { ...toMeta(data), document: data.document } : null;
}
