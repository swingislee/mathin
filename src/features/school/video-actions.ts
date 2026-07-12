"use server";

import { getMyPerms, getProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function getVideoSignedUrl(videoId:string){
  const supabase=await createClient();
  const{data:{user}}=await supabase.auth.getUser();
  if(!user)throw new Error("UNAUTHENTICATED");
  const admin=createAdminClient();
  const{data:video,error}=await admin.from("session_videos").select("student_id,storage_path,reviewed_at,deleted_at").eq("id",videoId).single<{student_id:string;storage_path:string;reviewed_at:string|null;deleted_at:string|null}>();
  if(error||video.deleted_at)throw new Error("NOT_FOUND");
  const profile=await getProfile(user.id);
  let allowed=false;
  if(profile?.role==="admin")allowed=true;
  else if(profile?.role==="staff"){
    const{data}=await supabase.from("students").select("id").eq("id",video.student_id).maybeSingle();allowed=Boolean(data);
  }else if(profile?.role==="student"){
    const{data}=await admin.from("students").select("user_id").eq("id",video.student_id).single();allowed=data?.user_id===user.id;
  }else if(profile?.role==="parent"){
    const{data}=await supabase.from("student_guardians").select("student_id,scope").eq("student_id",video.student_id).eq("guardian_id",user.id).maybeSingle<{student_id:string;scope:string[]}>();
    allowed=Boolean(data?.scope.includes("video"))&&Boolean(video.reviewed_at);
  }
  if(!allowed)throw new Error("FORBIDDEN");
  const{data,error:signedError}=await admin.storage.from("session-videos").createSignedUrl(video.storage_path,3600);
  if(signedError)throw new Error(signedError.message);
  await admin.from("domain_events").insert({actor_id:user.id,actor_role:profile?.role??null,event_type:"video.signed_url_issued",entity_type:"session_video",entity_id:videoId,payload:{studentId:video.student_id,expiresIn:3600}});
  return data.signedUrl;
}

export async function reviewVideoAction(id:string,comment:string,score:number){
  const supabase=await createClient();const{data:{user}}=await supabase.auth.getUser();
  if(!user||!(await getMyPerms(user.id)).has("video.review"))throw new Error("FORBIDDEN");
  if(!Number.isInteger(score)||score<1||score>5)throw new Error("INVALID_SCORE");
  const{data,error}=await supabase.from("session_videos").update({reviewed_by:user.id,reviewed_at:new Date().toISOString(),review_comment:comment.trim().slice(0,2000),review_score:score}).eq("id",id).select("id");
  if(error)throw new Error(error.message);if(!data?.length)throw new Error("FORBIDDEN_SCOPE");
}

export async function deleteSessionVideoAction(id:string){
  const supabase=await createClient();const{data:{user}}=await supabase.auth.getUser();if(!user)throw new Error("UNAUTHENTICATED");
  const{error}=await supabase.rpc("delete_session_video",{p_video_id:id});if(error)throw new Error(error.message);
}
