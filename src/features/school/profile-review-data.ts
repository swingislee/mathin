import 'server-only';
import { getProfile, requireDashboardEnvironment } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { isLocalHistoryArchiveEnvironment } from './history-archive-contract';
import { listStaffMembers } from './staff';
import { PROFILE_REVIEW_ENABLED, type ProfileReviewData, type ProfileReviewResponse } from './profile-review-contract';

export async function loadProfileReview(locale: string): Promise<ProfileReviewData> {
  if (!PROFILE_REVIEW_ENABLED) throw new Error('NOT_FOUND');
  if (!isLocalHistoryArchiveEnvironment(process.env.NODE_ENV, process.env.NEXT_PUBLIC_SUPABASE_URL)) throw new Error('LOCAL_ONLY');
  const { user } = await requireDashboardEnvironment(locale, ['staff']);
  const admin = (await getProfile(user.id))?.role === 'admin';
  const client = await createClient();
  const { data: batch, error } = await client.from('student_profile_review_batches')
    .select('id,title,source_label,source_at').order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error('PROFILE_REVIEW_READ_FAILED');
  const empty: ProfileReviewData = { userId: user.id, admin, batch, groups: [], items: [], responses: [], reviewers: [] };
  if (!batch) return empty;
  const [{ data: groups, error: groupError }, staff] = await Promise.all([
    client.from('student_profile_review_groups').select('id,label,teacher_name,teacher_id,support_id,version').eq('batch_id', batch.id).order('label').limit(501),
    admin ? listStaffMembers() : Promise.resolve([]),
  ]);
  if (groupError || !groups || groups.length > 500) throw new Error('PROFILE_REVIEW_GROUP_READ_FAILED');
  if (!groups.length) return empty;
  const { data: items, error: itemError } = await client.from('student_profile_review_items')
    .select('id,group_id,name,grade,enrollment_state,needs_contact,grade_attention').in('group_id', groups.map(group => group.id)).order('source_order').limit(1000);
  if (itemError || !items || items.length >= 1000) throw new Error('PROFILE_REVIEW_ITEM_READ_FAILED');
  const { data: responses, error: responseError } = items.length ? await client.from('student_profile_review_responses')
    .select('item_id,scope,answers,version,recorded_at,recorded_by').in('item_id', items.map(item => item.id)).limit(1000) : { data: [], error: null };
  if (responseError || !responses || responses.length >= 1000) throw new Error('PROFILE_REVIEW_RESPONSE_READ_FAILED');
  return { ...empty, groups, items: items as ProfileReviewData['items'], responses: responses as unknown as ProfileReviewResponse[],
    reviewers: staff.filter(person => person.isActive).map(person => ({ id: person.userId, name: person.displayName })) };
}
