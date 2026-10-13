'use client';

import dynamic from 'next/dynamic';
import { useLocale } from 'next-intl';

const ProfileButton = dynamic(() => import('./SchoolSupportProfile').then(module => module.SchoolSupportProfileButton));
export type StudentProfileSubject = { studentId?: string | null; leadId?: string | null };

/** 学生嵌套详情统一提供基础资料入口，修订沿用原主体与权限。 */
export function StudentBasicProfileBar({ subject, disabled = false }: { subject: StudentProfileSubject; disabled?: boolean }) {
  const en = useLocale().startsWith('en');
  if (!subject.studentId && !subject.leadId) return null;
  return <div className="mb-2 flex items-center gap-2 border-b border-line pb-1" data-student-basic-profile>
    <ProfileButton studentId={subject.studentId ?? null} leadId={subject.leadId ?? null} disabled={disabled}
      label={en ? 'Edit basic information' : '修改基础信息'} />
    <span className="text-[11px] text-muted">{en ? 'Name · grade · phone' : '姓名 · 年级 · 电话'}</span>
  </div>;
}
