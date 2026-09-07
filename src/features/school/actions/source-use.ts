'use server';
import { z } from 'zod';
import { actionError, type ActionResult } from '@/lib/action-result';
import { requireDashboardEnvironment } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { isLocalHistoryArchiveEnvironment } from '../history-archive-contract';
import type { SourceUseContext } from '../source-use-contract';
import { COMMON_CODES, parse, requiredText, text, uuid } from './schemas';
const contextSchema=z.object({locale:z.enum(['zh','en']),recordId:requiredText(160),studentId:uuid.optional(),query:text(100).optional()}).strict();
const confirmSchema=z.object({locale:z.enum(['zh','en']),recordId:requiredText(160),studentId:uuid,version:z.number().int().nonnegative(),
  context:z.enum(['student_profile','followup','activity','assessment','enrollment','renewal'])}).strict();
const codes=[...COMMON_CODES,'LOCAL_ONLY','NOT_FOUND','VERSION_CONFLICT','SOURCE_IN_USE','SOURCE_ALREADY_LINKED','SOURCE_SHARED_RECORD'];
async function sourceClient(locale:string) {
  if(!isLocalHistoryArchiveEnvironment(process.env.NODE_ENV,process.env.NEXT_PUBLIC_SUPABASE_URL))throw new Error('LOCAL_ONLY');
  await requireDashboardEnvironment(locale,['staff']);return createClient();
}
export async function getSourceUseContextAction(input:unknown):Promise<ActionResult<SourceUseContext>> {
  try {
    const value=parse(contextSchema,input),client=await sourceClient(value.locale);
    const {data,error}=await client.rpc('get_history_source_context',{p_record_id:value.recordId,p_student_id:value.studentId,p_query:value.query??''});
    if(error)throw new Error(error.message);return {ok:true,data:data as unknown as SourceUseContext};
  } catch(error){return actionError(error,codes);}
}
export async function confirmSourceUseAction(input:unknown):Promise<ActionResult<number>> {
  try {
    const value=parse(confirmSchema,input),client=await sourceClient(value.locale);
    const {data,error}=await client.rpc('confirm_history_source',{p_record_id:value.recordId,p_student_id:value.studentId,p_expected_version:value.version,p_context:value.context});
    if(error)throw new Error(error.message);return {ok:true,data};
  } catch(error){return actionError(error,codes);}
}
