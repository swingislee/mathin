"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { actionError, type ActionResult } from "@/lib/action-result";

async function authenticatedClient() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return { supabase, user };
}

/** 学生本人凭绑定码把账号挂到 CRM 档案上（10-§5.3 claim_student_account）。 */
export async function claimStudentAccountAction(code: string): Promise<ActionResult> {
  try {
    const { supabase } = await authenticatedClient();
    const { data, error } = await supabase.rpc("claim_student_account", { p_code: code.trim() });
    if (error) throw new Error(error.message);
    if (!data) throw new Error("INVALID_BIND_CODE");
    return { ok: true };
  } catch (error) {
    return actionError(error, ["INVALID_BIND_CODE", "UNAUTHENTICATED"]);
  }
}

/** 家长凭绑定码关联孩子档案；若当前 role=student 会被 RPC 内部升级为 parent（10-§5.3 bind_guardian）。 */
export async function bindGuardianAction(code: string, relation: string, consents: {profile:boolean;learning:boolean;video:boolean}): Promise<ActionResult> {
  try {
    const { supabase } = await authenticatedClient();
    const { data: studentId, error } = await supabase.rpc("bind_guardian", { p_code: code.trim(), p_relation: relation.trim().slice(0, 40) });
    if (error) throw new Error(error.message);
    if (!studentId) throw new Error("INVALID_BIND_CODE");
    for(const [scope,consented] of Object.entries(consents)){
      const{error:consentError}=await supabase.rpc("record_guardian_consent",{p_student_id:studentId,p_scope:scope,p_consented:consented});
      if(consentError)throw new Error(consentError.message);
    }
    return { ok: true };
  } catch (error) {
    return actionError(error, ["INVALID_BIND_CODE", "UNAUTHENTICATED"]);
  }
}

export async function issueGuardianInviteAction(studentId:string,relation:string,scope:string[]):Promise<ActionResult<string>>{
  try {
    const{supabase}=await authenticatedClient();
    const allowed=["grades","video","finance"];
    const normalized=Array.from(new Set(scope.filter(value=>allowed.includes(value))));
    const{data,error}=await supabase.rpc("issue_guardian_invite",{p_student_id:studentId,p_relation:relation.trim().slice(0,40),p_scope:normalized});
    if(error||typeof data!=="string")throw new Error(error?.message??"INVITE_FAILED");
    return { ok: true, data };
  } catch (error) {
    return actionError<string>(error, ["INVITE_FAILED", "UNAUTHENTICATED"]);
  }
}

export interface GuardianScopeRow { guardianId:string; displayName:string; relation:string; scope:string[]; isPrimary:boolean }
export async function listStudentGuardiansAction(studentId:string):Promise<ActionResult<GuardianScopeRow[]>>{
  try {
    const{supabase}=await authenticatedClient();
    const{data,error}=await supabase.rpc("list_student_guardians",{p_student_id:studentId});
    if(error)throw new Error(error.message);
    const rows=((data??[]) as Array<{guardian_id:string;display_name:string;relation:string;scope:string[];is_primary:boolean}>).map(row=>({guardianId:row.guardian_id,displayName:row.display_name,relation:row.relation,scope:row.scope??[],isPrimary:row.is_primary}));
    return { ok: true, data: rows };
  } catch (error) {
    return actionError<GuardianScopeRow[]>(error, ["FORBIDDEN", "UNAUTHENTICATED"]);
  }
}
export async function setGuardianScopeAction(studentId:string,guardianId:string,scope:string[]):Promise<ActionResult>{
  try {
    const{supabase}=await authenticatedClient();
    const{error}=await supabase.rpc("set_guardian_scope",{p_student_id:studentId,p_guardian_id:guardianId,p_scope:scope});
    if(error)throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ["GUARDIAN_NOT_FOUND", "INVALID_SCOPE", "FORBIDDEN", "UNAUTHENTICATED"]);
  }
}

const assignmentAttachmentSchema = z.object({
  path: z.string().min(1).max(500),
  name: z.string().min(1).max(200),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"]),
  size: z.number().int().positive().max(12 * 1024 * 1024),
});
const customerSubmissionSchema = z.object({
  assignmentId: z.string().uuid(),
  studentId: z.string().uuid(),
  text: z.string().max(20000),
  attachments: z.array(assignmentAttachmentSchema).max(12),
}).refine((value) => value.text.trim().length > 0 || value.attachments.length > 0);

export type CustomerSubmissionInput = z.infer<typeof customerSubmissionSchema>;

export async function submitCustomerAssignmentAction(input: CustomerSubmissionInput): Promise<ActionResult> {
  try {
    const parsed = customerSubmissionSchema.safeParse(input);
    if (!parsed.success) throw new Error("VALIDATION");
    const { supabase } = await authenticatedClient();
    const { error } = await supabase.rpc("submit_assignment_for_student", {
      p_assignment_id: parsed.data.assignmentId,
      p_student_id: parsed.data.studentId,
      p_content: { text: parsed.data.text.trim(), attachments: parsed.data.attachments },
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ["VALIDATION", "FORBIDDEN", "STUDENT_ACCOUNT_REQUIRED", "UNAUTHENTICATED"]);
  }
}

const leaveRequestSchema = z.object({
  sessionId: z.string().uuid(),
  studentId: z.string().uuid(),
  reason: z.string().trim().min(1).max(1000),
});

export async function submitSessionLeaveRequestAction(input: z.infer<typeof leaveRequestSchema>): Promise<ActionResult> {
  try {
    const parsed = leaveRequestSchema.safeParse(input);
    if (!parsed.success) throw new Error("VALIDATION");
    const { supabase } = await authenticatedClient();
    const { error } = await supabase.rpc("submit_session_leave_request", {
      p_session_id: parsed.data.sessionId,
      p_student_id: parsed.data.studentId,
      p_reason: parsed.data.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ["VALIDATION", "FORBIDDEN", "SESSION_NOT_FOUND", "SESSION_NOT_LEAVABLE", "STUDENT_NOT_ENROLLED", "UNAUTHENTICATED"]);
  }
}