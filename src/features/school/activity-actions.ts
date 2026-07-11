"use server";
import { getMyPerms } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { PermissionKey } from "./permissions";
import { ACTIVITY_KINDS,type ActivityKind } from "./activities";
async function auth(key:PermissionKey){const s=await createClient();const {data:{user}}=await s.auth.getUser();if(!user)throw new Error("UNAUTHENTICATED");if(!(await getMyPerms(user.id)).has(key))throw new Error("FORBIDDEN");return s}
export interface ActivityInput{kind:ActivityKind;title:string;scheduledAt:string;durationMin:number|null;location:string;capacity:number|null;remark:string}
function args(i:ActivityInput){if(!ACTIVITY_KINDS.includes(i.kind)||!i.title.trim()||Number.isNaN(Date.parse(i.scheduledAt)))throw new Error("INVALID_INPUT");return{p_kind:i.kind,p_title:i.title,p_scheduled_at:new Date(i.scheduledAt).toISOString(),p_duration_min:i.durationMin,p_location:i.location,p_capacity:i.capacity,p_remark:i.remark}}
export async function createActivityAction(i:ActivityInput){const s=await auth("activity.manage");const{error}=await s.rpc("create_activity",args(i));if(error)throw new Error(error.message)}
export async function updateActivityAction(id:string,i:ActivityInput){const s=await auth("activity.manage");const{error}=await s.rpc("update_activity",{p_activity_id:id,...args(i)});if(error)throw new Error(error.message)}
export async function deleteActivityAction(id:string){const s=await auth("activity.manage");const{error}=await s.rpc("delete_activity",{p_activity_id:id});if(error)throw new Error(error.message)}
export async function bookActivityAction(activityId:string,studentId:string){const s=await auth("activity.register");const{error}=await s.rpc("book_activity",{p_activity_id:activityId,p_student_id:studentId});if(error)throw new Error(error.message)}
export async function markActivityResultAction(id:string,status:"attended"|"no_show"|"cancelled",outcome:string){const s=await auth("activity.register");const{error}=await s.rpc("mark_activity_result",{p_registration_id:id,p_status:status,p_outcome:outcome});if(error)throw new Error(error.message)}
export async function searchStudentsForActivity(q:string){const s=await auth("activity.register");const v=q.trim().slice(0,80);if(!v)return[];const escaped=v.replaceAll("\\","\\\\").replaceAll("%","\\%").replaceAll("_","\\_");const{data,error}=await s.from("students").select("id,name,grade").is("deleted_at",null).ilike("name",`%${escaped}%`).limit(10).returns<Array<{id:string;name:string;grade:number|null}>>();if(error)throw new Error(error.message);return data??[]}
