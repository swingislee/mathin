import { z } from 'zod';
import type { StudentStageRow } from '../student-stage-contract';

export const TASKS = ['first_contact', 'followup', 'assessment', 'service'] as const;
export type WorkTask = typeof TASKS[number];
export const markerSchema = z.object({ key: z.string(), label: z.string(), color: z.enum(['yellow','lime','green','purple','blue']), field: z.string().optional() });
export const placementSchema = z.object({ id: z.string(), group: z.string(), subgroup: z.string(), groupKey: z.string(), rank: z.number(),
  markers: z.array(markerSchema), context: z.array(z.object({ label: z.string(), value: z.string() })) });
export type WorkRow = StudentStageRow & { worklist: z.infer<typeof placementSchema> };
export interface WorkQuery { task: WorkTask; scope: 'all' | 'mine' | 'group' | 'unassigned'; q: string; group: string; marker: string; page: number; pageSize: 20 | 50 | 100 }
export interface WorkPage { rows: WorkRow[]; count: number; page: number; pageSize: 20 | 50 | 100; totalPages: number;
  groups: Array<{ key: string; count: number }>; markers: Array<z.infer<typeof markerSchema> & { count: number }>;
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
  return { task: TASKS.includes(task) ? task : 'followup', scope: scope === 'mine' || scope === 'group' || scope === 'unassigned' ? scope : canViewAll ? 'all' : 'mine',
    q: pick('q').trim().slice(0,80), group: pick('group').slice(0,320), marker: pick('marker').slice(0,80),
    page: Math.max(1,Math.min(1000000,Math.floor(Number(pick('page')) || 1))),
    pageSize: pick('pageSize') === '20' ? 20 : pick('pageSize') === '100' ? 100 : 50 };
}
export function workMessages(locale: string) {
  return locale.startsWith('en') ? {
    title: 'Working lists', tasks: { first_contact: 'First contact', followup: 'Follow-up', assessment: 'Assessment', service: 'Enrolled support' },
    allGroups: 'All groups', allMarkers: 'All classifications', sourceMarks: 'Source classifications', search: 'Name or phone', all: 'All visible', mine: 'My work',
    name: 'Student', stage: 'Current stage', context: 'Context', recent: 'Latest note / next step', phone: 'Phone', work: 'Record', open: 'Student overview',
    contextByTask: { first_contact: 'Source context', followup: 'Earlier conversations', assessment: 'Learning / family expectations', service: 'Course / schedule' },
    recordByTask: { first_contact: 'Record first contact', followup: 'Record follow-up', assessment: 'Add learning notes', service: 'Add support notes' },
    resume: 'Continue where I left off', refresh: 'Refresh list', handled: 'Handled this session', empty: 'No students in this list', expand: 'Expand group', collapse: 'Collapse group',
    sourceOrder: 'Original list order', clearSearch: 'Back to list', noNote: 'No note yet', noContext: 'No source context', assessment: 'Assessment record',
    source: 'Source context', recordNote: 'Add note', invitation: 'Arrange visit', enrollment: 'Enrollment / renewal', noWrite: 'Read only',
  } : {
    title: '工作名单', tasks: { first_contact: '首联', followup: '后续沟通', assessment: '测评', service: '报后服务' },
    allGroups: '全部分组', allMarkers: '全部分类', sourceMarks: '来源分类', search: '姓名或电话', all: '全部可见', mine: '与我相关',
    name: '学生', stage: '当前阶段', context: '相关情况', recent: '最近记录 / 下一步', phone: '联系电话', work: '登记', open: '学生全貌',
    contextByTask: { first_contact: '来源背景', followup: '前期沟通情况', assessment: '学情 / 家长期待', service: '课程 / 上课安排' },
    recordByTask: { first_contact: '首联登记', followup: '记沟通', assessment: '补记学情', service: '记服务情况' },
    resume: '继续上次位置', refresh: '刷新名单', handled: '本轮已处理', empty: '当前名单暂无学生', expand: '展开分组', collapse: '收起分组',
    sourceOrder: '沿用原名单顺序', clearSearch: '返回名单', noNote: '暂无沟通记录', noContext: '暂无来源背景', assessment: '测评记录',
    source: '来源情况', recordNote: '记情况', invitation: '安排到访', enrollment: '报名 / 续报', noWrite: '只读',
  };
}
