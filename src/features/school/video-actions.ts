"use server";

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { authorizedClient } from "./actions/guards";
import { COMMON_CODES, intInRange, parse, text, uuid } from "./actions/schemas";
import { getProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const reviewVideoSchema = z.object({
  videoId: uuid,
  comment: text(2000),
  score: intInRange(1, 5),
});

export async function getVideoSignedUrl(videoId: string) {
  const id = parse(uuid, videoId);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");

  const admin = createAdminClient();
  const { data: video, error } = await admin
    .from("session_videos")
    .select("student_id,storage_path,deleted_at")
    .eq("id", id)
    .single<{ student_id: string; storage_path: string; deleted_at: string | null }>();
  if (error || video.deleted_at) throw new Error("NOT_FOUND");

  const profile = await getProfile(user.id);
  let allowed = profile?.role === "admin";
  if (profile?.role === "staff") {
    const { data } = await supabase.from("students").select("id").eq("id", video.student_id).maybeSingle();
    allowed = Boolean(data);
  } else if (profile?.role === "student" || profile?.role === "parent") {
    const { data: publishedResult } = await admin
      .from("learning_result_heads")
      .select("id")
      .eq("kind", "video_review")
      .eq("video_id", id)
      .eq("student_id", video.student_id)
      .eq("status", "published")
      .maybeSingle();
    if (publishedResult && profile.role === "student") {
      const { data } = await admin.from("students").select("user_id").eq("id", video.student_id).single();
      allowed = data?.user_id === user.id;
    } else if (publishedResult && profile.role === "parent") {
      const { data } = await supabase
        .from("student_guardians")
        .select("student_id,scope")
        .eq("student_id", video.student_id)
        .eq("guardian_id", user.id)
        .maybeSingle<{ student_id: string; scope: string[] }>();
      allowed = Boolean(data?.scope.includes("video"));
    }
  }
  if (!allowed) throw new Error("FORBIDDEN");

  const { data, error: signedError } = await admin.storage.from("session-videos").createSignedUrl(video.storage_path, 3600);
  if (signedError) throw new Error(signedError.message);
  await admin.from("domain_events").insert({
    actor_id: user.id,
    actor_role: profile?.role ?? null,
    event_type: "video.signed_url_issued",
    entity_type: "session_video",
    entity_id: id,
    payload: { studentId: video.student_id, expiresIn: 3600 },
  });
  return data.signedUrl;
}

export async function reviewVideoAction(videoId: string, comment: string, score: number): Promise<ActionResult> {
  try {
    const value = parse(reviewVideoSchema, { videoId, comment, score });
    const { supabase, user } = await authorizedClient("video.review");
    const { data, error } = await supabase
      .from("session_videos")
      .update({
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        review_comment: value.comment,
        review_score: value.score,
      })
      .eq("id", value.videoId)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("FORBIDDEN_SCOPE");
    return { ok: true };
  } catch (error) {
    return actionError(error, ["FORBIDDEN_SCOPE", ...COMMON_CODES]);
  }
}

export async function deleteSessionVideoAction(videoId: string): Promise<ActionResult> {
  try {
    const id = parse(uuid, videoId);
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("UNAUTHENTICATED");
    const { error } = await supabase.rpc("delete_session_video", { p_video_id: id });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ["VIDEO_NOT_FOUND", ...COMMON_CODES]);
  }
}
