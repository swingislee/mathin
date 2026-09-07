export const PROFILE_REVIEW_FIELDS = ['name', 'grade', 'class', 'enrollment', 'contact'] as const;
export type ProfileReviewField = typeof PROFILE_REVIEW_FIELDS[number];
export type ProfileReviewScope = 'teacher' | 'support';
export type ProfileReviewAnswer = { answer: 'yes' | 'correction' | 'unknown'; value?: string };
export type ProfileReviewAnswers = Partial<Record<ProfileReviewField, ProfileReviewAnswer>>;

export interface ProfileReviewGroup {
  id: string; label: string; teacher_name: string; teacher_id: string | null; support_id: string | null; version: number;
}
export interface ProfileReviewItem {
  id: string; group_id: string; name: string; grade: string;
  enrollment_state: 'in_study' | 'pending_registration' | 'unspecified'; needs_contact: boolean; grade_attention: boolean;
}
export interface ProfileReviewResponse {
  item_id: string; scope: ProfileReviewScope; answers: ProfileReviewAnswers; version: number; recorded_at: string; recorded_by: string;
}
export interface ProfileReviewData {
  userId: string; admin: boolean;
  batch: { title: string; source_label: string; source_at: string } | null;
  groups: ProfileReviewGroup[]; items: ProfileReviewItem[]; responses: ProfileReviewResponse[];
  reviewers: { id: string; name: string }[];
}

export function profileReviewFields(item: ProfileReviewItem, scope: ProfileReviewScope): ProfileReviewField[] {
  return scope === 'support' && item.needs_contact ? [...PROFILE_REVIEW_FIELDS] : ['name', 'grade', 'class', 'enrollment'];
}

export function profileReviewProgress(answers: ProfileReviewAnswers, fields: readonly ProfileReviewField[]) {
  const values = fields.map(field => answers[field]);
  if (values.every(value => !value)) return 'pending';
  if (values.some(value => value?.answer === 'correction')) return 'supplemented';
  if (values.every(value => value?.answer === 'yes')) return 'responded';
  if (values.every(value => !value || value.answer === 'unknown')) return 'later';
  return 'partial';
}

/** 暂时不了解只填未回答项，已明确的事实与补充继续保留。 */
export function deferProfileReview(answers: ProfileReviewAnswers, fields: readonly ProfileReviewField[]): ProfileReviewAnswers {
  return Object.fromEntries(fields.map(field => [field, answers[field] ?? { answer: 'unknown' }]));
}

export function profileReviewSourceValue(item: ProfileReviewItem, group: ProfileReviewGroup, field: ProfileReviewField) {
  if (field === 'name') return item.name;
  if (field === 'grade') return item.grade;
  if (field === 'class') return group.label;
  if (field === 'enrollment') return item.enrollment_state === 'unspecified' ? '' : item.enrollment_state;
  return '';
}
