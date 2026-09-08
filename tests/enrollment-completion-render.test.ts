import { createElement, type ComponentProps, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import messages from '../messages/zh.json';
import { EnrollmentPlacementWorkbench } from '@/features/school/EnrollmentPlacementWorkbench';
import type { EnrollmentPlacementBoard } from '@/features/school/enrollment-workflow-contract';

// 补入流程有独立合同测试；这些用例继续覆盖原工作表交互。
vi.mock("@/features/school/SchoolSupportEntry", () => ({ SchoolSupportAddButton: () => null }));
vi.mock("@/features/school/SchoolSupportPendingRows", () => ({ SchoolSupportPendingRows: () => null }));
vi.mock('@/features/school/enrollment-workflow-actions', () => ({ moveEnrollmentSeatAction: vi.fn() }));
vi.mock('@/features/school/Student360Sheet', () => ({ Student360Trigger: ({ children }: { children: ReactNode }) => createElement('button', null, children) }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...props }: ComponentProps<'a'>) => createElement('a', props, children),
  useRouter: () => ({ refresh: vi.fn() }), usePathname: () => '/dashboard/followups/enrollments',
}));

describe('class roster completion tiles', () => {
  it('colors the exact renewed membership and keeps risk visible', () => {
    const board: EnrollmentPlacementBoard = {
      options: { courses: [{ id: 'course', title: '课程', grade: 3, productCode: null, classType: 'standard' }],
        terms: [{ id: 'term', name: '学期', isCurrent: true, startsOn: null, endsOn: null }],
        classrooms: ['class-a', 'class-b'].map(id => ({ id, name: id, courseId: 'course', termId: 'term', capacity: 4,
          activeCount: 2, operationalStatus: 'active', teacherNames: '', sessions: [] })), },
      enrollments: [],
      members: ['healthy', 'renewed', 'danger', 'same-student-other-class'].map((id, index) => ({
        membershipId: id, studentId: id === 'same-student-other-class' ? 'renewed' : id, name: id, phone: '',
        classroomId: index === 3 ? 'class-b' : 'class-a', enrollmentId: null, note: '', recommendation: '', seat: index + 1,
      })),
      renewedMembershipIds: ['renewed', 'danger'],
      health: { healthy: [{ key: 'attendance', level: 'observed' }, { key: 'communication', level: 'observed' }],
        danger: [{ key: 'attendance', level: 'attention' }, { key: 'communication', level: 'attention' }] },
    };
    const provider: ComponentProps<typeof NextIntlClientProvider> = {
      locale: 'zh', messages, timeZone: 'Asia/Shanghai', children: createElement(EnrollmentPlacementWorkbench, { initialBoard: board, canCreateClass: false }),
    };
    const html = renderToStaticMarkup(createElement(NextIntlClientProvider, provider));
    const tile = (id: string) => html.match(new RegExp(`<span[^>]*data-placement-student="${id}"[^>]*>`))?.[0];
    expect(tile('healthy')).toContain('background:var(--card)');
    expect(tile('renewed')).toContain('data-placement-renewed="true"');
    expect(tile('renewed')).toContain('var(--leaf) 24%');
    expect(tile('danger')).toContain('data-placement-renewed="true"');
    expect(tile('danger')).toContain('var(--rose)');
    expect(tile('same-student-other-class')).toContain('data-placement-renewed="false"');
    expect(tile('same-student-other-class')).toContain('background:var(--card)');
  });
});
