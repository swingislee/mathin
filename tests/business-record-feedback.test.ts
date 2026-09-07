import { describe, expect, it, vi } from 'vitest';
import { createElement, type ComponentProps, type ComponentType, type PropsWithChildren } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { BusinessHistorySections } from '@/features/school/BusinessHistorySections';
import { historicalAssessmentFeedback, relatedBusinessCommunications, uniqueBusinessFeedback } from '@/features/school/business-record-notes';
import { studentBusinessHistoryEvents, mergeStudentBusinessEvents } from '@/features/school/student-business-history-timeline';
import { sortStudent360Events, summarizeStudent360Phases } from '@/features/school/student-360-contract';
import type { StudentBusinessHistory } from '@/features/school/student-business-history-contract';
import { loadHistoricalFirstContactRows } from '@/features/school/historical-first-contact-data';
const IntlProvider=NextIntlClientProvider as ComponentType<PropsWithChildren<Omit<ComponentProps<typeof NextIntlClientProvider>,'children'>>>;

const db = vi.hoisted(() => ({ history: null as StudentBusinessHistory | null }));
vi.mock('server-only', () => ({}));
vi.mock('@/i18n/navigation', () => ({ Link: ({children,...props}:ComponentProps<'a'>) => createElement('a',props,children) }));
vi.mock('@/features/school/student-business-history-data', () => ({ loadStudentBusinessHistory: async () => db.history }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }) }) }));

function history(): StudentBusinessHistory {
  const source = { student_id: 'student', source_record_id: 'assessment-source', source_field_ids: ['learning', 'parent'] };
  const renewalSource = { ...source, source_record_id: 'renewal-source', source_field_ids: ['renewal-note'] };
  return {
    assessments: [{ ...source, id: 'assessment', activity_registration_id: 'assessment-registration', assessed_on: '2025-12-29',
      assessment_band: 'A+', score: null, learning_notes: '计算准确\n理解能力好', parent_notes: '计算准确\n家长转介绍' }],
    renewals: ['summer', 'autumn'].map((period, index) => ({ ...renewalSource, id: `renewal-${period}`, period_year: 2026, period_key: period,
      decision_note: index ? '秋季暂未报名' : '暑期出游', outcome: 'unknown', class_label: 'A班', teacher_label: '老师' })),
    activities: [{ ...source, id: 'activity-registration', activity_id: 'activity', activity_name: '竞赛', activity_kind: 'competition',
      registered_on: '2026-03-15', occurred_on: null, participation_status: 'registered', reported_result: '银奖', result_link_status: 'edition_unconfirmed',
      result_source_record_id: 'renewal-source', result_field_ids: ['renewal-note'] }],
    enrollments: ['寒假', '春季'].map((period, index) => ({ ...source, id: `enrollment-${index}`, course_enrollment_id: `enrollment-${index}`,
      registered_on: '2025-12-29', period_label: period, amount: (index + 1) * 1200, amount_original: String((index + 1) * 1200),
      class_label: 'A班', teacher_label: '老师', room_label: '教室', schedule_label: '周六上午' })),
    communications: [
      { ...source, id: 'assessment-contact', occurred_on: null, context_kind: 'assessment', content: '计算准确\n\n理解能力好\n\n家长转介绍', author_label: null },
      { ...renewalSource, id: 'renewal-contact', occurred_on: null, context_kind: 'renewal', content: '暑期出游，秋季暂未报名。\n下个学期再联系。', author_label: null },
    ],
    students: { student: '样例学生' }, subjects: { student: { name: '样例学生', phone: '', grade: 3 } }, sources: {},
  };
}

describe('historical feedback ownership and Student 360', () => {
  it('shows a source assessment once after it becomes an active business record',()=>{
    const original=studentBusinessHistoryEvents(history(),'zh').find(event=>event.kind==='assessment')!;
    const current={...original,id:'assessment:assessment',recordState:'current' as const,actorName:'测评老师',source:{kind:'assessment_result',id:'assessment'}};
    const events=mergeStudentBusinessEvents([current],[original]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({id:'assessment:assessment',actorName:'测评老师',occurredAt:'2025-12-29'});
  });
  it('keeps each feedback line once without mutating the source records', () => {
    const data = history();
    const original = JSON.stringify(data);
    expect(uniqueBusinessFeedback('  同一反馈\r\n第二句', '同一反馈\n第三句')).toBe('同一反馈\n第二句\n第三句');
    expect(historicalAssessmentFeedback(data.assessments[0], data)).toBe('计算准确\n理解能力好\n家长转介绍');
    expect(JSON.stringify(data)).toBe(original);
  });

  it('only merges notes when student, source record, business context and source fields agree', () => {
    const data = history();
    data.communications.push(...[
      { student_id: 'another-student' }, { source_record_id: 'another-source' }, { source_field_ids: ['another-field'] }, { context_kind: 'renewal' },
    ].map((overrides, index) => ({ ...data.communications[0], ...overrides, id: `independent-${index}` })));
    expect(relatedBusinessCommunications(data, data.assessments[0], 'assessment').map(row => row.id)).toEqual(['assessment-contact']);
  });

  it('uses revised feedback in both the business record and 360 without restoring the original source copy', () => {
    const data = history();
    data.assessments[0] = { ...data.assessments[0], history_revision: 1, learning_notes: '修订后的反馈', parent_notes: '' };
    expect(historicalAssessmentFeedback(data.assessments[0], data)).toBe('修订后的反馈');
    const event = studentBusinessHistoryEvents(data, 'zh').find(event => event.kind === 'assessment');
    expect(event?.notes.map(note => note.content)).toEqual(['修订后的反馈']);
    expect(data.communications[0].content).toContain('计算准确');
  });

  it('opens the owning assessment editor from the communication archive and displays its revised feedback', () => {
    const data = history();
    data.assessments[0] = {...data.assessments[0], history_revision:1, learning_notes:'统一修订反馈', parent_notes:''};
    const markup = renderToStaticMarkup(createElement(IntlProvider,{locale:'zh',timeZone:'Asia/Shanghai',messages:{}},
      createElement(BusinessHistorySections,{data,locale:'zh',kind:'communication'})));
    expect(markup).toContain('统一修订反馈');
    expect(markup).not.toContain('计算准确');
    expect(markup.match(/data-business-revision="assessment"/g)).toHaveLength(1);
    expect(markup.match(/data-business-revision="communication"/g)).toHaveLength(1);
  });

  it('shows all existing history in one timeline, with one assessment feedback and one renewal conversation', () => {
    const events = studentBusinessHistoryEvents(history(), 'zh');
    expect(events).toHaveLength(5);
    expect(events.filter(event => event.kind === 'course_enrollment')).toHaveLength(2);
    expect(events.every(event => event.recordState === 'historical')).toBe(true);
    const feedback = events.flatMap(event => event.notes.map(note => note.content)).join('\n');
    expect(feedback.match(/计算准确/g)).toHaveLength(1);
    expect(feedback.match(/下个学期再联系/g)).toHaveLength(1);
    expect(events.find(event => event.kind === 'assessment')?.facts).toContainEqual({ label: 'band', value: 'A+' });
    expect(events.flatMap(event => event.facts)).toContainEqual({ label: 'amount', value: '2400' });
    expect(events.find(event => event.source.id === 'renewal-contact')?.facts).toHaveLength(2);
  });

  it('retains unknown event dates and keeps registration dates separate from event dates', () => {
    const events = sortStudent360Events(studentBusinessHistoryEvents(history(), 'en'));
    expect(events.slice(0, 3).every(event => event.occurredAt === '2025-12-29')).toBe(true);
    expect(events.slice(3).every(event => event.occurredAt === null)).toBe(true);
    expect(events.find(event => event.kind === 'activity')?.facts).toContainEqual({ label: 'registered_on', value: '2026-03-15' });
    expect(summarizeStudent360Phases(events).find(phase => phase.phase === 'experience')).toEqual({ phase: 'experience', count: 1, latestAt: null });
  });

  it('returns a missing first-contact row without copying assessment or renewal notes into it', async () => {
    db.history = history();
    expect(await loadHistoricalFirstContactRows('zh', '样例学生')).toEqual([{ studentId: 'student', name: '样例学生', phone: '', grade: 3, context: '' }]);
    expect(await loadHistoricalFirstContactRows('zh', '计算准确')).toEqual([]);
  });
});
