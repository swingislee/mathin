"use server";

import { createClient } from "@/lib/supabase/server";

async function authenticatedClient() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return { supabase, user };
}

/** 学生本人凭绑定码把账号挂到 CRM 档案上（10-§5.3 claim_student_account）。 */
export async function claimStudentAccountAction(code: string): Promise<void> {
  const { supabase } = await authenticatedClient();
  const { data, error } = await supabase.rpc("claim_student_account", { p_code: code.trim() });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("INVALID_BIND_CODE");
}

/** 家长凭绑定码关联孩子档案；若当前 role=student 会被 RPC 内部升级为 parent（10-§5.3 bind_guardian）。 */
export async function bindGuardianAction(code: string, relation: string, consents: {profile:boolean;learning:boolean;video:boolean}): Promise<void> {
  const { supabase } = await authenticatedClient();
  const { data: studentId, error } = await supabase.rpc("bind_guardian", { p_code: code.trim(), p_relation: relation.trim().slice(0, 40) });
  if (error) throw new Error(error.message);
  if (!studentId) throw new Error("INVALID_BIND_CODE");
  for(const [scope,consented] of Object.entries(consents)){
    const{error:consentError}=await supabase.rpc("record_guardian_consent",{p_student_id:studentId,p_scope:scope,p_consented:consented});
    if(consentError)throw new Error(consentError.message);
  }
}

export async function issueGuardianInviteAction(studentId:string,relation:string,scope:string[]):Promise<string>{
  const{supabase}=await authenticatedClient();
  const allowed=["grades","video","finance"];
  const normalized=Array.from(new Set(scope.filter(value=>allowed.includes(value))));
  const{data,error}=await supabase.rpc("issue_guardian_invite",{p_student_id:studentId,p_relation:relation.trim().slice(0,40),p_scope:normalized});
  if(error||typeof data!=="string")throw new Error(error?.message??"INVITE_FAILED");
  return data;
}

export interface GuardianScopeRow { guardianId:string; displayName:string; relation:string; scope:string[]; isPrimary:boolean }
export async function listStudentGuardiansAction(studentId:string):Promise<GuardianScopeRow[]>{
  const{supabase}=await authenticatedClient();
  const{data,error}=await supabase.rpc("list_student_guardians",{p_student_id:studentId});
  if(error)throw new Error(error.message);
  return ((data??[]) as Array<{guardian_id:string;display_name:string;relation:string;scope:string[];is_primary:boolean}>).map(row=>({guardianId:row.guardian_id,displayName:row.display_name,relation:row.relation,scope:row.scope??[],isPrimary:row.is_primary}));
}
export async function setGuardianScopeAction(studentId:string,guardianId:string,scope:string[]):Promise<void>{
  const{supabase}=await authenticatedClient();
  const{error}=await supabase.rpc("set_guardian_scope",{p_student_id:studentId,p_guardian_id:guardianId,p_scope:scope});
  if(error)throw new Error(error.message);
}
