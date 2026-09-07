import { businessRecordMessages } from './business-record-state-contract';
import { historicalAssessmentFeedback, relatedBusinessCommunications, uniqueBusinessFeedback } from './business-record-notes';
import type { HistoricalRenewal, StudentBusinessHistory } from './student-business-history-contract';
import { getStudentBusinessHistoryMessages } from './student-business-history-messages';
import type { Student360Event, Student360Fact, Student360FactLabel, Student360NoteLabel } from './student-360-contract';

/** 现有业务历史投影到同一条 360 时间线；同源沟通随所属业务显示一次。 */
export function studentBusinessHistoryEvents(data: StudentBusinessHistory | null, locale: string): Student360Event[] {
  if (!data) return [];
  const m = getStudentBusinessHistoryMessages(locale);
  const recordM = businessRecordMessages(locale);
  const events: Student360Event[] = [];
  const coveredCommunications = new Set<string>();
  const coveredRenewals = new Set<string>();
  const facts = (items: Array<[Student360FactLabel, string | number | null | undefined]>): Student360Fact[] => items
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
    .map(([label, value]) => ({ label, value: String(value) }));
  const notes = (label: Student360NoteLabel, content: string) => content ? [{ label, content }] : [];
  const period = (row: HistoricalRenewal) => row.period_label || [row.period_year, row.period_key === 'summer' ? m.summer : row.period_key === 'autumn' ? m.autumn : row.period_key].filter(Boolean).join(' ');
  const outcome = (row: HistoricalRenewal) => row.outcome === 'renewed' ? m.renewed : row.outcome === 'not_renewed' ? m.notRenewed : recordM.outcomeUnknown;

  for (const row of data.assessments) {
    for (const communication of relatedBusinessCommunications(data, row, 'assessment')) coveredCommunications.add(communication.id);
    events.push({ id: `historical-assessment:${row.id}`, phase: 'assessment', kind: 'assessment', recordState: 'historical',
      occurredAt: row.assessed_on, title: '', status: null, actorName: null, important: true,
      facts: facts([['band', row.assessment_band], ['score', row.score]]),
      notes: notes('assessment_summary', historicalAssessmentFeedback(row, data)), source: { kind: 'assessment_results', id: row.id } });
  }
  for (const row of data.activities) events.push({
    id: `historical-activity:${row.id}`, phase: 'experience', kind: 'activity', recordState: 'historical',
    occurredAt: row.occurred_on, title: row.activity_name, status: null, actorName: null, important: false,
    facts: facts([['registered_on', row.registered_on], ['activity_result', [row.reported_result, row.result_link_status === 'edition_unconfirmed' ? m.editionPending : ''].filter(Boolean).join(' · ')]]),
    notes: [], source: { kind: 'activity_registrations', id: row.id },
  });
  for (const row of data.enrollments) events.push({
    id: `historical-enrollment:${row.id}`, phase: 'enrollment', kind: 'course_enrollment', recordState: 'historical',
    occurredAt: row.registered_on, title: row.period_label, status: null, actorName: null, important: true,
    facts: facts([['amount', row.amount ?? row.amount_original], ['classroom', row.class_label], ['teacher', row.teacher_label], ['location', row.room_label], ['scheduled', row.schedule_label]]),
    notes: [], source: { kind: 'course_enrollments', id: row.id },
  });
  for (const row of data.communications.filter(row => row.context_kind === 'renewal')) {
    const renewals = data.renewals.filter(renewal => relatedBusinessCommunications(data, renewal, 'renewal').some(communication => communication.id === row.id));
    if (!renewals.length) continue;
    for (const renewal of renewals) coveredRenewals.add(renewal.id);
    coveredCommunications.add(row.id);
    const extraNotes = renewals.map(renewal => renewal.decision_note).filter(value => value.trim() && !row.content.includes(value.trim()));
    events.push({ id: `historical-renewal-contact:${row.id}`, phase: 'enrollment', kind: 'follow_up', recordState: 'historical',
      occurredAt: row.occurred_on, title: `${renewals.map(period).join(' / ')} · ${m.renewalContext}`, status: null, actorName: row.author_label, important: false,
      facts: facts(renewals.map(renewal => ['renewal_result', `${period(renewal)} · ${outcome(renewal)}`])),
      notes: notes('follow_up', uniqueBusinessFeedback(row.content, ...extraNotes)), source: { kind: 'student_follow_ups', id: row.id } });
  }
  for (const row of data.renewals.filter(row => !coveredRenewals.has(row.id))) events.push({
    id: `historical-renewal:${row.id}`, phase: 'enrollment', kind: 'follow_up', recordState: 'historical',
    occurredAt: null, title: `${period(row)} · ${m.renewalContext}`, status: null, actorName: null, important: false,
    facts: facts([['renewal_result', outcome(row)], ['classroom', row.class_label], ['teacher', row.teacher_label]]),
    notes: notes('follow_up', uniqueBusinessFeedback(row.decision_note)), source: { kind: 'course_opportunities', id: row.id },
  });
  for (const row of data.communications.filter(row => !coveredCommunications.has(row.id))) events.push({
    id: `historical-follow-up:${row.id}`, phase: row.context_kind === 'assessment' ? 'assessment' : row.context_kind === 'renewal' ? 'enrollment' : 'contact', kind: 'follow_up', recordState: 'historical',
    occurredAt: row.occurred_on, title: row.context_kind === 'assessment' ? m.assessmentContext : row.context_kind === 'renewal' ? m.renewalContext : '',
    status: null, actorName: row.author_label, important: false, facts: [],
    notes: notes('follow_up', uniqueBusinessFeedback(row.content)), source: { kind: 'student_follow_ups', id: row.id },
  });
  return events;
}
