import type { StatusEvidence } from './contract';

export const communicationFactLabels: Record<string, [string, string]> = {
  'contact_conflict:result_and_note': ['联系结果与备注待核对', 'Contact result and note need review'],
  'invitation_progress:coordinating': ['待重新约时间', 'Time to rearrange'],
  'invitation_progress:awaiting_parent': ['待家长确认', 'Awaiting parent confirmation'],
  'invitation_progress:awaiting_teacher': ['待老师确认', 'Awaiting teacher confirmation'],
  'invitation_progress:booked': ['曾约到访／测评', 'Visit / assessment agreed'],
  'followup_progress:callback_requested': ['约定回拨', 'Callback requested'],
  'followup_progress:deferred': ['延后联系', 'Contact deferred'],
  'enrollment_progress:considering': ['考虑／商量中', 'Considering / discussing'],
  'enrollment_progress:ready_to_enroll': ['表达报名意愿', 'Intends to enroll'],
  'enrollment_progress:payment_pending': ['待付款', 'Payment pending'],
  'enrollment_progress:not_enrolling': ['表达暂不报名', 'Not enrolling at that time'],
  'enrollment_report:reported': ['报名／缴费待核实', 'Reported enrollment / payment'],
  'concern:cost': ['费用顾虑', 'Cost concern'],
  'concern:distance': ['距离／接送问题', 'Travel / transport concern'],
  'concern:schedule': ['时间冲突', 'Scheduling concern'],
  'concern:family_decision': ['家庭商量／孩子意愿', 'Family / child decision'],
  'concern:other_provider': ['已有其他机构课程', 'Another provider mentioned'],
};

export function communicationFactRows(facts: StatusEvidence[]) {
  return facts.filter(fact => `${fact.type}:${fact.value}` in communicationFactLabels)
    .filter((fact, index, all) => all.findIndex(other => other.type === fact.type && other.value === fact.value
      && other.excerpt === fact.excerpt && other.date === fact.date) === index)
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

export function communicationFactTags(facts: StatusEvidence[]) {
  return [...new Set(communicationFactRows(facts).map(fact => `${fact.type}:${fact.value}`))];
}
