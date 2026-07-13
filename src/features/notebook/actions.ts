"use server";

import { createClient } from "@/lib/supabase/server";
import { ServerBlockNoteEditor } from "@blocknote/server-util";
import type { PartialBlock } from "@blocknote/core";
import sanitizeHtml from "sanitize-html";
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

interface TreeRow { id: string; parent_id: string | null; is_archived: boolean }

async function ownedTreeRows(supabase: Awaited<ReturnType<typeof authenticatedClient>>["supabase"], userId: string) {
  const { data, error } = await supabase
    .from("notes")
    .select("id,parent_id,is_archived")
    .eq("owner_id", userId)
    .returns<TreeRow[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}

function collectSubtree(rows: TreeRow[], rootId: string) {
  const subtree = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (row.parent_id && subtree.has(row.parent_id) && !subtree.has(row.id)) {
        subtree.add(row.id);
        changed = true;
      }
    }
  }
  return subtree;
}

/** 归档/恢复整棵子树，返回全部受影响笔记的元信息。 */
export async function setNoteArchived(id: string, archived: boolean): Promise<NoteMeta[]> {
  const { supabase, user } = await authenticatedClient();
  const rows = await ownedTreeRows(supabase, user.id);
  const subtree = collectSubtree(rows, id);
  // 恢复时若父级仍在回收站，把本篇挂回根部，否则恢复后在树里不可见。
  if (!archived) {
    const root = rows.find((row) => row.id === id);
    const parent = root?.parent_id ? rows.find((row) => row.id === root.parent_id) : undefined;
    if (parent?.is_archived) {
      const { error } = await supabase.from("notes").update({ parent_id: null }).eq("id", id).eq("owner_id", user.id);
      if (error) throw new Error(error.message);
    }
  }
  const { data, error } = await supabase
    .from("notes")
    .update({ is_archived: archived })
    .in("id", [...subtree])
    .eq("owner_id", user.id)
    .select(META_COLUMNS)
    .returns<NoteRow[]>();
  if (error) throw new Error(error.message);
  // 帖子快照与源笔记联动：入回收站即从瀑布流隐藏，恢复即回归（保留点赞）。
  const { error: postError } = await supabase
    .from("posts")
    .update({ hidden: archived })
    .in("note_id", [...subtree])
    .eq("author_id", user.id);
  if (postError) throw new Error(postError.message);
  return (data ?? []).map(toMeta);
}

export async function deleteNoteForever(id: string): Promise<{ id: string; removedIds: string[] }> {
  const { supabase, user } = await authenticatedClient();
  const subtree = collectSubtree(await ownedTreeRows(supabase, user.id), id);
  // 彻底删除时公开快照一并删除（点赞随行级联清理）。
  const { error: postsError } = await supabase
    .from("posts")
    .delete()
    .in("note_id", [...subtree])
    .eq("author_id", user.id);
  if (postsError) throw new Error(postsError.message);
  // Storage 清理是次要目标：失败只记录，不能反过来卡死笔记删除本身。
  for (const noteId of subtree) {
    const prefix = `${user.id}/${noteId}`;
    try {
      const { data: files, error: storageError } = await supabase.storage.from("note-assets").list(prefix, { limit: 1000 });
      if (storageError) throw new Error(storageError.message);
      if (files?.length) {
        const { error: removeError } = await supabase.storage.from("note-assets").remove(files.map((file) => `${prefix}/${file.name}`));
        if (removeError) throw new Error(removeError.message);
      }
    } catch (cleanupError) {
      console.error(`notebook: failed to clean assets under ${prefix}`, cleanupError);
    }
  }
  const { error } = await supabase.from("notes").delete().eq("id", id).eq("owner_id", user.id);
  if (error) throw new Error(error.message);
  return { id, removedIds: [...subtree] };
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

function excerptFromDocument(document: unknown[]) {
  const pieces: string[] = [];
  const visit = (value: unknown) => {
    if (typeof value === "string") pieces.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (typeof record.text === "string") pieces.push(record.text);
      else {
        if (record.content) visit(record.content);
        if (record.children) visit(record.children);
      }
    }
  };
  visit(document);
  const plain = pieces.join(" ").replace(/\s+/g, " ").trim();
  return plain.length > 200 ? `${plain.slice(0, 200).trimEnd()}…` : plain;
}

export async function getPublishStatus(noteId: string): Promise<string | null> {
  const { supabase, user } = await authenticatedClient();
  const { data, error } = await supabase.from("posts").select("id").eq("note_id", noteId).eq("author_id", user.id).maybeSingle<{ id: string }>();
  if (error) throw new Error(error.message);
  return data?.id ?? null;
}

export async function moderatePostAction(postId: string, status: "approved" | "hidden", reason: string): Promise<void> {
  const { supabase, user } = await authenticatedClient();
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle<{ role: string }>();
  if (profile?.role !== "admin") throw new Error("FORBIDDEN");
  const { error } = await supabase.rpc("moderate_post", { p_post_id: postId, p_status: status, p_reason: reason.trim().slice(0, 1000) });
  if (error) throw new Error(error.message);
}

export async function publishNote(noteId: string): Promise<{ postId: string }> {
  const { supabase, user } = await authenticatedClient();
  const { data: note, error: noteError } = await supabase
    .from("notes")
    .select("id,title,document")
    .eq("id", noteId)
    .eq("owner_id", user.id)
    .single<{ id: string; title: string; document: unknown[] | null }>();
  if (noteError) throw new Error(noteError.message);
  const parsed = documentSchema.parse(note.document ?? []);
  const editor = ServerBlockNoteEditor.create();
  const generated = await editor.blocksToFullHTML(parsed as PartialBlock[]);
  const contentHtml = sanitizeHtml(generated, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, "img", "figure", "figcaption", "picture", "source"],
    allowedAttributes: {
      "*": ["class", "data-*"],
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "title", "width", "height", "loading"],
      source: ["src", "srcset", "type"],
    },
    allowedSchemes: ["http", "https"],
    allowProtocolRelative: false,
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "nofollow noopener noreferrer" }, true),
    },
  });
  const values = {
    title: note.title.trim(),
    content: parsed,
    content_html: contentHtml,
    excerpt: excerptFromDocument(parsed),
  };
  const { data: existing, error: existingError } = await supabase
    .from("posts")
    .select("id")
    .eq("note_id", noteId)
    .eq("author_id", user.id)
    .maybeSingle<{ id: string }>();
  if (existingError) throw new Error(existingError.message);
  if (existing) {
    const { error } = await supabase.from("posts").update(values).eq("id", existing.id).eq("author_id", user.id);
    if (error) throw new Error(error.message);
    return { postId: existing.id };
  }
  const { data: created, error } = await supabase
    .from("posts")
    .insert({ note_id: noteId, author_id: user.id, ...values })
    .select("id")
    .single<{ id: string }>();
  if (error) throw new Error(error.message);
  return { postId: created.id };
}

export async function unpublishNote(noteId: string): Promise<void> {
  const { supabase, user } = await authenticatedClient();
  const { error } = await supabase.from("posts").delete().eq("note_id", noteId).eq("author_id", user.id);
  if (error) throw new Error(error.message);
}

export async function toggleLike(postId: string): Promise<{ liked: boolean; likeCount: number }> {
  const { supabase, user } = await authenticatedClient();
  const { data: existing, error: selectError } = await supabase
    .from("post_likes")
    .select("post_id")
    .eq("post_id", postId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (selectError) throw new Error(selectError.message);
  if (existing) {
    const { error } = await supabase.from("post_likes").delete().eq("post_id", postId).eq("user_id", user.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("post_likes").insert({ post_id: postId, user_id: user.id });
    if (error) throw new Error(error.message);
  }
  const { data: post, error: postError } = await supabase.from("posts").select("like_count").eq("id", postId).single<{ like_count: number }>();
  if (postError) throw new Error(postError.message);
  return { liked: !existing, likeCount: post.like_count };
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
