import { createElement, type ComponentProps, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import zh from '../messages/zh.json';
import en from '../messages/en.json';
import { AssessmentUnifiedWorkbench } from '@/features/school/AssessmentUnifiedWorkbench';
import { TeacherAssessmentWorkbench } from '@/features/school/TeacherAssessmentWorkbench';
import type { AssessmentWorkbenchRow } from '@/features/school/assessment-workbench-contract';

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
  it('renders a source question workbench with an unknown scheduled time', () => {
    const html = render(createElement(TeacherAssessmentWorkbench, { data: { registrationId: id, subjectName: '来源学生', grade: null,
      gradeText: '', background: '', participationStatus: 'booked', scheduledAt: '', location: '', startedAt: null, completedAt: null,
      score: null, assessmentBand: null, teacherObservation: '', paperVersion: null, questions: [], paperOptions: [],
    } }), 'zh');
    expect(html).toContain('来源学生');
    expect(html).not.toContain('Invalid Date');
  });
});
