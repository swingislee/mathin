import { z } from 'zod';
import { databaseUuid } from '@/lib/database-uuid';

export const STUDENT_MERGE_FIELDS = ['name','grade','phone','parentPhone','parentName','school','wechat','region','source','remark','status'] as const;
export type StudentMergeField = typeof STUDENT_MERGE_FIELDS[number];
export type StudentMergeChoices = Partial<Record<StudentMergeField, 'kept' | 'merged'>>;
export const studentMergeProfileSchema = z.object({
  id: databaseUuid, owner: z.string(), createdAt: z.string(), values: z.object({
    name: z.string(), grade: z.number().nullable(), phone: z.string(), parentPhone: z.string(), parentName: z.string(),
    school: z.string(), wechat: z.string(), region: z.string(), source: z.string(), remark: z.string(), status: z.string(),
  }),
});
export type StudentMergeProfile = z.infer<typeof studentMergeProfileSchema>;
export const studentMergeReviewSchema = z.object({
  kept: studentMergeProfileSchema, merged: studentMergeProfileSchema, token: z.string().length(32),
  accounts:z.object({kept:z.object({balance:z.number(),lessons:z.number()}),merged:z.object({balance:z.number(),lessons:z.number()})}).nullable(),
  counts: z.record(z.string(),z.object({kept:z.number(),merged:z.number(),preserved:z.number()})),
  blockers: z.array(z.object({kind:z.enum(['accounts','finance','overlap','unsupported']),category:z.string(),recordType:z.string().optional()})),
});
export type StudentMergeReview = z.infer<typeof studentMergeReviewSchema>;
export const studentMergeResultSchema = z.object({keptId:databaseUuid,mergedId:databaseUuid,mergeId:databaseUuid});
export const studentMergeHistorySchema = z.array(z.object({id:databaseUuid,keptId:databaseUuid,mergedId:databaseUuid,
  reason:z.string(),at:z.string(),actor:z.string(),original:studentMergeProfileSchema}));
export type StudentMergeHistory = z.infer<typeof studentMergeHistorySchema>;

export function defaultStudentMergeChoices(review: StudentMergeReview): StudentMergeChoices {
  return Object.fromEntries(STUDENT_MERGE_FIELDS.map(field=>[field,review.kept.values[field]===null||review.kept.values[field]===''?'merged':'kept']));
}

export function studentMergeError(code: string, locale: string) {
  const en=locale==='en';
  if(code==='MERGE_CHANGED') return en?'These records changed after the preview. Reload it and check your choices.':'预览后资料或记录已更新，请重新读取预览并核对选择。';
  if(code==='MERGE_CONFLICT') return en?'Overlapping records need review before merging. Both profiles are retained.':'存在需要先核对的重叠记录，两份档案均已保留。';
  if(code==='STUDENT_DELETED'||code==='ALREADY_MERGED') return en?'One profile was archived or merged. Reload the student records.':'其中一份档案已归档或合并，请重新读取学生列表。';
  if(code.includes('FORBIDDEN')) return en?'An operator with edit access to both profiles can perform this merge.':'请由能够编辑这两份档案的负责人处理合并。';
  return en?'Unable to finish. Your choices and reason are retained; please retry.':'本次操作未完成，已保留选择与说明，请重试。';
}

export function studentMergeMessages(locale: string) {
  const en=locale==='en';
  return {
    title:en?'Merge student profiles':'合并学生档案', open:en?'Merge profiles':'合并档案',
    description:en?'Find another record for the same child, compare the information, then confirm the retained profile.':'查找属于同一孩子的另一份档案，核对资料和记录后确认保留的档案。',
    search:en?'Search name, phone, parent, school or teacher':'按姓名、电话、家长、学校或老师查找',
    kept:en?'Retained profile':'保留档案', merged:en?'Profile to merge':'合入档案', compare:en?'Compare':'核对', swap:en?'Swap retained profile':'交换保留档案',
    fields:{name:en?'Name':'姓名',grade:en?'Grade':'年级',phone:en?'Phone':'电话',parentPhone:en?'Parent phone':'家长电话',parentName:en?'Parent name':'家长姓名',
      school:en?'School':'学校',wechat:en?'WeChat':'微信',region:en?'Region':'地区',source:en?'Source':'来源',remark:en?'Profile notes':'档案备注',status:en?'Status':'学生状态'} satisfies Record<StudentMergeField,string>,
    categories:{communication:en?'Communication':'线索与沟通',assessment:en?'Activities and assessments':'活动与测评',enrollment:en?'Enrollment and placement':'报名与分班',
      finance:en?'Accounts and ledgers':'账户与账目',family:en?'Family and contacts':'家庭与联系人',source:en?'Source records and history':'来源与历史',work:en?'Support work':'学服待办',teaching:en?'Teaching records':'教学记录'} as Record<string,string>,
    recordTypes:{course_opportunities:en?'Same course and term follow-ups':'同课程同学期跟进',course_enrollments:en?'Same course and term enrollments':'同课程同学期报名',
      enrollments:en?'Same-class memberships':'同班报名',activity_registrations:en?'Same activity registrations':'同场活动登记',session_attendance:en?'Same-session attendance':'同课次考勤',
      session_reviews:en?'Same-session reviews':'同课次学情',student_grade_history:en?'Same-term grades':'同学期年级',student_school_year_grades:en?'Same-year grades':'同学年年级',
      student_guardians:en?'Guardian links':'家长关联',student_contacts:en?'Contacts':'联系人',family_students:en?'Family links':'家庭关联',history_workflow_scopes:en?'History handling state':'历史办理状态'} as Record<string,string>,
    status:{lead:en?'Prospect':'潜在学生',trialing:en?'Trial':'体验中',enrolled:en?'Enrolled':'在读',paused:en?'Paused':'停读',graduated:en?'Graduated':'已结业'} as Record<string,string>,
    choose:en?'Use this value':'采用此值', empty:'—', loading:en?'Loading…':'正在读取…', noMatches:en?'No matching profiles. Try another detail.':'暂无匹配档案，可换一项资料查找。',
    records:en?'Associated records':'关联记录', preservation:en?'Original source records, frozen rosters and audit trails are preserved. Other records move to the retained profile.':'原始来源、冻结花名册和既有审计保留，其他记录归入保留档案；相同的基础资料保留原记录供追溯。',
    financeConflict:en?'A finance operator must review these accounts before merging.':'这份档案含账户或账目，请由有账户处理权限的负责人核对合并。',
    balance:en?'Balance':'余额', lessons:en?'Lesson balance':'剩余课时',
    conflicts:en?'Review these conflicts first':'先核对以下冲突', accountConflict:en?'Both profiles have different sign-in accounts.':'两份档案绑定了不同的登录账号。',
    unsupported:en?'Some associated records need a dedicated review.':'部分关联记录需要专门核对。', overlap:en?'Overlapping records':'存在重叠记录',
    reason:en?'Reason for merging':'合并说明', reasonHint:en?'How did you confirm these profiles belong to the same child?':'填写确认为同一孩子的依据',
    confirmIdentity:en?'I checked that both profiles belong to the same child and reviewed the associated records.':'已核对两份档案属于同一孩子，并确认关联记录。',
    confirm:en?'Confirm merge':'确认合并', cancel:en?'Cancel':'取消', reload:en?'Reload preview':'重新读取预览', chooseOther:en?'Choose another profile':'选择其他档案',
    history:en?'Merge history':'合并记录', original:en?'Original profile details':'原档案资料', done:en?'Profiles merged':'档案已合并',
  };
}
