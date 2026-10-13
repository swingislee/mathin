'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { toast } from 'sonner';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { readSupportProfileAction, updateSupportProfileAction } from './school-support-actions';
import { SUPPORT_REFRESH_EVENT, supportError, type SupportProfile } from './school-support-contract';
import { STUDENT_360_REFRESH_EVENT } from './student-360-contract';
import { currentGradeOptions } from './current-grade';
import type { StudentProfileSubject } from './StudentBasicProfileBar';

type EditableField = 'name' | 'grade' | 'phone' | 'parentPhone' | 'school' | 'remark';

/** 360 字段点击后就地编辑；读取最新完整版本后只替换目标字段。 */
export function Student360ProfileField({ subject, field, value, onSaved }: {
  subject: StudentProfileSubject; field: EditableField; value: string; onSaved: () => void;
}) {
  const locale = useLocale(), en = locale.startsWith('en'), router = useRouter();
  const [open, setOpen] = useState(false), [pending, setPending] = useState(false);
  const [profile, setProfile] = useState<SupportProfile | null>(null), [draft, setDraft] = useState('');
  const [error, setError] = useState(''), [conflict, setConflict] = useState(false), [revision, setRevision] = useState(0);
  const labels = en ? { name: 'Name', grade: 'Current grade', phone: 'Phone', parentPhone: 'Parent phone', school: 'School', remark: 'Profile notes' }
    : { name: '姓名', grade: '当前年级', phone: '联系电话', parentPhone: '家长电话', school: '学校', remark: '档案备注' };
  useEffect(() => {
    if (!open) return;
    let active = true;
    void readSupportProfileAction({ studentId: subject.studentId ?? null, leadId: subject.leadId ?? null }).then(result => {
      if (!active) return;
      if (!result.ok) { setError(supportError(result.code, locale)); return; }
      setProfile(result.data); setDraft(String(result.data.values[field] ?? '')); setError(''); setConflict(false);
    }).catch(() => { if (active) setError(supportError('', locale)); });
    return () => { active = false; };
    // 字段和主体变化时重读，已打开的草稿不会被后台刷新覆盖。
  }, [open, subject.studentId, subject.leadId, field, locale, revision]);
  const save = async () => {
    if (!profile?.canEdit || pending || conflict) return;
    setPending(true); setError('');
    const values = { ...profile.values, [field]: field === 'grade' ? draft === '' ? null : Number(draft) : draft };
    try {
      const result = await updateSupportProfileAction({ ...profile, values });
      if (!result.ok) { setError(supportError(result.code, locale)); setConflict(result.code === 'PROFILE_CONFLICT'); return; }
      toast.success(en ? 'Saved' : '已保存'); setOpen(false); setProfile(null);
      window.dispatchEvent(new Event(SUPPORT_REFRESH_EVENT)); window.dispatchEvent(new Event(STUDENT_360_REFRESH_EVENT));
      router.refresh(); onSaved();
    } catch { setError(supportError('', locale)); }
    finally { setPending(false); }
  };
  return <Popover open={open} onOpenChange={next => { if (!pending) { setOpen(next); if (!next) { setProfile(null); setError(''); } } }}>
    <PopoverTrigger asChild><button type="button" className="rounded px-0.5 text-left underline decoration-dotted underline-offset-4 hover:bg-moon/30"
      title={`${en ? 'Edit' : '修改'}${labels[field]}`} aria-label={`${en ? 'Edit' : '修改'}${labels[field]} · ${value}`}>{value || (en ? 'Add' : '待补充')}</button></PopoverTrigger>
    <PopoverContent align="start" className="w-72 space-y-2" onKeyDown={event => event.stopPropagation()}>
      <label className="grid gap-1.5 text-xs">{labels[field]}
        {field === 'grade' ? <select autoFocus className="h-9 rounded-md border border-line bg-card px-2" value={draft} disabled={!profile?.canEdit || pending}
          onChange={event => setDraft(event.target.value)}>{currentGradeOptions(locale).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
          : <Input autoFocus value={draft} disabled={!profile?.canEdit || pending} maxLength={field === 'remark' ? 2000 : field === 'phone' || field === 'parentPhone' ? 40 : 100}
            onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void save(); } }} />}
      </label>
      {error ? <p role="alert" className="text-xs text-rose">{error}</p> : null}
      {profile && !profile.canEdit ? <p className="text-xs text-muted">{en ? 'Read only' : '当前为只读权限'}</p> : null}
      <div className="flex justify-end gap-1">
        {error ? <Button size="sm" variant="secondary" disabled={pending} onClick={() => { setProfile(null); setRevision(current => current + 1); }}>{en ? 'Reload' : '重新读取'}</Button> : null}
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => { setOpen(false); setProfile(null); setError(''); }}>{en ? 'Cancel' : '取消'}</Button>
        <Button size="sm" disabled={!profile?.canEdit || pending || conflict} onClick={() => void save()}>{en ? 'Save' : '保存'}</Button>
      </div>
    </PopoverContent>
  </Popover>;
}
