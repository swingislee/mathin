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

it.each(['zh', 'en'] as const)('renders current, historical and mixed lists with missing dates (%s)', locale => {
  const activities: ActivityRow[] = [
    { id: 'date-only', kind: 'trial_class', title: 'Date only', scheduledAt: '', occurredOn: '2026-09-08', recordState: 'current' },
    { id: 'unknown', kind: 'trial_class', title: 'Unknown date', scheduledAt: '', occurredOn: null, recordState: 'current' },
    { id: 'invalid', kind: 'trial_class', title: 'Invalid date', scheduledAt: 'invalid', occurredOn: null, recordState: 'current' },
    { id: 'scheduled', kind: 'trial_class', title: 'Scheduled', scheduledAt: '2026-09-08T02:00:00Z', recordState: 'current' },
    { id: 'historical', kind: 'trial_class', title: 'Historical', scheduledAt: '', occurredOn: '2025-01-01', recordState: 'historical' },
  ].map(row => ({ ...row, durationMin: null, location: '', capacity: null, remark: '', registrations: [] })) as ActivityRow[];
  for (const state of ['current', 'historical', 'all'] as const) {
    const props: ComponentProps<typeof NextIntlClientProvider> = {
      locale, messages: locale === 'zh' ? zh : en, timeZone: 'Asia/Shanghai',
      children: createElement(ActivitiesManager, { title: 'Activities', activities, canManage: false, teachingActivityIds: [], initialRecordState: state }),
    };
    const html = renderToStaticMarkup(createElement(NextIntlClientProvider, props));
    for (const row of activities.filter(row => state === 'all' || row.recordState === state)) {
      expect(html).toContain(`data-activity-row="${row.id}"`);
    }
    expect(html).not.toContain('Invalid Date');
  }
});
