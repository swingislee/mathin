import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { loginIdentifierSchema } from "@/lib/auth-identifier";
import type { ApiErrorCode, Report, PracticeSubmission, Media } from "../../../contracts/parent-api/portal";
import { intakeFormSchema, intakeSchema, validateAnswers, mediaType, PHOTO_BYTES, VIDEO_BYTES } from "./validation";

export class PortalError extends Error {
  constructor(public code: ApiErrorCode) { super(code); }
}
const status: Record<ApiErrorCode, number> = { VALIDATION:400, UNAUTHENTICATED:401, FORBIDDEN:403, ACCOUNT_SECURITY:403,
  NOT_FOUND:404, FORM_CHANGED:409, ACTIVITY_FULL:409, BOOKING_CLOSED:409, CONFLICT:409, TOO_LARGE:413, FILE_TYPE:415, RATE_LIMIT:429, UNAVAILABLE:503 };
export function response(data: unknown, httpStatus = 200) {
  return Response.json(data, { status:httpStatus, headers:{ "Cache-Control":"private, no-store", "X-Content-Type-Options":"nosniff" } });
}
export function failure(error: unknown) {
  const code = error instanceof PortalError ? error.code : error instanceof z.ZodError ? "VALIDATION" : "UNAVAILABLE";
  return response({ code }, status[code]);
}
function requireResult<T>(result: { data:T; error:{ message:string; code?:string } | null }): T {
  if (result.error) throw new PortalError(result.error.message in status ? result.error.message as ApiErrorCode
    : result.error.code === "42501" ? "FORBIDDEN" : "UNAVAILABLE");
  return result.data;
}
function client(token?: string) {
  const { url,key } = getSupabaseConfig();
  return createClient(url,key,{ auth:{ persistSession:false,autoRefreshToken:false,detectSessionInUrl:false },
    global: token ? { headers:{ Authorization:`Bearer ${token}` } } : undefined });
}
export async function authorize(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/)?.[1];
  if (!token || token.length>8192) throw new PortalError("UNAUTHENTICATED");
  const db=client(token);
  const { data:{user},error }=await db.auth.getUser(token);
  if (error || !user) throw new PortalError("UNAUTHENTICATED");
  const profile=requireResult(await db.from("profiles").select("display_name,role,account_status,password_change_required").eq("id",user.id).maybeSingle());
  if (!profile || !["parent","student"].includes(profile.role)) throw new PortalError("FORBIDDEN");
  if (profile.account_status!=="active" || profile.password_change_required
    || !requireResult(await db.rpc("has_current_required_consents",{p_user_id:user.id}))) throw new PortalError("ACCOUNT_SECURITY");
  return { db,user,profile,token };
}
export async function readBytes(request: Request, limit: number) {
  const advertised=Number(request.headers.get("content-length"));
  if (advertised>limit) throw new PortalError("TOO_LARGE");
  const reader=request.body?.getReader();
  if (!reader) throw new PortalError("VALIDATION");
  const chunks:Uint8Array[]=[]; let length=0;
  for (;;) {
    const {value,done}=await reader.read(); if(done) break;
    length+=value.length;
    if(length>limit){await reader.cancel();throw new PortalError("TOO_LARGE");}
    chunks.push(value);
  }
  return Buffer.concat(chunks,length);
}
export async function readJson(request:Request) {
  if(!request.headers.get("content-type")?.startsWith("application/json")) throw new PortalError("VALIDATION");
  try{return JSON.parse((await readBytes(request,32*1024)).toString("utf8")) as unknown;}
  catch(error){if(error instanceof PortalError)throw error;throw new PortalError("VALIDATION");}
}
async function rateLimit(request:Request, scope:string, limit:number) {
  const secret=process.env.SUPABASE_SECRET_KEY;
  if(!secret) throw new PortalError("UNAVAILABLE");
  const origin=request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "direct";
  const hash=createHmac("sha256",secret).update(scope+":"+origin).digest("hex");
  if(!requireResult(await createAdminClient().rpc("miniapp_take_rate_limit",{p_key:hash,p_limit:limit,p_seconds:600}))) throw new PortalError("RATE_LIMIT");
}
async function getForm(slug:string) {
  const row=requireResult(await client().from("miniapp_forms").select("slug,version,title,description,privacy_notice,fields").eq("slug",slug).eq("enabled",true).maybeSingle());
  if(!row) throw new PortalError("NOT_FOUND");
  const form=intakeFormSchema.safeParse({...row,privacyNotice:row.privacy_notice});
  if(!form.success) throw new PortalError("UNAVAILABLE");
  return form.data;
}
const uuid=z.string().uuid();
const sessionSchema=z.discriminatedUnion("action",[
  z.object({action:z.literal("login"),identifier:loginIdentifierSchema,password:z.string().min(6).max(128)}).strict(),
  z.object({action:z.literal("refresh"),refreshToken:z.string().min(1).max(8192)}).strict(),
  z.object({action:z.literal("logout")}).strict(),
]);
export async function authPost(request:Request) {
  const input=sessionSchema.parse(await readJson(request));
  if(input.action==="logout") {
    const {token}=await authorize(request);
    const {error}=await createAdminClient().auth.admin.signOut(token,"local");
    if(error)throw new PortalError("UNAVAILABLE");
    return response({ok:true});
  }
  await rateLimit(request,"login",30);
  const db=client();
  const result=input.action==="refresh"
    ? await db.auth.refreshSession({refresh_token:input.refreshToken})
    : await db.auth.signInWithPassword(input.identifier.kind==="email"
      ? {email:input.identifier.value,password:input.password}:{phone:input.identifier.value,password:input.password});
  if(result.error||!result.data.session)throw new PortalError("UNAUTHENTICATED");
  const session=result.data.session;
  // 令牌签发后立即经过与每个业务请求相同的账户状态检查。
  await authorize(new Request(request.url,{headers:{authorization:`Bearer ${session.access_token}`}}));
  return response({accessToken:session.access_token,refreshToken:session.refresh_token,expiresAt:session.expires_at});
}

export async function portalGet(request:Request) {
  const query=new URL(request.url).searchParams;
  const resource=query.get("resource");
  if(resource==="form")return response(await getForm(z.string().regex(/^[a-z0-9-]{1,64}$/).parse(query.get("form")||"welcome")));
  if(resource==="activities")return response(requireResult(await client().rpc("miniapp_public_activities")));
  const {db,user,profile}=await authorize(request);
  if(resource==="account")return response({id:user.id,displayName:profile.display_name,
    participants:requireResult(await db.rpc("get_my_students"))?.map((row:{id:string;name:string})=>({id:row.id,name:row.name}))??[]});
  if(resource==="bookings")return response(requireResult(await db.rpc("miniapp_my_bookings")));
  if(resource==="practices")return response(requireResult(await db.rpc("miniapp_my_practices")));
  if(resource==="reports") {
    const [assessments,reviews]=await Promise.all([
      db.rpc("miniapp_assessment_reports"),
      db.rpc("get_my_session_reviews",{p_from:new Date(Date.now()-366*86400000).toISOString(),p_to:new Date(Date.now()+86400000).toISOString()}),
    ]);
    const reports:Report[]=[...(requireResult(assessments)??[]),...(requireResult(reviews)??[]).map((row:{session_id:string;student_id:string;lecture_name:string;student_name:string;scheduled_at:string;comment:string;exit_score:number|null})=>({
      id:row.session_id+":"+row.student_id,kind:"feedback" as const,title:row.lecture_name,participantName:row.student_name,date:row.scheduled_at,
      summary:row.comment,strengths:"",focusAreas:"",recommendation:"",score:row.exit_score,totalScore:null,
    }))];
    return response(reports.sort((a,b)=>b.date.localeCompare(a.date)).slice(0,200));
  }
  if(resource==="submission") {
    const assignment=uuid.parse(query.get("id")),student=uuid.parse(query.get("participant"));
    if(!requireResult(await db.rpc("miniapp_can_practice",{p_assignment:assignment,p_student:student})))throw new PortalError("FORBIDDEN");
    const row=requireResult(await db.from("miniapp_practice_submissions").select("id,note,upload_ids,submitted_at").eq("assignment_id",assignment).eq("student_id",student).order("submitted_at",{ascending:false}).limit(1).maybeSingle());
    if(!row)return response(null);
    const files=requireResult(await db.from("miniapp_practice_uploads").select("id,kind,name,bytes").in("id",row.upload_ids));
    const result:PracticeSubmission={id:row.id,note:row.note,submittedAt:row.submitted_at,media:files as Media[]};
    return response(result);
  }
  throw new PortalError("NOT_FOUND");
}
const commandSchema=z.discriminatedUnion("action",[
  z.object({action:z.literal("book"),activityId:uuid,participantId:uuid}).strict(),
  z.object({action:z.literal("cancel"),id:uuid}).strict(),
  z.object({action:z.literal("submit"),id:uuid,assignmentId:uuid,participantId:uuid,note:z.string().trim().max(2000),uploadIds:z.array(uuid).min(1).max(9)}).strict(),
]);
export async function portalPost(request:Request) {
  const raw=await readJson(request);
  if(raw && typeof raw==="object" && "action" in raw && raw.action==="intake") {
    const {action,...rest}=raw;void action;
    const input=intakeSchema.parse(rest);
    await rateLimit(request,"intake",10);
    const form=await getForm(input.form);
    if(form.version!==input.version)throw new PortalError("FORM_CHANGED");
    if(!validateAnswers(form.fields,input.answers))throw new PortalError("VALIDATION");
    const actor=request.headers.has("authorization")?(await authorize(request)).user.id:null;
    const id=requireResult(await createAdminClient().rpc("miniapp_submit_intake",{p_request_id:input.requestId,p_form:input.form,p_version:input.version,p_answers:input.answers,p_source:input.source,p_user:actor}));
    return response({id},201);
  }
  const input=commandSchema.parse(raw),{db}=await authorize(request);
  if(input.action==="book")return response({id:requireResult(await db.rpc("miniapp_book_activity",{p_activity:input.activityId,p_student:input.participantId}))});
  if(input.action==="cancel"){requireResult(await db.rpc("miniapp_cancel_booking",{p_id:input.id}));return response({ok:true});}
  return response({id:requireResult(await db.rpc("miniapp_submit_practice",{p_id:input.id,p_assignment:input.assignmentId,p_student:input.participantId,p_note:input.note,p_uploads:input.uploadIds}))},201);
}

async function canUpload(db:SupabaseClient,assignment:string,student:string) {
  if(!requireResult(await db.rpc("miniapp_can_practice",{p_assignment:assignment,p_student:student})))throw new PortalError("FORBIDDEN");
}
export async function mediaPost(request:Request) {
  const {db,user}=await authorize(request);
  const assignment=uuid.parse(request.headers.get("x-assignment-id")),student=uuid.parse(request.headers.get("x-participant-id"));
  await canUpload(db,assignment,student);
  await rateLimit(request,"media:"+user.id,40);
  const body=await readBytes(request,VIDEO_BYTES+256*1024);
  let data:FormData;
  try {data=await new Request(request.url,{method:"POST",headers:{"content-type":request.headers.get("content-type")||""},body}).formData();}
  catch {throw new PortalError("VALIDATION");}
  const file=data.get("file");
  if(!(file instanceof File)||file.size===0)throw new PortalError("VALIDATION");
  const bytes=new Uint8Array(await file.arrayBuffer()),format=mediaType(bytes);
  if(!format)throw new PortalError("FILE_TYPE");
  if(file.size>(format.kind==="image"?PHOTO_BYTES:VIDEO_BYTES))throw new PortalError("TOO_LARGE");
  if(format.kind==="video"&&!requireResult(await db.rpc("miniapp_can_participate",{p_student:student,p_scope:"video"})))throw new PortalError("FORBIDDEN");
  const admin=createAdminClient();
  const id=randomUUID(),objectPath=`${user.id}/${assignment}/${student}/${id}.${format.extension}`;
  const name=file.name.slice(0,200)||`${format.kind}.${format.extension}`;
  requireResult(await db.rpc("miniapp_reserve_upload",{p_id:id,p_assignment:assignment,p_student:student,p_path:objectPath,p_name:name,p_kind:format.kind,p_mime:format.mime,p_bytes:file.size}));
  const stored=await admin.storage.from("miniapp-practice").upload(objectPath,bytes,{contentType:format.mime,upsert:false});
  if(stored.error){await admin.from("miniapp_practice_uploads").delete().eq("id",id);requireResult(stored);}
  requireResult(await admin.from("miniapp_practice_uploads").update({ready:true}).eq("id",id));
  return response({id,kind:format.kind,name,bytes:file.size},201);
}
export async function mediaGet(request:Request) {
  const query=new URL(request.url).searchParams;
  if(query.has("download")) {
    const id=uuid.parse(query.get("download")),token=z.string().min(1).max(8192).parse(query.get("token"));
    const row=requireResult(await createAdminClient().from("miniapp_practice_uploads").select("object_path,mime_type").eq("id",id).eq("ready",true).maybeSingle());
    if(!row)throw new PortalError("NOT_FOUND");
    // Storage 验证签名的对象路径与过期时间；经同一 API 域名流式返回，手机不访问服务器 loopback。
    const signed=new URL(`/storage/v1/object/sign/miniapp-practice/${row.object_path}`,getSupabaseConfig().url);
    signed.searchParams.set("token",token);
    const headers:Record<string,string>={};
    const range=request.headers.get("range");if(range)headers.Range=range;
    const result=await fetch(signed,{headers,cache:"no-store"});
    if(!result.ok)throw new PortalError("NOT_FOUND");
    const outgoing=new Headers({"Content-Type":row.mime_type,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"});
    for(const key of ["content-length","content-range","accept-ranges"]) {const value=result.headers.get(key);if(value)outgoing.set(key,value);}
    return new Response(result.body,{status:result.status,headers:outgoing});
  }
  const {db}=await authorize(request),id=uuid.parse(query.get("id"));
  const row=requireResult(await db.from("miniapp_practice_uploads").select("object_path").eq("id",id).eq("ready",true).maybeSingle());
  if(!row)throw new PortalError("NOT_FOUND");
  const signed=requireResult(await db.storage.from("miniapp-practice").createSignedUrl(row.object_path,300));
  if(!signed)throw new PortalError("UNAVAILABLE");
  const token=new URL(signed.signedUrl).searchParams.get("token");
  if(!token)throw new PortalError("UNAVAILABLE");
  return response({url:`/api/v1/parent/media?download=${id}&token=${encodeURIComponent(token)}`,expiresIn:300});
}
