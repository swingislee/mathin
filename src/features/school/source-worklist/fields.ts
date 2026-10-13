import { studentStageTableFields } from '../student-stage-table-fields';
import type { DashboardFieldDefinitions } from '../dashboard-page/dashboard-table-field-contract';
import { workMessages, type WorkRow, type WorkTask } from './contract';

export const WORKLIST_COLUMNS = {
  name: ['name', 'grade'], phone: ['phone'], owner: ['owner', 'group', 'scope'],
  state: ['detail', 'sourceReview', 'sourceArrangement'], context: ['context'],
  recent: ['note', 'lastContactAt', 'nextContactAt'],
} as const;

export function worklistFields(locale: string, stage: WorkTask, currentUserId: string): DashboardFieldDefinitions<WorkRow> {
  const base = studentStageTableFields(locale, stage, currentUserId), m = workMessages(locale);
  const common = Object.fromEntries(Object.entries(base).filter(([id]) =>
    ['name','phone','grade','owner','group','scope','detail','note','lastContactAt','sourceReview','sourceArrangement'].includes(id)));
  return {
    ...common,
    note: { kind: 'text', label: m.recent, value: row => row.communication?.latestNote ?? row.note, sortable: false },
    context: { kind: 'text', label: m.contextByTask[stage], value: row => row.worklist.context.map(item => item.value).join('\n'), sortable: false },
    nextContactAt: { kind: 'date', label: m.nextContact, value: row => row.nextContactAt },
  };
}
