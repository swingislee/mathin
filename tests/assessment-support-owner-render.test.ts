import { createElement, type ComponentProps, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import zh from '../messages/zh.json';
import en from '../messages/en.json';
import { AssessmentUnifiedWorkbench } from '@/features/school/AssessmentUnifiedWorkbench';
import { TeacherAssessmentWorkbench } from '@/features/school/TeacherAssessmentWorkbench';
import type { AssessmentWorkbenchRow } from '@/features/school/assessment-workbench-contract';
import { assessmentWorkflowFromDb, type AssessmentReport } from '@/features/school/assessment-workflow-contract';
import { assessmentStatusMessages } from '@/features/school/assessment-status-contract';
import { sourceCompletionMessages } from '@/features/school/source-completion-contract';

// 补入流程有独立合同测试；这些用例继续覆盖原工作表交互。
vi.mock("@/features/school/SchoolSupportEntry", () => ({ SchoolSupportAddButton: () => null }));
vi.mock("@/features/school/SchoolSupportPendingRows", () => ({ SchoolSupportPendingRows: () => null }));
vi.mock('server-only', () => ({}));
vi.mock('@/features/school/Student360Sheet', () => ({ Student360Trigger: ({ children }: { children: ReactNode }) => createElement('button', null, children) }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...props }: ComponentProps<'a'>) => createElement('a', props, children),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => '/dashboard/followups/assessments',
}));
const id = 'abcdef01-2345-abcd-cdef-0123456789ab';
const row: AssessmentWorkbenchRow = {
  id: `registration:${id}`, assessmentKind: 'one_to_one', activityId: id, activityTitle: '测评', publicClassRecord: null,
  invitationId: null, registrationId: id, studentId: null, leadId: id, name: '来源学生', phone: '', grade: null, gradeText: '',
  scheduledAt: '', location: '', assessorId: null, assessorName: '测评甲', assessorSource: 'assigned',
  supportOwnerId: null, supportOwnerName: '学服乙', background: '', participationStatus: 'booked',
  assessmentStartedAt: null, assessmentCompletedAt: null, assessment: null, questionSummary: null, route: null, updatedAt: '',
};
const render = (children: ReactNode, locale: 'zh' | 'en') => {
  const provider: ComponentProps<typeof NextIntlClientProvider> = {
    locale, messages: locale === 'zh' ? zh : en, timeZone: 'Asia/Shanghai', children,
  };
  return renderToStaticMarkup(createElement(NextIntlClientProvider, provider));
};

describe('imported assessment rendering', () => {
  it.each(['zh', 'en'] as const)('renders the support name before the room with status and type together in %s', locale => {
    const html = render(createElement(AssessmentUnifiedWorkbench, { initialRows: [{ ...row, location: '教室丙' }], assessors: [], locale, canAssess: true,
      canSupport: true, canManageAssessor: false }), locale);
    const cell = html.match(/<div[^>]*data-assessment-support-owner[^>]*>([\s\S]*?)<\/div>/)?.[1];
    expect(cell).toContain('学服乙');
    const visible = cell?.replace(/<[^>]*>/g, '');
    expect(visible).not.toContain(locale === 'zh' ? '学服老师' : 'Responsible support teacher');
    expect(visible).toBe('学服乙·教室丙');
    expect(cell).not.toContain('测评甲');
    const state = html.match(/<td[^>]*data-assessment-state-kind[^>]*>([\s\S]*?)<\/td>/)?.[1];
    expect(state).not.toContain((locale === 'zh' ? zh : en).school.supportAssessment.type_one_to_one);
    expect(state).toContain((locale === 'zh' ? zh : en).school.supportAssessment.stageAssessmentPending);
    const work = html.match(/<td[^>]*data-assessment-current-work[^>]*>([\s\S]*?)<\/td>/)?.[1];
    expect(work).toContain('测评甲');
    expect(work).toContain('lucide-calendar-clock');
    expect(work).not.toContain('学服乙');
    expect(work).not.toContain((locale === 'zh' ? zh : en).school.supportAssessment.stageAssessmentPending);
  });
  it.each(['zh', 'en'] as const)('keeps 1v1 records and displays activity type labels in %s', locale => {
    const html = render(createElement(AssessmentUnifiedWorkbench, {
      initialRows: [row, { ...row, id: 'activity-assessment', assessmentKind: 'activity' }], assessors: [], locale,
      canAssess: true, canSupport: true, canManageAssessor: false,
    }), locale);
    const states = [...html.matchAll(/<td[^>]*data-assessment-state-kind[^>]*>([\s\S]*?)<\/td>/g)].map(match => match[1]);
    expect(states).toHaveLength(2);
    expect(states[0]).not.toContain((locale === 'zh' ? zh : en).school.supportAssessment.type_one_to_one);
    expect(states[1]).toContain((locale === 'zh' ? zh : en).school.supportAssessment.type_activity);
    expect(html).toContain(`data-assessment-workbench-row="${row.id}"`);
  });
  it('uses a distinct execution icon and only marks an actual enrollment as successful', () => {
    const markup = (enrollmentId: string | null) => render(createElement(AssessmentUnifiedWorkbench, {
      initialRows: [{ ...row, assessorSource: 'actual', enrollmentId, route: { id: 'route', route: 'enrollment_pending', note: '', updatedAt: '' } }],
      assessors: [], locale: 'zh', canAssess: true, canSupport: true, canManageAssessor: false,
    }), 'zh');
    expect(markup(null)).toContain('data-followup-success="false"');
    expect(markup(id)).toContain('data-followup-success="true"');
    const work = markup(id).match(/<td[^>]*data-assessment-current-work[^>]*>([\s\S]*?)<\/td>/)?.[1];
    expect(work).toContain('lucide-user-check');
    expect(work).not.toContain('lucide-calendar-clock');
    expect(work).toContain(zh.school.supportAssessment.actualAssessor);
  });
  it('marks confirmed source enrollment on the whole row, including its fixed identity cell', () => {
    const html = render(createElement(AssessmentUnifiedWorkbench, {
      initialRows: [{ ...row, sourceEnrollmentFacts: { version: 1, confirmed: true, assessmentBand: 'a', registeredOn: null } }],
      assessors: [], locale: 'zh', canAssess: true, canSupport: true, canManageAssessor: false,
    }), 'zh');
    const enrolled = html.match(/<tr[^>]*data-followup-success="true"[^>]*>([\s\S]*?)<\/tr>/)?.[1];
    expect(enrolled?.match(/<td/g)).toHaveLength(7);
    expect(enrolled).toContain('sticky left-0');
    expect(enrolled).toContain('data-assessment-status="enrolled"');
    expect(enrolled).toContain('来源学生');
  });
  it.each(['zh', 'en'] as const)('keeps enrollment and red missing-details badges in the status column, not the identity column, in %s', locale => {
    const html = render(createElement(AssessmentUnifiedWorkbench, {
      initialRows: [{ ...row, sourceEnrollmentFacts: { version: 1, confirmed: true, assessmentBand: 'a', registeredOn: null },
        sourceCompletion: { enrolled: true, knownBand: 'a', missing: ['assessment_score', 'assessment_teacher'] } }],
      assessors: [], locale, canAssess: true, canSupport: true, canManageAssessor: false,
    }), locale);
    const main = html.match(/<tr[^>]*data-followup-success="true"[^>]*>([\s\S]*?)<\/tr>/)?.[1];
    const identity = main?.match(/<td[^>]*>([\s\S]*?)<\/td>/)?.[1];
    const status = main?.match(/<td[^>]*data-assessment-state-kind[^>]*>([\s\S]*?)<\/td>/)?.[1];
    const m = sourceCompletionMessages(locale);
    expect(identity).toContain('来源学生');
    expect(identity).not.toContain(m.enrolled);
    expect(identity).not.toContain(m.pending);
    expect(status).toContain(m.enrolled);
    expect(status).toContain(m.pending);
    expect(status).toContain(m.missing.assessment_score);
    expect(status).toContain(m.missing.assessment_teacher);
    expect(status?.match(/<span[^>]*data-assessment-missing-details[^>]*>/)?.[0]).toContain('text-rose');
  });
  it('removes the missing-details badge after all details are complete', () => {
    const html = render(createElement(AssessmentUnifiedWorkbench, {
      initialRows: [{ ...row, sourceCompletion: { enrolled: true, knownBand: 'a', missing: [] } }],
      assessors: [], locale: 'zh', canAssess: true, canSupport: true, canManageAssessor: false,
    }), 'zh');
    expect(html).not.toContain('data-assessment-missing-details');
  });
  it.each(['zh', 'en'] as const)('replaces broad row labels with the next action in the status column without a dot in %s', locale => {
    const time = '2026-09-07T03:00:00Z';
    const workflow = assessmentWorkflowFromDb({ id: '00000000-0000-4000-8000-000000000001', registration_id: id, stage: 'feedback', revision: 1,
      arrived_at: time, report_id: null, sent_report_id: null, sent_at: null, sent_by: null, classification: null, parent_response: '', reasons: [],
      next_contact_at: null, finalized_at: null, revision_reason: '', updated_by: '00000000-0000-4000-8000-000000000001', updated_at: time });
    const report: AssessmentReport = { id: '00000000-0000-4000-8000-000000000002', version: 1, created_at: time, payload: {
      schemaVersion: 1, name: '同学', grade: null, gradeText: '', activityTitle: '测评', assessedAt: time, resultSource: 'quick_entry', recordedByName: '',
      score: 60, totalScore: null, assessmentBand: 'a', strengths: '', focusAreas: '', teacherObservation: '', recommendation: '', recommendedClass: '',
    } };
    const fixtures: AssessmentWorkbenchRow[] = [
      { ...row, id: 'entry', assessmentStartedAt: time },
      { ...row, id: 'prepare', assessmentCompletedAt: time },
      { ...row, id: 'feedback', assessmentCompletedAt: time, workflow: { ...workflow, report } },
    ];
    const html = render(createElement(AssessmentUnifiedWorkbench, { initialRows: fixtures, assessors: [], locale,
      canAssess: true, canSupport: true, canManageAssessor: false }), locale);
    const states = [...html.matchAll(/<td[^>]*data-assessment-state-kind[^>]*>([\s\S]*?)<\/td>/g)].map(match => match[1]);
    const labels = assessmentStatusMessages(locale).labels;
    for (const key of ['continue_entry', 'prepare_report', 'give_feedback'] as const) {
      const cell = states.find(state => state.includes(`data-assessment-status="${key}"`));
      expect(cell).toContain(labels[key]);
      expect(cell).not.toContain('bg-current');
      expect(cell?.replace(/<[^>]*>/g, '')).not.toMatch(/[·•●]/u);
    }
    const work = [...html.matchAll(/<td[^>]*data-assessment-current-work[^>]*>([\s\S]*?)<\/td>/g)].map(match => match[1]).join('');
    expect(work).not.toContain(labels.continue_entry);
    expect(work).not.toContain(labels.prepare_report);
    expect(work).not.toContain(labels.give_feedback);
  });
  it('renders a source question workbench with an unknown scheduled time', () => {
    const html = render(createElement(TeacherAssessmentWorkbench, { data: { registrationId: id, subjectName: '来源学生', grade: null,
      gradeText: '', background: '', participationStatus: 'booked', scheduledAt: '', location: '', startedAt: null, completedAt: null,
      score: null, assessmentBand: null, teacherObservation: '', paperVersion: null, questions: [], paperOptions: [],
    } }), 'zh');
    expect(html).toContain('来源学生');
    expect(html).not.toContain('Invalid Date');
  });
});
