"use server";

import { createClient } from "@/lib/supabase/server";
import { collectPostgrestRowsInBatches } from "@/lib/supabase/postgrest-batches";
import type { Json } from "@/lib/database.types";
import { ServerBlockNoteEditor } from "@blocknote/server-util";
import type { PartialBlock } from "@blocknote/core";
import { z } from "zod";
import { sanitizeNotebookHtml } from "./html";
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
  const subtree = [...collectSubtree(rows, id)];
  // 恢复时若父级仍在回收站，把本篇挂回根部，否则恢复后在树里不可见。
  if (!archived) {
    const root = rows.find((row) => row.id === id);
    const parent = root?.parent_id ? rows.find((row) => row.id === root.parent_id) : undefined;
    if (parent?.is_archived) {
      const { error } = await supabase.from("notes").update({ parent_id: null }).eq("id", id).eq("owner_id", user.id);
      if (error) throw new Error(error.message);
    }
  }
  const updatedNotes = await collectPostgrestRowsInBatches<string, NoteRow>(subtree, (batch) => supabase
    .from("notes")
    .update({ is_archived: archived })
    .in("id", batch)
    .eq("owner_id", user.id)
    .select(META_COLUMNS)
    .returns<NoteRow[]>());
  // 发布可见性由 notes_sync_notebook_post_state trigger 在同一数据库事务中同步；
  // 平台下架、未审核、已撤回或发布开关关闭时，恢复笔记也不会重新公开。
  return updatedNotes.map(toMeta);
}

export async function deleteNoteForever(id: string): Promise<{ id: string; removedIds: string[] }> {
  const { supabase, user } = await authenticatedClient();
  const removedIds = [...collectSubtree(await ownedTreeRows(supabase, user.id), id)];
  // 数据库 BEFORE DELETE trigger 在同一事务删除发布头、revision、事件与点赞；
  // 应用层不再持有 posts 的直写权限。

  // Storage 清理是次要目标：失败只记录，不能反过来卡死笔记删除本身。
  for (const noteId of removedIds) {
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
  return { id, removedIds };
}

const documentSchema = z.array(z.unknown());
const entityIdSchema = z.string().uuid();

const NOTEBOOK_PUBLICATION_STATUSES = ["draft", "review", "published", "withdrawn", "revised"] as const;
export type NotebookPublicationStatus = {
  postId: string;
  revisionNo: number;
  lifecycleStatus: (typeof NOTEBOOK_PUBLICATION_STATUSES)[number];
  reviewStatus: "pending" | "approved" | "rejected";
  moderationStatus: "active" | "hidden";
};

export type NotebookPublicationActionCode =
  | "VALIDATION"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "PUBLIC_PUBLISHING_DISABLED"
  | "NOTE_ARCHIVED"
  | "INVALID_STATE"
  | "MODERATION_LOCKED"
  | "SERVER";

export type NotebookPublicationActionResult =
  | { ok: true; data: NotebookPublicationStatus }
  | { ok: false; code: NotebookPublicationActionCode };

const publicationStatusSchema = z.object({
  postId: entityIdSchema,
  revisionNo: z.number().int().positive(),
  lifecycleStatus: z.enum(NOTEBOOK_PUBLICATION_STATUSES),
  reviewStatus: z.enum(["pending", "approved", "rejected"]),
  moderationStatus: z.enum(["active", "hidden"]),
});

const reviewPublicationSchema = z.discriminatedUnion("decision", [
  z.object({ postId: entityIdSchema, decision: z.literal("approved"), reason: z.string().trim().max(1000).default("") }),
  z.object({ postId: entityIdSchema, decision: z.literal("rejected"), reason: z.string().trim().min(1).max(1000) }),
]);

const moderatePublicationSchema = z.discriminatedUnion("status", [
  z.object({ postId: entityIdSchema, status: z.literal("approved"), reason: z.string().trim().max(1000).default("") }),
  z.object({ postId: entityIdSchema, status: z.literal("hidden"), reason: z.string().trim().min(1).max(1000) }),
]);

const KNOWN_PUBLICATION_ERRORS = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "PUBLIC_PUBLISHING_DISABLED",
  "NOTE_ARCHIVED",
  "INVALID_STATE",
  "ALREADY_IN_REVIEW",
  "MODERATION_LOCKED",
] as const;

function publicationErrorCode(error: unknown): NotebookPublicationActionCode {
  if (error instanceof z.ZodError) return "VALIDATION";
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
      ? String(error.message)
      : "";
  const matched = KNOWN_PUBLICATION_ERRORS.find((code) => message.includes(code));
  if (matched === "ALREADY_IN_REVIEW") return "INVALID_STATE";
  return matched ?? "SERVER";
}

async function publicationAction(
  operation: () => Promise<NotebookPublicationStatus>,
): Promise<NotebookPublicationActionResult> {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    return { ok: false, code: publicationErrorCode(error) };
  }
}

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
    .update({ document: parsed.data as Json, version: baseVersion + 1 })
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

export async function getPublishStatus(noteId: string): Promise<NotebookPublicationStatus | null> {
  const parsedNoteId = entityIdSchema.parse(noteId);
  const { supabase, user } = await authenticatedClient();
  const { data, error } = await supabase
    .from("posts")
    .select("id,current_revision_no,lifecycle_status,review_status,moderation_status")
    .eq("note_id", parsedNoteId)
    .eq("author_id", user.id)
    .maybeSingle<{
      id: string;
      current_revision_no: number;
      lifecycle_status: string;
      review_status: string;
      moderation_status: string;
    }>();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return publicationStatusSchema.parse({
    postId: data.id,
    revisionNo: data.current_revision_no,
    lifecycleStatus: data.lifecycle_status,
    reviewStatus: data.review_status,
    moderationStatus: data.moderation_status,
  });
}

export async function getPublicPublishingEnabled(): Promise<boolean> {
  const { supabase } = await authenticatedClient();
  const { data, error } = await supabase.rpc("is_feature_enabled", { p_flag_key: "public_content.publish" });
  return !error && data === true;
}

export async function moderatePostAction(input: {
  postId: string;
  status: "approved" | "hidden";
  reason: string;
}): Promise<NotebookPublicationActionResult> {
  return publicationAction(async () => {
    const parsed = moderatePublicationSchema.parse(input);
    const { supabase } = await authenticatedClient();
    const { data, error } = await supabase.rpc("moderate_post", {
      p_post_id: parsed.postId,
      p_status: parsed.status,
      p_reason: parsed.reason,
    });
    if (error) throw new Error(error.message);
    return publicationStatusSchema.parse(data);
  });
}

export async function reviewNotebookPostAction(input: {
  postId: string;
  decision: "approved" | "rejected";
  reason: string;
}): Promise<NotebookPublicationActionResult> {
  return publicationAction(async () => {
    const parsed = reviewPublicationSchema.parse(input);
    const { supabase } = await authenticatedClient();
    const { data, error } = await supabase.rpc("review_notebook_post_revision", {
      p_post_id: parsed.postId,
      p_decision: parsed.decision,
      p_reason: parsed.reason,
    });
    if (error) throw new Error(error.message);
    return publicationStatusSchema.parse(data);
  });
}

export async function submitNoteForReview(noteId: string): Promise<NotebookPublicationActionResult> {
  return publicationAction(async () => {
    const parsedNoteId = entityIdSchema.parse(noteId);
    const { supabase, user } = await authenticatedClient();
    const { data: note, error: noteError } = await supabase
      .from("notes")
      .select("id,title,document,is_archived")
      .eq("id", parsedNoteId)
      .eq("owner_id", user.id)
      .maybeSingle<{ id: string; title: string; document: unknown[] | null; is_archived: boolean }>();
    if (noteError) throw new Error(noteError.message);
    if (!note) throw new Error("NOT_FOUND");
    if (note.is_archived) throw new Error("NOTE_ARCHIVED");
    const parsedDocument = documentSchema.parse(note.document ?? []);
    const editor = ServerBlockNoteEditor.create();
    const generated = await editor.blocksToFullHTML(parsedDocument as PartialBlock[]);
    const contentHtml = sanitizeNotebookHtml(generated);
    const { data, error } = await supabase.rpc("submit_notebook_post_revision", {
      p_note_id: parsedNoteId,
      p_title: note.title.trim().slice(0, 200),
      p_content: parsedDocument as Json,
      p_content_html: contentHtml,
      p_excerpt: excerptFromDocument(parsedDocument),
    });
    if (error) throw new Error(error.message);
    return publicationStatusSchema.parse(data);
  });
}

export async function withdrawNotebookPostAction(postId: string): Promise<NotebookPublicationActionResult> {
  return publicationAction(async () => {
    const parsedPostId = entityIdSchema.parse(postId);
    const { supabase } = await authenticatedClient();
    const { data, error } = await supabase.rpc("withdraw_notebook_post", {
      p_post_id: parsedPostId,
      p_reason: "author withdrawal",
    });
    if (error) throw new Error(error.message);
    return publicationStatusSchema.parse(data);
  });
}

export async function toggleLike(postId: string): Promise<{ liked: boolean; likeCount: number }> {
  const parsedPostId = entityIdSchema.parse(postId);
  const { supabase, user } = await authenticatedClient();
  const { data: existing, error: selectError } = await supabase
    .from("post_likes")
    .select("post_id")
    .eq("post_id", parsedPostId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (selectError) throw new Error(selectError.message);
  if (existing) {
    const { error } = await supabase.from("post_likes").delete().eq("post_id", parsedPostId).eq("user_id", user.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("post_likes").insert({ post_id: parsedPostId, user_id: user.id });
    if (error) throw new Error(error.message);
  }
  const { data: post, error: postError } = await supabase.from("posts").select("like_count").eq("id", parsedPostId).single<{ like_count: number }>();
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
