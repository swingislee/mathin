'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { actionError, type ActionResult } from '@/lib/action-result';
import { authorizedClient } from './actions/guards';
import { COMMON_CODES, parse, uuid, text, requiredText } from './actions/schemas';
import { STUDENT_MERGE_FIELDS, studentMergeHistorySchema, studentMergeProfileSchema, studentMergeResultSchema, studentMergeReviewSchema, type StudentMergeChoices } from './student-merge-contract';

const codes=['FORBIDDEN_SCOPE',...COMMON_CODES,'SAME_STUDENT','STUDENT_DELETED','ALREADY_MERGED','MERGE_CHANGED','MERGE_CONFLICT','MERGE_PREVIEW_REQUIRED'];
const pairSchema=z.object({keptId:uuid,mergedId:uuid}).strict().refine(value=>value.keptId!==value.mergedId);
const searchSchema=z.object({studentId:uuid,query:text(100)}).strict();
const confirmSchema=z.object({keptId:uuid,mergedId:uuid,token:z.string().regex(/^[a-f0-9]{32}$/),
  choices:z.partialRecord(z.enum(STUDENT_MERGE_FIELDS),z.enum(['kept','merged'])),reason:requiredText(2000)}).strict();

async function call<T>(name:string,args:Record<string,unknown>,schema:z.ZodType<T>,write=false):Promise<ActionResult<T>> {
  try {
    const {supabase}=await authorizedClient('student.edit');
    const rpc=supabase.rpc as unknown as (name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:{message:string}|null}>;
    const {data,error}=await rpc.call(supabase,name,args);
    if(error)throw new Error(error.message);
    const result=schema.parse(data);
    if(write){revalidatePath('/[locale]/dashboard/students','layout');revalidatePath('/[locale]/dashboard','layout');revalidatePath('/[locale]/dashboard/classes','layout');}
    return {ok:true,data:result} as ActionResult<T>;
  }catch(error){return actionError<T>(error,codes);}
}
export async function searchStudentMergeCandidatesAction(studentId:string,query:string){
  try {const value=parse(searchSchema,{studentId,query});return await call('search_student_merge_candidates',{p_student_id:value.studentId,p_query:value.query},z.array(studentMergeProfileSchema));}
  catch(error){return actionError<z.infer<typeof studentMergeProfileSchema>[]>(error,codes);}
}
export async function previewStudentMergeAction(keptId:string,mergedId:string){
  try {const value=parse(pairSchema,{keptId,mergedId});return await call('preview_student_merge',{p_kept_id:value.keptId,p_merged_id:value.mergedId},studentMergeReviewSchema);}
  catch(error){return actionError<z.infer<typeof studentMergeReviewSchema>>(error,codes);}
}
export async function confirmStudentMergeAction(input:{keptId:string;mergedId:string;token:string;choices:StudentMergeChoices;reason:string}){
  try {const value=parse(confirmSchema,input);return await call('confirm_student_merge',{p_kept_id:value.keptId,p_merged_id:value.mergedId,p_expected_token:value.token,p_choices:value.choices,p_reason:value.reason},studentMergeResultSchema,true);}
  catch(error){return actionError<z.infer<typeof studentMergeResultSchema>>(error,codes);}
}
export async function getStudentMergeHistoryAction(studentId:string){
  try {return await call('get_student_merge_history',{p_student_id:parse(uuid,studentId)},studentMergeHistorySchema);}
  catch(error){return actionError<z.infer<typeof studentMergeHistorySchema>>(error,codes);}
}
