import { z } from 'zod';
import { databaseUuid } from '@/lib/database-uuid';

export const SUPPORT_WORKSPACES = ['leads','communication','assessments','enrollments','renewals','students'] as const;
export type SupportWorkspace = typeof SUPPORT_WORKSPACES[number];
const id = databaseUuid.nullable();
export const supportSubjectSchema = z.object({ studentId: id, leadId: id, version: z.string().min(1) })
  .refine(value => Boolean(value.studentId || value.leadId));
export const supportCandidateSchema = supportSubjectSchema.and(z.object({
  name: z.string(), phone: z.string(), grade: z.number().nullable(), parentName: z.string(), school: z.string(),
  ownerName: z.string(), canWrite: z.boolean(), phoneMatch: z.boolean(), nameMatch: z.boolean(),
}));
export type SupportCandidate = z.infer<typeof supportCandidateSchema>;
export const supportWorkSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), note: z.string().max(2000),
  worklistId: id.optional(), activityId: id.optional(), scheduledAt: z.iso.datetime({ offset: true }).nullable().optional(),
  arrived: z.boolean().optional(), location: z.string().max(200).optional(),
  courseId: id.optional(), termId: id.optional(), cycleId: id.optional(), closed: z.boolean().optional(),
}).strict();
export type SupportWork = z.infer<typeof supportWorkSchema>;
export const supportEntrySchema = z.object({
  workspace: z.enum(SUPPORT_WORKSPACES), subject: supportSubjectSchema.nullable(),
  newPerson: z.object({ name: z.string().trim().max(100), phone: z.string().trim().max(40), grade: z.number().int().min(1).max(12).nullable(),
    createStudent: z.boolean(), identityPending: z.boolean() }).strict().nullable(),
  work: supportWorkSchema, acknowledgeDuplicate: z.boolean(),
}).strict().refine(value => Boolean(value.subject) !== Boolean(value.newPerson))
  .refine(value => !value.newPerson || Boolean(value.newPerson.name || value.newPerson.phone))
  .refine(value => !value.newPerson?.createStudent || Boolean(value.newPerson.name && !value.newPerson.identityPending));
export type SupportEntry = z.infer<typeof supportEntrySchema>;
export const supportItemSchema = z.object({
  id: databaseUuid, workspace: z.enum(SUPPORT_WORKSPACES), studentId: id, leadId: id,
  name: z.string(), phone: z.string(), grade: z.number().nullable(), note: z.string(), workDate: z.string().nullable(),
  worklistId: id, registrationId: id, courseId: id, termId: id, opportunityId: id, enrollmentId: id, cycleId: id,
  revision: z.number().int(), closedAt: z.string().nullable(), createdAt: z.string(),
  identityPending: z.boolean(), canWrite: z.boolean(), courseTitle: z.string(), termName: z.string(),
});
export type SupportItem = z.infer<typeof supportItemSchema>;
export const supportProfileValuesSchema = z.object({
  name: z.string().max(100), grade: z.number().int().min(1).max(12).nullable(), phone: z.string().max(40),
  parentPhone: z.string().max(40).optional(), parentName: z.string().max(100).optional(), school: z.string().max(100).optional(),
  wechat: z.string().max(80).optional(), remark: z.string().max(2000),
}).strict();
export const supportProfileSchema = z.object({ studentId: id, leadId: id, version: z.string(), values: supportProfileValuesSchema,
  canEdit: z.boolean(), identityPending: z.boolean(), changes: z.array(z.object({ id: databaseUuid,
    before: supportProfileValuesSchema, after: supportProfileValuesSchema, recordedAt: z.string(), recordedBy: z.string() })) });
export type SupportProfile = z.infer<typeof supportProfileSchema>;
export const SUPPORT_REFRESH_EVENT = 'mathin:school-support-refresh';

export function supportEntryHref(item: SupportItem): string {
  const query = new URLSearchParams({ manual: item.id, state: 'current' });
  if (item.workspace === 'students') {
    query.set('population','records'); query.set('q', item.name); query.set('scope','all');
    return `/dashboard/students?${query}`;
  }
  if (item.workspace === 'communication' && item.worklistId) {
    query.set('view','worklist'); query.set('worklist',item.worklistId);
    if (item.workDate) query.set('date',item.workDate);
    if (item.leadId) query.set('lead',item.leadId);
  } else if (item.workspace === 'leads') { query.set('q',item.name); query.set('scope','all'); }
  else if (item.workspace === 'assessments') { query.set('q',item.name); if (item.registrationId) query.set('registration',item.registrationId); }
  else if (item.workspace === 'renewals' && item.cycleId) query.set('cycle',item.cycleId);
  return `/dashboard/followups/${item.workspace}?${query}`;
}

export function supportMessages(locale: string) {
  const en = locale === 'en';
  return {
    add: en ? 'Add student' : '补入学生', search: en ? 'Find by name, phone, parent or WeChat' : '按姓名、电话、家长或微信检索',
    searchFirst: en ? 'Check existing profiles first. Shared phone numbers may belong to different children.' : '先检索已有档案；同一电话可能对应不同孩子。',
    newPerson: en ? 'Register with available details' : '未找到合适档案，按现有资料登记',
    loading: en ? 'Loading…' : '正在读取…', retry: en ? 'Retry' : '重试', cancel: en ? '取消 / Cancel' : '取消',
    save: en ? 'Save' : '保存', saved: en ? 'Saved' : '已保存', edit: en ? 'Profile & corrections' : '资料与修订',
    name: en ? 'Student name' : '学生姓名', phone: en ? 'Phone' : '联系电话', grade: en ? 'Grade' : '年级',
    parentPhone: en ? 'Parent phone' : '家长电话', parentName: en ? 'Parent name' : '家长姓名', school: en ? 'School' : '学校',
    wechat: en ? 'WeChat' : '微信', remark: en ? 'Profile notes' : '档案备注', unknown: en ? 'To confirm' : '待确认',
    confirmed: en ? 'Identity checked; create a student profile' : '已确认是新学生，建立学生档案',
    minimal: en ? 'Name or phone is enough to keep this work. Confirm identity before enrollment.' : '姓名或电话至少填一项即可保留本次待办；确认身份后继续报名。',
    note: en ? 'What needs to be handled' : '本次办理说明', date: en ? 'Work date' : '办理日期',
    activity: en ? 'Assessment / trial arrangement' : '测评／体验安排', direct: en ? 'Direct one-to-one assessment' : '直接安排一对一测评',
    pendingActivity: en ? 'Arrange later' : '安排待补', time: en ? 'Actual appointment time' : '实际预约时间',
    arrived: en ? 'Student has arrived' : '学生已实际到场', location: en ? 'Location' : '地点',
    course: en ? 'Target course' : '目标课程', term: en ? 'Target term' : '目标学期',
    workspaces: en ? ['First contact','Communication','Assessment / trial','Enrollment','Renewal','Student records'] : ['首联','沟通','测评／体验','报名','续报','学生档案'],
    pending: en ? 'Manual entry · continue handling' : '手工补入 · 待继续办理', continue: en ? 'Continue' : '继续办理',
    close: en ? 'Remove from this work list' : '结束本次待办', history: en ? 'Profile revisions' : '资料修订记录',
    link: en ? 'Confirm as this existing student' : '确认关联到该学生', create: en ? 'Confirm as a new student' : '确认为新学生并建档',
    identity: en ? 'Confirm student identity' : '确认学生身份', details: en ? 'View profile' : '查看档案',
    duplicate: en ? 'I checked the matching profiles; this is a different child' : '已核对匹配档案，确认是另一名学生',
    workHint: en ? 'Incomplete course details stay here. Enrollment is confirmed in the enrollment form.' : '课程资料未齐时保留在此；报名结果在登记表中确认。',
  };
}

export function supportError(code: string, locale: string) {
  const en = locale === 'en';
  if (['PROFILE_CONFLICT','SUBJECT_CHANGED','WORK_ITEM_CONFLICT'].includes(code)) return en ? 'Details changed. Reload and check your draft before saving.' : '资料已被更新，请重新读取并核对草稿后保存。';
  if (['POSSIBLE_DUPLICATE','CONTACT_CONFLICT','ASSOCIATION_CONFLICT'].includes(code)) return en ? 'Matching records exist. Search and confirm the correct child.' : '存在匹配记录，请先检索并核对孩子身份。';
  if (code.includes('FORBIDDEN') || code === 'LEAD_UNASSIGNED') return en ? 'This record needs an authorized owner to handle it.' : '请由有权限的负责人办理这条记录。';
  if (['IDENTITY_CHANGE_REQUIRED','IDENTITY_NOT_CONFIRMED'].includes(code)) return en ? 'Confirm the student identity first.' : '请先确认学生身份。';
  if (['ACTIVITY_NOT_AVAILABLE','PARTICIPATION_CLOSED','COURSE_NOT_AVAILABLE','INVALID_CYCLE_STATE'].includes(code)) return en ? 'The selected arrangement is unavailable. Choose a current one.' : '所选安排已不可用，请重新选择当前安排。';
  return en ? 'Save failed. Check the details and retry; your draft is retained.' : '保存未完成，请核对资料后重试，当前草稿已保留。';
}
