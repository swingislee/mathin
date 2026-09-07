'use server';

import { z } from 'zod';
import { actionError, type ActionResult } from '@/lib/action-result';
import { requireDashboardEnvironment } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { isLocalHistoryArchiveEnvironment } from '../history-archive-contract';
import type { ProfileReviewResponse } from '../profile-review-contract';
import { COMMON_CODES, parse, text, uuid } from './schemas';
import { nullableRpcArg } from './guards';

const answer = z.object({ answer: z.enum(['yes', 'correction', 'unknown']), value: text(500).optional() }).strict()
  .refine(value => value.answer === 'correction' ? Boolean(value.value) : !value.value);
const feedbackSchema = z.object({
  locale: z.enum(['zh', 'en']), itemId: uuid, scope: z.enum(['teacher', 'support']), version: z.number().int().nonnegative(),
  answers: z.object({ name: answer.optional(), grade: answer.optional(), class: answer.optional(), enrollment: answer.optional(), contact: answer.optional() })
    .strict().refine(value => Object.keys(value).length > 0),
}).strict();
const assignmentSchema = z.object({ locale: z.enum(['zh', 'en']), groupId: uuid, teacherId: uuid.nullable(), supportId: uuid.nullable(), version: z.number().int().nonnegative() }).strict();
const codes = [...COMMON_CODES, 'LOCAL_ONLY', 'VERSION_CONFLICT', 'REVIEWER_UNAVAILABLE', 'NOT_FOUND'];
const readSchema = z.object({ locale: z.enum(['zh', 'en']), itemId: uuid, scope: z.enum(['teacher', 'support']) }).strict();

async function reviewClient(locale: string) {
  if (!isLocalHistoryArchiveEnvironment(process.env.NODE_ENV, process.env.NEXT_PUBLIC_SUPABASE_URL)) throw new Error('LOCAL_ONLY');
  await requireDashboardEnvironment(locale, ['staff']);
  return createClient();
}

export async function saveProfileReviewAction(input: unknown): Promise<ActionResult<ProfileReviewResponse>> {
  try {
    const value = parse(feedbackSchema, input);
    const client = await reviewClient(value.locale);
    const { data, error } = await client.rpc('save_student_profile_review', {
      p_item_id: value.itemId, p_scope: value.scope, p_expected_version: value.version, p_answers: value.answers,
    });
    if (error) throw new Error(error.message);
    return { ok: true, data: data as unknown as ProfileReviewResponse };
  } catch (error) { return actionError(error, codes); }
}

export async function assignProfileReviewAction(input: unknown): Promise<ActionResult<number>> {
  try {
    const value = parse(assignmentSchema, input);
    const client = await reviewClient(value.locale);
    const { data, error } = await client.rpc('assign_student_profile_review', {
      p_group_id: value.groupId, p_teacher_id: nullableRpcArg(value.teacherId), p_support_id: nullableRpcArg(value.supportId), p_expected_version: value.version,
    });
    if (error) throw new Error(error.message);
    return { ok: true, data };
  } catch (error) { return actionError(error, codes); }
}

export async function readProfileReviewResponseAction(input: unknown): Promise<ActionResult<ProfileReviewResponse | null>> {
  try {
    const value = parse(readSchema, input);
    const client = await reviewClient(value.locale);
    const { data, error } = await client.from('student_profile_review_responses')
      .select('item_id,scope,answers,version,recorded_at,recorded_by').eq('item_id', value.itemId).eq('scope', value.scope).maybeSingle();
    if (error) throw new Error(error.message);
    return { ok: true, data: data as unknown as ProfileReviewResponse | null };
  } catch (error) { return actionError(error, codes); }
}
