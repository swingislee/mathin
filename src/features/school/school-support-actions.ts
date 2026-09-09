'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { actionError, type ActionResult } from '@/lib/action-result';
import { databaseUuid } from '@/lib/database-uuid';
import { getMyPerms } from '@/lib/auth';
import { authorizedClient } from './actions/guards';
import { COMMON_CODES, parse } from './actions/schemas';
import { loadPhase3EnrollmentOptions } from './phase3-enrollment-data';
import { listInvitationOptions } from './invitations';
import { SUPPORT_WORKSPACES, supportCandidateSchema, supportEntrySchema, supportItemSchema, supportProfileSchema, supportFamilyPreviewSchema,
  supportProfileValuesSchema, supportWorkSchema, type SupportEntry, type SupportProfile, type SupportWork, type SupportWorkspace } from './school-support-contract';

const codes = ['FORBIDDEN_SCOPE',...COMMON_CODES,'PROFILE_CONFLICT','SUBJECT_CHANGED','WORK_ITEM_CONFLICT','REQUEST_CONFLICT','FAMILY_REVIEW_REQUIRED','FAMILY_PHONE_MISMATCH','FAMILY_CHANGED',
  'POSSIBLE_DUPLICATE','CONTACT_CONFLICT','ASSOCIATION_CONFLICT','IDENTITY_CHANGE_REQUIRED','IDENTITY_NOT_CONFIRMED',
  'WORK_ITEM_CLOSED','BUSINESS_CHANGE_REQUIRED','ACTIVITY_NOT_AVAILABLE','PARTICIPATION_CLOSED','COURSE_NOT_AVAILABLE',
  'CLASS_NOT_AVAILABLE','CLASS_TARGET_MISMATCH','SEAT_OCCUPIED','CLASS_FULL','INVALID_SEAT','ALREADY_ENROLLED','TERM_NOT_FOUND','INVALID_CYCLE_STATE','LEAD_CLOSED','LEAD_UNASSIGNED','NOT_FOUND'];
const subjectSchema = z.object({ studentId: databaseUuid.nullable(), leadId: databaseUuid.nullable() })
  .refine(value => Boolean(value.studentId || value.leadId));
const version = z.string().min(1).max(60);
async function call<T>(name: string, args: Record<string, unknown>, schema: z.ZodType<T>, permission: 'followup.view' | 'followup.write' | 'student.edit', write = false): Promise<ActionResult<T>> {
  try {
    const { supabase } = await authorizedClient(permission);
    const rpc = supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: {message: string} | null }>;
    const result = await rpc.call(supabase,name,args);
    if (result.error) throw new Error(result.error.message);
    const data = schema.parse(result.data);
    if (write) { revalidatePath('/[locale]/dashboard/followups','layout'); revalidatePath('/[locale]/dashboard/students','page'); }
    return {ok:true,data} as ActionResult<T>;
  } catch (error) { return actionError<T>(error,codes); }
}
export async function searchSupportSubjectsAction(search: string) {
  try { return await call('search_school_support_subjects',{p_search:parse(z.string().trim().max(100),search)},z.array(supportCandidateSchema),'followup.view'); }
  catch(error) { return actionError<z.infer<typeof supportCandidateSchema>[]>(error,codes); }
}
export async function addSupportWorkAction(requestId: string, input: SupportEntry) {
  try { return await call('add_school_support_work_item',{p_request_id:parse(databaseUuid,requestId),p_payload:parse(supportEntrySchema,input)},supportItemSchema,'followup.write',true); }
  catch(error) { return actionError<z.infer<typeof supportItemSchema>>(error,codes); }
}
export async function listSupportWorkAction(workspace: SupportWorkspace) {
  try { return await call('list_school_support_work_items',{p_workspace:parse(z.enum(SUPPORT_WORKSPACES),workspace)},z.array(supportItemSchema),'followup.view'); }
  catch(error) { return actionError<z.infer<typeof supportItemSchema>[]>(error,codes); }
}
export async function updateSupportWorkAction(id: string, revision: number, work: SupportWork) {
  try { return await call('update_school_support_work_item',{p_id:parse(databaseUuid,id),p_expected_revision:parse(z.number().int().nonnegative(),revision),p_work:parse(supportWorkSchema,work)},supportItemSchema,'followup.write',true); }
  catch(error) { return actionError<z.infer<typeof supportItemSchema>>(error,codes); }
}
export async function readSupportProfileAction(subject: {studentId:string|null;leadId:string|null}) {
  try { const value=parse(subjectSchema,subject); return await call('read_school_support_profile',{p_student_id:value.studentId,p_lead_id:value.leadId},supportProfileSchema,'followup.view'); }
  catch(error) { return actionError<SupportProfile>(error,codes); }
}
export async function readSupportFamilyAction(studentId: string | null, otherStudentId: string) {
  try { return await call('preview_school_support_family_link',{
    p_student_id:parse(databaseUuid.nullable(),studentId),p_other_student_id:parse(databaseUuid,otherStudentId),
  },supportFamilyPreviewSchema,'followup.write'); }
  catch(error) { return actionError<z.infer<typeof supportFamilyPreviewSchema>>(error,codes); }
}
export async function updateSupportProfileAction(profile: Pick<SupportProfile,'studentId'|'leadId'|'version'|'values'>) {
  try { const value=parse(subjectSchema,profile); return await call('update_school_support_profile',{p_student_id:value.studentId,p_lead_id:value.leadId,
    p_expected_version:parse(version,profile.version),p_values:parse(supportProfileValuesSchema,profile.values)},supportProfileSchema,'followup.write',true); }
  catch(error) { return actionError<SupportProfile>(error,codes); }
}
export async function resolveSupportIdentityAction(leadId: string, studentId: string | null, expectedVersion: string) {
  try { const args = {p_lead_id:parse(databaseUuid,leadId),p_expected_version:parse(version,expectedVersion)};
    return await call(studentId ? 'resolve_school_support_identity' : 'confirm_school_support_identity',
      studentId ? {...args,p_student_id:parse(databaseUuid,studentId)} : args,supportProfileSchema,'student.edit',true); }
  catch(error) { return actionError<SupportProfile>(error,codes); }
}
export async function getSupportOptionsAction() {
  try {
    const { user } = await authorizedClient('followup.write');
    const [enrollment,invitations,permissions] = await Promise.all([loadPhase3EnrollmentOptions(),listInvitationOptions(),getMyPerms(user.id)]);
    return {ok:true as const,data:{enrollment,activities:invitations.activities,currentUserId:user.id,
      canCreate:permissions.has('student.create'),canEdit:permissions.has('followup.write'),canEnroll:permissions.has('enrollment.manage')}};
  } catch(error) { return actionError<never>(error,codes); }
}
