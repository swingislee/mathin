import { z } from 'zod';
import type { StudentStageRow } from '../student-stage-contract';

export const TASKS = ['first_contact', 'followup', 'assessment', 'service'] as const;
export type WorkTask = typeof TASKS[number];
export const PERIOD_FIELDS = ['acquired','followed','confirmed','arrived','enrolled'] as const;
export type PeriodField = typeof PERIOD_FIELDS[number] | '';
export const taskPeriodFields = (task: WorkTask): PeriodField[] => task === 'service' ? [] : task === 'assessment' ? ['arrived','confirmed','enrolled'] : ['acquired','followed','confirmed'];
export const markerSchema = z.object({ key: z.string(), label: z.string(), color: z.enum(['yellow','lime','green','purple','blue']), field: z.string().optional() });
export const placementSchema = z.object({ id: z.string(), group: z.string(), subgroup: z.string(), groupKey: z.string(), rank: z.number(),
  period: z.string(), periods: z.record(z.string(), z.string().nullable()),
  markers: z.array(markerSchema), context: z.array(z.object({ label: z.string(), value: z.string() })) });
export type WorkRow = StudentStageRow & { worklist: z.infer<typeof placementSchema> };
export interface WorkQuery { task: WorkTask; scope: 'all' | 'mine' | 'group' | 'unassigned'; q: string; group: string; marker: string; periodField: PeriodField; period: string; page: number; pageSize: 20 | 50 | 100 }
export interface WorkPage { rows: WorkRow[]; count: number; page: number; pageSize: 20 | 50 | 100; totalPages: number;
  periodField: PeriodField; period: string; group: string; periods: Array<{ key: string; count: number }>;
  groups: Array<{ key: string; count: number; subgroups: Array<{ key: string; count: number }> }>; markers: Array<z.infer<typeof markerSchema> & { count: number }>;
  counts: Record<WorkTask, number> }
export const href = (query: WorkQuery, change: Partial<WorkQuery> = {}) => {
  const next = { ...query, ...change };
  const params = new URLSearchParams(Object.entries(next).filter(([,v]) => v !== '').map(([k,v]) => [k,String(v)]));
  return `/dashboard/communication/lists?${params}`;
};
export function parseWorkQuery(raw: Record<string, string | string[] | undefined>, canViewAll: boolean): WorkQuery {
  const pick = (k: string) => typeof raw[k] === 'string' ? raw[k] : '';
  const task = pick('task') as WorkTask;
  const scope = pick('scope');
  const resolvedTask = TASKS.includes(task) ? task : 'followup';
  const periodField = taskPeriodFields(resolvedTask).includes(pick('periodField') as PeriodField) ? pick('periodField') as PeriodField : '';
  return { task: TASKS.includes(task) ? task : 'followup', scope: scope === 'mine' || scope === 'group' || scope === 'unassigned' ? scope : canViewAll ? 'all' : 'mine',
    q: pick('q').trim().slice(0,80), group: (resolvedTask === 'assessment' ? pick('group').replace(/^\d{1,2}月 \/ /, '') : pick('group')).slice(0,320), marker: pick('marker').slice(0,80), periodField,
    period: /^(all|unknown|([1-9]|1[0-2])月)$/.test(pick('period')) ? pick('period') : '',
    page: Math.max(1,Math.min(1000000,Math.floor(Number(pick('page')) || 1))),
    pageSize: pick('pageSize') === '50' ? 50 : pick('pageSize') === '100' ? 100 : 20 };
}
export function workMessages(locale: string) {
  return locale.startsWith('en') ? {
    title: 'Working lists', tasks: { first_contact: 'First contact', followup: 'Follow-up', assessment: 'Assessment', service: 'Enrolled support' },
    allGroups: 'All groups', allMarkers: 'All classifications', sourceMarks: 'Source classifications', search: 'Name or phone', all: 'All visible', mine: 'My work',
    allPeriods: 'All months', unknownPeriod: 'Month not recorded', periodBasis: 'Month of', collapseAll: 'Collapse groups', expandAll: 'Expand groups',
    periods: { acquired: 'Acquisition', followed: 'Follow-up', confirmed: 'Confirmation', arrived: 'Visit', enrolled: 'Enrollment', '': '' },
    groupByTask: { first_contact: 'Acquisition group', followup: 'Acquisition group', assessment: 'Support teacher', service: 'Subject teacher' },
    subgroupByTask: { first_contact: 'Contact person', followup: 'Contact person', assessment: '', service: 'Class' },
    name: 'Student', stage: 'Current stage', context: 'Context', recent: 'Latest note / next step', phone: 'Phone', work: 'Record', open: 'Student overview',
    contextByTask: { first_contact: 'Source context', followup: 'Earlier conversations', assessment: 'Learning / family expectations', service: 'Course / schedule' },
    recordByTask: { first_contact: 'Record first contact', followup: 'Record follow-up', assessment: 'Add learning notes', service: 'Add support notes' },
    resume: 'Continue where I left off', refresh: 'Refresh list', handled: 'Handled this session', empty: 'No students in this list', expand: 'Expand group', collapse: 'Collapse group',
    sourceOrder: 'Original list order', clearSearch: 'Back to list', noNote: 'No note yet', noContext: 'No source context', assessment: 'Assessment record',
    source: 'Source context', recordNote: 'Add note', invitation: 'Arrange visit', enrollment: 'Enrollment / renewal', noWrite: 'Read only',
  } : {
    title: '工作名单', tasks: { first_contact: '首联', followup: '后续沟通', assessment: '测评', service: '报后服务' },
    allGroups: '全部分组', allMarkers: '全部分类', sourceMarks: '来源分类', search: '姓名或电话', all: '全部可见', mine: '与我相关',
    allPeriods: '全部月份', unknownPeriod: '月份未填', periodBasis: '月份依据', collapseAll: '收起分组', expandAll: '展开分组',
    periods: { acquired: '获取月份', followed: '跟进月份', confirmed: '确认月份', arrived: '到访月份', enrolled: '报名月份', '': '' },
    groupByTask: { first_contact: '获客小组', followup: '获客小组', assessment: '学服老师', service: '授课老师' },
    subgroupByTask: { first_contact: '确认 / 跟进人员', followup: '确认 / 跟进人员', assessment: '', service: '班序' },
    name: '学生', stage: '当前阶段', context: '相关情况', recent: '最近记录 / 下一步', phone: '联系电话', work: '登记', open: '学生全貌',
    contextByTask: { first_contact: '来源背景', followup: '前期沟通情况', assessment: '学情 / 家长期待', service: '课程 / 上课安排' },
    recordByTask: { first_contact: '首联登记', followup: '记沟通', assessment: '补记学情', service: '记服务情况' },
    resume: '继续上次位置', refresh: '刷新名单', handled: '本轮已处理', empty: '当前名单暂无学生', expand: '展开分组', collapse: '收起分组',
    sourceOrder: '沿用原名单顺序', clearSearch: '返回名单', noNote: '暂无沟通记录', noContext: '暂无来源背景', assessment: '测评记录',
    source: '来源情况', recordNote: '记情况', invitation: '安排到访', enrollment: '报名 / 续报', noWrite: '只读',
  };
}
