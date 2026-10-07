import { z } from 'zod';
import type { StudentStageRow } from '../student-stage-contract';

export const COMMUNICATION_STAGES = ['awaiting_assessment','awaiting_enrollment','former_student'] as const;
export type WorkTask = typeof COMMUNICATION_STAGES[number] | 'awaiting_first_contact';
export const PERIOD_FIELDS = ['acquired','followed','confirmed','arrived','enrolled'] as const;
export type PeriodField = typeof PERIOD_FIELDS[number] | '';
export const taskPeriodFields = (stage: WorkTask): PeriodField[] => stage === 'former_student' ? [] : stage === 'awaiting_enrollment' ? ['arrived','confirmed','enrolled'] : ['acquired','followed','confirmed'];
export const markerSchema = z.object({ key: z.string(), label: z.string(), color: z.enum(['yellow','lime','green','purple','blue']), field: z.string().optional() });
export const placementSchema = z.object({ id: z.string(), kind: z.enum(['acquisition','assessment','service']).nullable().optional(), group: z.string(), subgroup: z.string(), groupKey: z.string(), rank: z.number(),
  period: z.string(), periods: z.record(z.string(), z.string().nullable()),
  markers: z.array(markerSchema), context: z.array(z.object({ label: z.string(), value: z.string() })) });
export type WorkRow = StudentStageRow & { worklist: z.infer<typeof placementSchema> };
export type SourcePlacement = WorkRow['worklist'];
export const sourceLayoutSchema = z.object({
  periodField: z.union([z.enum(PERIOD_FIELDS),z.literal('')]), period: z.string(), group: z.string(),
  periods: z.array(z.object({ key: z.string(), count: z.number() })),
  groups: z.array(z.object({ key: z.string(), count: z.number() })),
});
export type SourceLayout = z.infer<typeof sourceLayoutSchema>;
export function sourceGroupLabels(kind: SourcePlacement['kind'], locale: string) {
  const en = locale.startsWith('en');
  return kind === 'service' ? { group: en ? 'Teacher' : '授课老师', subgroup: en ? 'Class' : '班序' }
    : kind === 'assessment' ? { group: en ? 'Support teacher' : '学服老师', subgroup: '' }
    : { group: en ? 'Group' : '小组', subgroup: en ? 'Contact person' : '确认 / 跟进人员' };
}
export function sourceGroupPath(placement: SourcePlacement, allMonths: boolean, locale: string) {
  const labels = sourceGroupLabels(placement.kind, locale);
  const month = placement.period === 'unknown' ? (locale.startsWith('en') ? 'Month not recorded' : '月份未填') : placement.period;
  return [
    ...(allMonths ? [{ key: `month:${placement.period}`, label: month }] : []),
    { key: JSON.stringify(['group',placement.period,placement.group]), label: `${labels.group} · ${placement.group}` },
    ...(placement.subgroup ? [{ key: JSON.stringify(['person',placement.period,placement.group,placement.subgroup]), label: `${labels.subgroup} · ${placement.subgroup}` }] : []),
  ];
}
export interface WorkQuery { stage: WorkTask; scope: 'all' | 'mine' | 'group' | 'unassigned'; q: string; group: string; marker: string; periodField: PeriodField; period: string; page: number; pageSize: 20 | 50 | 100; lead: string; students: string }
export interface WorkPage { rows: WorkRow[]; count: number; page: number; pageSize: 20 | 50 | 100; totalPages: number;
  periodField: PeriodField; period: string; group: string; periods: Array<{ key: string; count: number }>;
  groups: Array<{ key: string; count: number; subgroups: Array<{ key: string; count: number }> }>; markers: Array<z.infer<typeof markerSchema> & { count: number }>;
  counts: Record<WorkTask | 'awaiting_renewal', number> }
export const href = (query: WorkQuery, change: Partial<WorkQuery> = {}) => {
  const next = { ...query, ...change };
  const params = new URLSearchParams(Object.entries(next).filter(([,v]) => v !== '').map(([k,v]) => [k,String(v)]));
  return (next.stage === 'awaiting_first_contact' ? '/dashboard/leads' : '/dashboard/communication') + '?' + params;
};
export function parseWorkQuery(raw: Record<string, string | string[] | undefined>, canViewAll: boolean, firstContact = false): WorkQuery {
  const pick = (k: string) => typeof raw[k] === 'string' ? raw[k] : '';
  const legacy: Record<string,string> = { assessment: 'awaiting_enrollment', service: 'former_student' };
  const requested = pick('stage') || legacy[pick('task')] || 'awaiting_assessment';
  const stage: WorkTask = firstContact ? 'awaiting_first_contact' : COMMUNICATION_STAGES.includes(requested as typeof COMMUNICATION_STAGES[number]) ? requested as WorkTask : 'awaiting_assessment';
  const scope = pick('scope');
  const periodField = taskPeriodFields(stage).includes(pick('periodField') as PeriodField) ? pick('periodField') as PeriodField : '';
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return { stage, scope: scope === 'mine' || scope === 'group' || scope === 'unassigned' ? scope : canViewAll ? 'all' : 'mine',
    q: pick('q').trim().slice(0,80), group: pick('group').replace(/^\d{1,2}月 \/ /, '').slice(0,320), marker: pick('marker').slice(0,80), periodField,
    period: /^(all|unknown|([1-9]|1[0-2])月)$/.test(pick('period')) ? pick('period') : '',
    page: Math.max(1,Math.min(1000000,Math.floor(Number(pick('page')) || 1))),
    pageSize: pick('pageSize') === '50' ? 50 : pick('pageSize') === '100' ? 100 : 20,
    lead: uuid.test(pick('lead')) ? pick('lead') : '', students: pick('students').split(',').filter(id => uuid.test(id)).slice(0,200).join(',') };
}
export function workMessages(locale: string) {
  return locale.startsWith('en') ? {
    title: 'Communication', tasks: { awaiting_first_contact: 'First contact', awaiting_assessment: 'Awaiting assessment', awaiting_enrollment: 'Awaiting enrollment', former_student: 'Former students' },
    allGroups: 'All groups', allMarkers: 'All classifications', sourceMarks: 'Classification', search: 'Name or phone', all: 'All visible', mine: 'My work',
    allPeriods: 'All months', unknownPeriod: 'Month not recorded', periodBasis: 'Month of', collapseAll: 'Collapse groups', expandAll: 'Expand groups',
    periods: { acquired: 'Acquisition', followed: 'Follow-up', confirmed: 'Confirmation', arrived: 'Visit', enrolled: 'Enrollment', '': '' },
    groupByTask: { awaiting_first_contact: 'Group', awaiting_assessment: 'Group', awaiting_enrollment: 'Group / support teacher', former_student: 'Group / teacher' },
    subgroupByTask: { awaiting_first_contact: 'Contact person', awaiting_assessment: 'Contact person', awaiting_enrollment: 'Contact person', former_student: 'Class' },
    name: 'Student', stage: 'Progress', context: 'Context', recent: 'Latest communication / next step', phone: 'Phone', work: 'Record', open: 'Student overview',
    contactCount: (count: number) => `${count} contact records`, noContactNote: 'No note recorded', unknownOutcome: 'Outcome not recorded', nextContact: 'Next contact',
    contactOutcomes: { connected: 'Connected', unreachable: 'Unreachable', declined: 'Contact later', invalid_number: 'Invalid number' },
    contextByTask: { awaiting_first_contact: 'Context', awaiting_assessment: 'Earlier conversations', awaiting_enrollment: 'Learning / family expectations', former_student: 'Course / schedule' },
    recordByTask: { awaiting_first_contact: 'Record first contact', awaiting_assessment: 'Record communication', awaiting_enrollment: 'Record communication', former_student: 'Record communication' },
    resume: 'Continue where I left off', refresh: 'Refresh list', handled: 'Handled this session', empty: 'No students in this stage', expand: 'Expand group', collapse: 'Collapse group',
    sourceOrder: 'Grouped list order', clearSearch: 'Back to list', noNote: 'No note yet', noContext: 'No context recorded', assessment: 'Assessment record',
    source: 'Earlier records', recordNote: 'Add note', invitation: 'Arrange visit', enrollment: 'Enrollment / renewal', noWrite: 'Read only',
  } : {
    title: '沟通', tasks: { awaiting_first_contact: '待首联', awaiting_assessment: '待测评', awaiting_enrollment: '待报名', former_student: '已停课' },
    allGroups: '全部分组', allMarkers: '全部分类', sourceMarks: '分类', search: '姓名或电话', all: '全部可见', mine: '与我相关',
    allPeriods: '全部月份', unknownPeriod: '月份未填', periodBasis: '月份依据', collapseAll: '收起分组', expandAll: '展开分组',
    periods: { acquired: '获取月份', followed: '跟进月份', confirmed: '确认月份', arrived: '到访月份', enrolled: '报名月份', '': '' },
    groupByTask: { awaiting_first_contact: '小组', awaiting_assessment: '小组', awaiting_enrollment: '小组 / 学服老师', former_student: '小组 / 授课老师' },
    subgroupByTask: { awaiting_first_contact: '确认 / 跟进人员', awaiting_assessment: '确认 / 跟进人员', awaiting_enrollment: '确认 / 跟进人员', former_student: '班序' },
    name: '学生', stage: '进展', context: '相关情况', recent: '最近沟通 / 下一步', phone: '联系电话', work: '登记', open: '学生全貌',
    contactCount: (count: number) => `${count} 条沟通记录`, noContactNote: '本次未填写备注', unknownOutcome: '结果未记录', nextContact: '下次联系',
    contactOutcomes: { connected: '已沟通', unreachable: '未接通', declined: '暂缓联系', invalid_number: '号码无效' },
    contextByTask: { awaiting_first_contact: '来源背景', awaiting_assessment: '前期沟通情况', awaiting_enrollment: '学情 / 家长期待', former_student: '课程 / 上课安排' },
    recordByTask: { awaiting_first_contact: '首联登记', awaiting_assessment: '记沟通', awaiting_enrollment: '记沟通', former_student: '记沟通' },
    resume: '继续上次位置', refresh: '刷新名单', handled: '本轮已处理', empty: '当前阶段暂无学生', expand: '展开分组', collapse: '收起分组',
    sourceOrder: '按分组顺序接续', clearSearch: '返回名单', noNote: '暂无沟通记录', noContext: '暂无相关情况', assessment: '测评记录',
    source: '已有记录详情', recordNote: '记情况', invitation: '安排到访', enrollment: '报名 / 续报', noWrite: '只读',
  };
}
