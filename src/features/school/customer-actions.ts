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
  const { error } = await supabase.rpc("claim_student_account", { p_code: code.trim() });
  if (error) throw new Error(error.message);
}

/** 家长凭绑定码关联孩子档案；若当前 role=student 会被 RPC 内部升级为 parent（10-§5.3 bind_guardian）。 */
export async function bindGuardianAction(code: string, relation: string, consents: {profile:boolean;learning:boolean;video:boolean}): Promise<void> {
  const { supabase } = await authenticatedClient();
  const { data: studentId, error } = await supabase.rpc("bind_guardian", { p_code: code.trim(), p_relation: relation.trim().slice(0, 40) });
  if (error) throw new Error(error.message);
  for(const [scope,consented] of Object.entries(consents)){
    const{error:consentError}=await supabase.rpc("record_guardian_consent",{p_student_id:studentId,p_scope:scope,p_consented:consented});
    if(consentError)throw new Error(consentError.message);
  }
}

export async function issueGuardianInviteAction(studentId:string,relation:string):Promise<string>{
  const{supabase}=await authenticatedClient();
  const{data,error}=await supabase.rpc("issue_guardian_invite",{p_student_id:studentId,p_relation:relation.trim().slice(0,40),p_scope:["grades","video","finance"]});
  if(error||typeof data!=="string")throw new Error(error?.message??"INVITE_FAILED");
  return data;
}
