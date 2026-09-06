'use server';

import { z } from 'zod';
import { actionError, type ActionResult } from '@/lib/action-result';
import { getProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { ACTIVITY_KINDS } from './activity-kinds';
import { STORED_ASSESSMENT_BANDS } from './activity-workflow-contract';
import { COMMON_CODES, dateOnly, intInRange, money, parse, requiredText, text, uuid } from './actions/schemas';
import { isLocalHistoryArchiveEnvironment } from './history-archive-contract';
import { BUSINESS_HISTORY_KINDS } from './student-business-history-contract';
import type { BusinessRecordRevisionContext, BusinessRecordRevisionTarget, RevisionValues } from './business-record-revision-contract';

const date = dateOnly.refine(value => { const parsed = new Date(`${value}T00:00:00Z`); return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === value; }).nullable();
// 原导入的 MD5 标识已保存为 PostgreSQL UUID；兼容其版本位，继续校验完整 UUID 格式。
const targetSchema = z.object({ kind: z.enum(BUSINESS_HISTORY_KINDS), recordId: uuid.or(z.guid()) }).strict();
const revisionSchema = targetSchema.extend({
  expectedVersion: z.string().regex(/^[a-f0-9]{32}$/), reason: text(1000),
  values: z.object({
    activities: z.object({ title: requiredText(100), kind: z.enum(ACTIVITY_KINDS), occurred_on: date, location: text(100), remark: text(1000) }).strict().optional(),
    activity_registrations: z.object({ registered_on: date, status: z.enum(['booked','attended','no_show','cancelled']), reported_result: text(2000), result_link_status: z.enum(['none','edition_unconfirmed','confirmed']) }).strict().optional(),
    assessment_results: z.object({ assessed_on: date, assessment_band: z.enum(STORED_ASSESSMENT_BANDS).nullable(), score: intInRange(0,10000).nullable(), strengths: text(20000) }).strict().optional(),
    course_opportunities: z.object({ period_year: intInRange(1900,2200).nullable(), period_key: z.enum(['summer','autumn']), stage: z.enum(['unknown','enrolled','not_enrolled']), note: text(20000), class_label: text(200), teacher_label: text(200) }).strict().optional(),
    course_enrollments: z.object({ registered_on: date, period_label: text(200), amount: money.refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001).nullable(), amount_original: text(200) }).strict().optional(),
    course_enrollment_assignments: z.object({ class_label: text(200), teacher_label: text(200), room_label: text(200), schedule_label: text(500) }).strict().optional(),
    student_follow_ups: z.object({ occurred_on: date, author_label: text(200).nullable(), content: requiredText(20000) }).strict().optional(),
  }).strict(),
}).strict();
const codes = [...COMMON_CODES,'NOT_FOUND','REVISION_CONFLICT','NO_CHANGES','MULTIPLE_ASSIGNMENTS'];
async function revisionClient() {
  const client = await createClient();
  const {data:{user}} = await client.auth.getUser();
  if(!user) throw new Error('UNAUTHENTICATED');
  if(!isLocalHistoryArchiveEnvironment(process.env.NODE_ENV,process.env.NEXT_PUBLIC_SUPABASE_URL) || (await getProfile(user.id))?.role !== 'admin') throw new Error('FORBIDDEN');
  return client;
}
export async function getBusinessRecordRevisionAction(input: BusinessRecordRevisionTarget): Promise<ActionResult<BusinessRecordRevisionContext>> {
  try {
    const value = parse(targetSchema,input), client = await revisionClient();
    const {data,error} = await client.rpc('get_business_record_revision',{p_kind:value.kind,p_id:value.recordId});
    if(error) throw new Error(error.message);
    return {ok:true,data:data as unknown as BusinessRecordRevisionContext};
  } catch(error) { return actionError(error,codes); }
}
export async function saveBusinessRecordRevisionAction(input: BusinessRecordRevisionTarget & {expectedVersion:string; values:RevisionValues; reason:string}): Promise<ActionResult<string>> {
  try {
    const value = parse(revisionSchema,input), client = await revisionClient();
    const {data,error} = await client.rpc('revise_business_record',{p_kind:value.kind,p_id:value.recordId,p_expected_version:value.expectedVersion,p_values:value.values,p_reason:value.reason});
    if(error) throw new Error(error.message);
    return {ok:true,data};
  } catch(error) { return actionError(error,codes); }
}
