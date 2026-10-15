import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { expect, it, vi } from 'vitest';
import zh from '../messages/zh.json';
import en from '../messages/en.json';
import { ActivitiesManager } from '@/features/school/ActivitiesManager';
import type { ActivityRow } from '@/features/school/activities';

vi.mock('@/features/school/activity-actions', () => ({
  createActivityAction: vi.fn(), deleteActivityAction: vi.fn(), updateActivityAction: vi.fn(), setActivityTargetGradesAction: vi.fn(),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...props }: ComponentProps<'a'>) => createElement('a', props, children),
  useRouter: () => ({ refresh: vi.fn() }), usePathname: () => '/dashboard/activities',
}));

it.each(['zh', 'en'] as const)('lists every activity by time, newest first, and merges imported registrations of one session (%s)', locale => {
  const registration = (id: string, studentName: string) => ({ id, studentId: id, studentName, studentGrade: null, status: 'attended' as const, outcome: '', assessment: null, route: null });
  const activities: ActivityRow[] = [
    { id: 'date-only', kind: 'trial_class', title: 'Date only', scheduledAt: '', occurredOn: '2026-09-08' },
    { id: 'unknown', kind: 'trial_class', title: 'Unknown date', scheduledAt: '', occurredOn: null },
    { id: 'invalid', kind: 'trial_class', title: 'Invalid date', scheduledAt: 'invalid', occurredOn: null },
    { id: 'scheduled', kind: 'trial_class', title: 'Scheduled', scheduledAt: '2026-09-08T02:00:00Z' },
    { id: 'old', kind: 'trial_class', title: 'Earlier session', scheduledAt: '', occurredOn: '2025-01-01' },
    { id: 'imported-a', kind: 'competition', title: 'Imported session', scheduledAt: '', occurredOn: '2026-10-11', sourceRecordId: 'row-a', registrations: [registration('a', 'Student A')] },
    { id: 'imported-b', kind: 'competition', title: 'Imported session', scheduledAt: '', occurredOn: '2026-10-11', sourceRecordId: 'row-b', registrations: [registration('b', 'Student B')] },
  ].map(row => ({ durationMin: null, location: '', capacity: null, remark: '', registrations: [], ...row })) as ActivityRow[];
  const props: ComponentProps<typeof NextIntlClientProvider> = {
    locale, messages: locale === 'zh' ? zh : en, timeZone: 'Asia/Shanghai',
    children: createElement(ActivitiesManager, { title: 'Activities', activities, canManage: false, teachingActivityIds: [] }),
  };
  const html = renderToStaticMarkup(createElement(NextIntlClientProvider, props));
  for (const id of ['date-only', 'unknown', 'invalid', 'scheduled', 'old', 'imported-a']) expect(html).toContain(`data-activity-row="${id}"`);
  expect(html).not.toContain('data-activity-row="imported-b"');
  expect(html.match(/data-activity-imported="true"/g)).toHaveLength(1);
  expect(html).toContain(locale === 'zh' ? '2 条登记' : '2 registrations');
  expect(html.indexOf('data-activity-row="imported-a"')).toBeLessThan(html.indexOf('data-activity-row="old"'));
  expect(html).not.toContain('Invalid Date');
});
