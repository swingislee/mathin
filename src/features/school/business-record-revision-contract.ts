import type { BusinessHistoryKind } from './student-business-history-contract';

type Option = readonly [value: string, zh: string, en: string];
type RevisionField = { key: string; zh: string; en: string; type?: 'date' | 'number' | 'textarea'; nullable?: boolean; options?: readonly Option[] };
export const REVISION_FIELDS: Record<string, { zh: string; en: string; fields: RevisionField[] }> = {
  activities: { zh: '活动信息', en: 'Activity', fields: [
    { key: 'title', zh: '活动名称', en: 'Activity name' },
    { key: 'kind', zh: '活动类型', en: 'Activity type', options: [['trial_class','体验课','Trial class'],['public_class','公开课','Public class'],['assessment_1v1','1 对 1 测评','1-to-1 assessment'],['sanbanfu','三板斧','Sanbanfu'],['lecture','讲座','Lecture'],['competition','竞赛','Competition']] },
    { key: 'occurred_on', zh: '举行日期', en: 'Activity date', type: 'date', nullable: true },
    { key: 'location', zh: '地点', en: 'Location' }, { key: 'remark', zh: '活动备注', en: 'Activity notes', type: 'textarea' },
  ] },
  activity_registrations: { zh: '学生参与与结果', en: 'Participation and result', fields: [
    { key: 'registered_on', zh: '报名日期', en: 'Registration date', type: 'date', nullable: true },
    { key: 'status', zh: '参与状态', en: 'Participation', options: [['booked','已报名','Registered'],['attended','已参加','Attended'],['no_show','未到场','No show'],['cancelled','已取消','Cancelled']] },
    { key: 'reported_result', zh: '奖项 / 结果', en: 'Award / result' },
    { key: 'result_link_status', zh: '结果对应届次', en: 'Result edition', options: [['none','未记录结果','No result recorded'],['edition_unconfirmed','届次待核对','Edition unconfirmed'],['confirmed','已确认对应本届','Confirmed for this edition']] },
  ] },
  assessment_results: { zh: '测评', en: 'Assessment', fields: [
    { key: 'assessed_on', zh: '测评日期', en: 'Assessment date', type: 'date', nullable: true },
    { key: 'assessment_band', zh: '测评等级', en: 'Assessment band', nullable: true, options: [['a_plus','A+','A+'],['a','A','A'],['s','S','S'],['c','C','C'],['g_plus','G+','G+'],['x_plus','X+','X+'],['below_a','A 以下','Below A']] },
    { key: 'score', zh: '分数', en: 'Score', type: 'number', nullable: true },
    { key: 'strengths', zh: '历史反馈', en: 'Historical feedback', type: 'textarea' },
  ] },
  course_opportunities: { zh: '续班', en: 'Renewal', fields: [
    { key: 'period_year', zh: '年份', en: 'Year', type: 'number', nullable: true },
    { key: 'period_key', zh: '学期', en: 'Term', options: [['summer','暑假','Summer'],['autumn','秋季','Autumn']] },
    { key: 'stage', zh: '最终结果', en: 'Final outcome', options: [['unknown','未记录','Not recorded'],['enrolled','已续班','Renewed'],['not_enrolled','未续班','Not renewed']] },
    { key: 'note', zh: '续班意向备注', en: 'Renewal intention notes', type: 'textarea' },
    { key: 'class_label', zh: '原班级', en: 'Recorded class' }, { key: 'teacher_label', zh: '原老师', en: 'Recorded teacher' },
  ] },
  course_enrollments: { zh: '报名信息', en: 'Enrollment', fields: [
    { key: 'registered_on', zh: '报名日期', en: 'Registration date', type: 'date', nullable: true },
    { key: 'period_label', zh: '学期', en: 'Term' }, { key: 'amount', zh: '报名金额', en: 'Enrollment amount', type: 'number', nullable: true },
    { key: 'amount_original', zh: '金额补充说明', en: 'Amount notes' },
  ] },
  course_enrollment_assignments: { zh: '原授课安排', en: 'Recorded class arrangement', fields: [
    { key: 'class_label', zh: '原班级', en: 'Recorded class' }, { key: 'teacher_label', zh: '原老师', en: 'Recorded teacher' },
    { key: 'room_label', zh: '原教室', en: 'Recorded classroom' }, { key: 'schedule_label', zh: '原上课时间', en: 'Recorded schedule' },
  ] },
  student_follow_ups: { zh: '历史沟通', en: 'Historical communication', fields: [
    { key: 'occurred_on', zh: '沟通日期', en: 'Communication date', type: 'date', nullable: true },
    { key: 'author_label', zh: '记录人', en: 'Recorded author', nullable: true }, { key: 'content', zh: '沟通内容', en: 'Communication notes', type: 'textarea' },
  ] },
};

export type RevisionValues = Record<string, Record<string, string | number | null>>;
type RevisionSnapshot = { relation: string; id: string; data: Record<string, unknown> };
export interface BusinessRecordRevisionContext {
  version: string;
  sections: Array<{ relation: string; values: RevisionValues[string] }>;
  revisions: Array<{ id: string; recorded_at: string; recorded_by: string; reason: string; before_data: RevisionSnapshot[]; after_data: RevisionSnapshot[] }>;
}
export interface BusinessRecordRevisionTarget { kind: BusinessHistoryKind; recordId: string }
export function businessRevisionMessages(locale: string) {
  return locale === 'zh' ? {
    edit: '修订', title: '修订历史记录', hint: '修改后会同步到业务表、学生档案和 360。原始导入资料与修改前后值会保留。',
    reason: '修改说明（选填）', save: '保存修订', cancel: '取消', loading: '正在读取记录…', retry: '重新读取',
    history: '修改记录', empty: '暂无修订', unknown: '未记录', saved: '修订已保存', failed: '读取或保存失败，请重试。',
    conflict: '这条记录已被修改。请重新读取最新内容后再修订。', invalid: '请检查填写内容；有结果时请选择对应届次状态。', noChanges: '内容没有变化。',
  } : {
    edit: 'Revise', title: 'Revise historical record', hint: 'Changes appear in business tables, the student profile and 360. Original imports and before/after values are retained.',
    reason: 'Reason (optional)', save: 'Save revision', cancel: 'Cancel', loading: 'Loading record…', retry: 'Reload record',
    history: 'Revision history', empty: 'No revisions yet', unknown: 'Not recorded', saved: 'Revision saved', failed: 'Unable to load or save. Please try again.',
    conflict: 'This record has changed. Reload its latest content before revising.', invalid: 'Check the values and select an edition status when a result is recorded.', noChanges: 'No changes to save.',
  };
}
export function revisionFieldLabel(relation: string, key: string, locale: string) {
  const field = REVISION_FIELDS[relation]?.fields.find(field => field.key === key);
  return field ? locale === 'zh' ? field.zh : field.en : key;
}
export function revisionFieldValue(relation: string, key: string, value: unknown, locale: string) {
  const field = REVISION_FIELDS[relation]?.fields.find(field => field.key === key);
  const option = field?.options?.find(option => option[0] === value);
  return option ? option[locale === 'zh' ? 1 : 2] : value == null || value === '' ? businessRevisionMessages(locale).unknown : String(value);
}
export function businessRevisionChanges(revision: BusinessRecordRevisionContext['revisions'][number]) {
  return revision.after_data.flatMap(after => {
    const before = revision.before_data.find(row => row.relation === after.relation && row.id === after.id);
    return (REVISION_FIELDS[after.relation]?.fields ?? []).filter(field => before?.data[field.key] !== after.data[field.key])
      .map(field => ({ relation: after.relation, key: field.key, before: before?.data[field.key], after: after.data[field.key] }));
  });
}
