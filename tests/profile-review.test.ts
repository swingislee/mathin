import { createElement, type ComponentProps, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { deferProfileReview, profileReviewFields, profileReviewProgress, profileReviewSourceValue,
  type ProfileReviewData, type ProfileReviewItem } from '@/features/school/profile-review-contract';
import { getProfileReviewMessages } from '@/features/school/profile-review-messages';
import { ProfileReviewWorkspace } from '@/features/school/ProfileReviewWorkspace';

vi.mock('@/features/school/actions/profile-review', () => ({ saveProfileReviewAction: vi.fn(), assignProfileReviewAction: vi.fn(), readProfileReviewResponseAction: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({ Link: ({ href, children }: { href: string; children: ReactNode }) => createElement('a', { href }, children) }));

const item: ProfileReviewItem = { id: 'row-1', group_id: 'group-1', name: '示例孩子', grade: '3年级', enrollment_state: 'in_study', needs_contact: true, grade_attention: true };
const group = { id: 'group-1', label: '示例班 · 周日 9:00', teacher_name: '示例老师', teacher_id: 'teacher', support_id: 'support', version: 0 };
const data: ProfileReviewData = { userId: 'teacher', admin: false, batch: { title: 'Autumn', source_label: 'Roster', source_at: '2026-09-07T00:00:00Z' }, groups: [group], items: [item], responses: [], reviewers: [] };

function renderReview(value = data, locale = 'zh') {
  const props: ComponentProps<typeof NextIntlClientProvider> = {
    locale, timeZone: 'Asia/Shanghai', messages: {}, children: createElement(ProfileReviewWorkspace, { locale, data: value }),
  };
  return renderToStaticMarkup(createElement(NextIntlClientProvider, props));
}

describe('frontline profile review', () => {
  it('keeps contact questions in the support role and only asks where contact evidence is needed', () => {
    expect(profileReviewFields(item, 'teacher')).not.toContain('contact');
    expect(profileReviewFields(item, 'support')).toContain('contact');
    expect(profileReviewFields({ ...item, needs_contact: false }, 'support')).not.toContain('contact');
  });
  it('does not interpret unknown or partial feedback as a fully confirmed record', () => {
    expect(profileReviewProgress({}, profileReviewFields(item, 'teacher'))).toBe('pending');
    expect(profileReviewProgress({ name: { answer: 'yes' } }, profileReviewFields(item, 'teacher'))).toBe('partial');
    expect(profileReviewProgress({ name: { answer: 'unknown' } }, profileReviewFields(item, 'teacher'))).toBe('later');
  });
  it('defers unanswered fields while preserving known facts and corrections', () => {
    const answers = { name: { answer: 'yes' as const }, grade: { answer: 'correction' as const, value: '4年级' } };
    const deferred = deferProfileReview(answers, profileReviewFields(item, 'teacher'));
    expect(deferred.name).toEqual(answers.name);
    expect(deferred.grade).toEqual(answers.grade);
    expect(deferred.class).toEqual({ answer: 'unknown' });
    expect(deferred.contact).toBeUndefined();
    expect(answers).not.toHaveProperty('class');
  });
  it('keeps missing contact and unspecified enrollment unavailable for one-click confirmation', () => {
    expect(profileReviewSourceValue(item, group, 'contact')).toBe('');
    expect(profileReviewSourceValue({ ...item, enrollment_state: 'unspecified' }, group, 'enrollment')).toBe('');
    expect(profileReviewSourceValue({ ...item, name: '' }, group, 'name')).toBe('');
  });
  it.each(['zh', 'en'])('renders approachable questions with no preselected answers in %s', locale => {
    const m = getProfileReviewMessages(locale);
    const markup = renderReview(data, locale);
    expect(markup).toContain(m.fields.name);
    expect(markup).toContain(m.unknown);
    expect(markup).toContain(m.defer);
    expect(markup).not.toContain(m.fields.contact);
    expect(markup).not.toContain(m.assignmentSave);
    expect(markup).not.toContain('data-state="on"');
    expect(markup).not.toContain('targetId');
  });
  it('renders contact guidance for the assigned support colleague', () => {
    const markup = renderReview({ ...data, userId: 'support' });
    expect(markup).toContain(getProfileReviewMessages('zh').fields.contact);
    expect(markup).toContain(getProfileReviewMessages('zh').contactHelp);
  });
  it('gives unassigned staff an empty state without exposing names', () => {
    const markup = renderReview({ ...data, batch: null, groups: [], items: [] });
    expect(markup).toContain(getProfileReviewMessages('zh').empty);
    expect(markup).not.toContain(item.name);
  });
});
