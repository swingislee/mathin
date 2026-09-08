'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocale } from 'next-intl';
import { Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { TableCell, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useRouter } from '@/i18n/navigation';
import { newId } from '@/lib/uuid';
import { addSupportWorkAction, getSupportOptionsAction } from './school-support-actions';
import { SupportChoice, SupportSubjectSearch, SupportWorkFields, type SupportOptions } from './SchoolSupportEntry';
import { SUPPORT_REFRESH_EVENT, supportEntryHref, supportEntrySchema, supportError, supportMessages,
  type SupportCandidate, type SupportEntry, type SupportItem, type SupportWork, type SupportWorkspace } from './school-support-contract';

export type SupportColumn = 'blank' | 'name' | 'phone' | 'grade' | 'note';
type EntryContext = { workspace: SupportWorkspace; columns: SupportColumn[]; initialWork?: Partial<SupportWork>;
  active: string | null; setActive: (key: string | null) => void; onSaved?: (item: SupportItem) => void };
const EntryContext = createContext<EntryContext | null>(null);

/** 表格自行提供列顺序；插入点跟随记录及其详情，不改变原记录的编辑行为。 */
export function SchoolSupportTableEntry({ workspace, columns, initialWork, enabled, children, onSaved }: {
  workspace: SupportWorkspace; columns: SupportColumn[]; initialWork?: Partial<SupportWork>; enabled: boolean;
  children: ReactNode; onSaved?: (item: SupportItem) => void;
}) {
  const [active, setActive] = useState<string | null>(null);
  return <EntryContext.Provider value={enabled ? { workspace, columns, initialWork, active, setActive, onSaved } : null}>
    <div className={enabled ? '[&_[data-slot=table-container]]:pl-7' : undefined}>{children}</div>
  </EntryContext.Provider>;
}

export function SchoolSupportInsertion({ after }: { after: string }) {
  const context = useContext(EntryContext), locale = useLocale();
  if (!context) return null;
  const open = context.active === after;
  return <>
    <TableRow data-support-insertion={after} className="h-0 border-0 hover:bg-transparent">
      <TableCell className="sticky left-0 z-20 h-0 border-0 p-0" colSpan={context.columns.length}>
        <Button type="button" variant="ghost" size="sm" className="absolute -left-6 top-0 size-5 -translate-y-1/2 rounded-full border border-line bg-card p-0 text-muted shadow-sm hover:bg-moon hover:text-ink focus-visible:opacity-100"
          aria-label={locale === 'en' ? 'Insert student below this row' : '在此行下方补入学生'} aria-expanded={open}
          disabled={context.active !== null} onClick={() => context.setActive(open ? null : after)}><Plus className="size-3.5" /></Button>
      </TableCell>
    </TableRow>
    {open ? <SupportInlineForm workspace={context.workspace} columns={context.columns} initialWork={context.initialWork}
      onClose={() => context.setActive(null)} onSaved={context.onSaved} /> : null}
  </>;
}

function SupportInlineForm({ workspace, columns, initialWork, onClose, onSaved, panel = false, contextLabel, onBusyChange }: {
  workspace: SupportWorkspace; columns: SupportColumn[]; initialWork?: Partial<SupportWork>; onClose: () => void;
  onSaved?: (item: SupportItem) => void; panel?: boolean; contextLabel?: string; onBusyChange?: (busy:boolean)=>void;
}) {
  const locale = useLocale(), en = locale === 'en', m = supportMessages(locale), router = useRouter();
  const [options, setOptions] = useState<SupportOptions | null>(null), [error, setError] = useState(''), [pending, setPending] = useState(false);
  const [revision, setRevision] = useState(0), [selected, setSelected] = useState<SupportCandidate | null>(null);
  const [draft, setDraft] = useState(() => ({ requestId: newId(), input: { workspace, subject: null,
    newPerson: { name: '', phone: '', grade: null, createStudent: false, identityPending: true },
    acknowledgeDuplicate: false, work: { note: '', ...initialWork } } as SupportEntry }));
  const [ready, setReady] = useState(false), saving = useRef(false), nameRef = useRef<HTMLInputElement>(null);
  const storageKey = options ? `mathin:support-inline:v2:${options.currentUserId}:${workspace}:${initialWork?.classroomId ?? ''}:${initialWork?.seat ?? ''}` : '';
  useEffect(() => { let live = true; void getSupportOptionsAction().then(result => {
    if (!live) return;
    if (result.ok) {
      const key=`mathin:support-inline:v2:${result.data.currentUserId}:${workspace}:${initialWork?.classroomId??''}:${initialWork?.seat??''}`;
      try { const stored=JSON.parse(sessionStorage.getItem(key)??'null'); const parsed=supportEntrySchema.safeParse(stored?.input);
        if(parsed.success&&typeof stored.requestId==='string'){setDraft({input:parsed.data,requestId:stored.requestId});if(stored.selected)setSelected(stored.selected);}
      } catch { /* 当前空白行仍可继续填写。 */ }
      setOptions(result.data); setReady(true); setError('');
    } else setError(supportError(result.code, locale));
  }).catch(() => { if (live) setError(supportError('', locale)); }); return () => { live = false; }; }, [locale, revision, workspace, initialWork?.classroomId, initialWork?.seat]);
  useEffect(() => { if (ready) nameRef.current?.focus(); }, [ready]);
  useEffect(() => { if (ready && storageKey) { try { sessionStorage.setItem(storageKey, JSON.stringify({...draft,selected})); } catch { /* 保留当前行草稿。 */ } } }, [draft, selected, ready, storageKey]);
  const change = (patch: Partial<SupportEntry>) => setDraft(current => ({ input: { ...current.input, ...patch }, requestId: newId() }));
  const input = draft.input, person = input.newPerson;
  const changePerson = (patch: Partial<NonNullable<SupportEntry['newPerson']>>) => {
    setSelected(null); change({ subject: null, acknowledgeDuplicate: false,
      newPerson: { name: selected?.name ?? '', phone: selected?.phone ?? '', grade: selected?.grade ?? null, createStudent: false, identityPending: true, ...person, ...patch } });
  };
  const cancel = () => { if (pending) return; if (storageKey) sessionStorage.removeItem(storageKey); onClose(); };
  const save = async () => {
    if (saving.current || !options || !supportEntrySchema.safeParse(input).success || Boolean(person && !options.canCreate)) return;
    saving.current = true; setPending(true); onBusyChange?.(true); setError('');
    try {
      const result = await addSupportWorkAction(draft.requestId, input);
      if (!result.ok) { setError(supportError(result.code, locale)); return; }
      sessionStorage.removeItem(storageKey); toast.success(m.saved);
      window.dispatchEvent(new Event(SUPPORT_REFRESH_EVENT)); onSaved?.(result.data); onClose();
      router.replace(supportEntryHref(result.data)); router.refresh();
    } catch { setError(supportError('', locale)); } finally { saving.current = false; setPending(false); onBusyChange?.(false); }
  };
  const field = (column: SupportColumn, inDetails = false) => {
    if (column === 'blank') return null;
    const value = column === 'note' ? input.work.note : column === 'grade' ? (person?.grade ?? selected?.grade)?.toString() ?? '' : person?.[column] ?? selected?.[column] ?? '';
    if (column === 'grade') return <SupportChoice label={m.grade} value={value} disabled={pending || !ready || Boolean(input.subject)}
      onChange={value => changePerson({ grade: value ? Number(value) : null })}
      options={[{ value: '', label: '—' }, ...Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))]} />;
    return <Input ref={column === 'name' && !inDetails ? nameRef : undefined} aria-label={m[column]} placeholder={m[column]}
      value={value} maxLength={column === 'note' ? 2000 : column === 'phone' ? 40 : 100} className="h-8 min-w-0 text-xs"
      disabled={pending || !ready || column !== 'note' && Boolean(input.subject)}
      onChange={event => column === 'note' ? change({ work: { ...input.work, note: event.target.value } }) : changePerson({ [column]: event.target.value })} />;
  };
  const details = <div className="space-y-3 p-3 text-xs" data-support-entry-details onKeyDown={event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void save(); }
  }}>
    <div className="flex items-center justify-between gap-3"><span className="font-medium">{contextLabel ?? m.add}</span>
      <Button type="button" variant="ghost" size="sm" className="size-7 p-0" aria-label={m.cancel} disabled={pending} onClick={cancel}><X className="size-4" /></Button></div>
    <div className="grid gap-3 sm:grid-cols-3">{(['name', 'phone', 'grade'] as const).filter(key => panel || !columns.includes(key)).map(key => <div key={key} className="grid gap-1.5">{key === 'grade' ? null : m[key]}{field(key, !panel)}</div>)}</div>
    {input.subject ? <div className="flex items-center justify-between rounded-md border border-line bg-card p-2"><span>{en ? 'Selected profile' : '已选择档案'} · {selected?.name ?? m.details} · {selected?.phone}</span>
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => changePerson({})}>{en ? 'Change' : '重新填写'}</Button></div>
      : <SupportSubjectSearch locale={locale} disabled={pending || !ready} studentsOnly={Boolean(initialWork?.classroomId)} queries={[person?.phone ?? '', person?.name ?? '']}
        onSelect={candidate => { setSelected(candidate); change({ subject: { studentId: candidate.studentId, leadId: candidate.leadId, version: candidate.version }, newPerson: null, acknowledgeDuplicate: false }); }} />}
    {person && options?.canCreate ? <div className="flex flex-wrap gap-x-5 gap-y-2">
      <Label className="flex items-center gap-2 text-xs"><Checkbox checked={person.createStudent} disabled={pending || !person.name.trim()}
        onCheckedChange={value => changePerson({ createStudent: value === true, identityPending: value !== true })} />{m.confirmed}</Label>
      <Label className="flex items-center gap-2 text-xs"><Checkbox checked={input.acknowledgeDuplicate} disabled={pending}
        onCheckedChange={value => change({ acknowledgeDuplicate: value === true })} />{m.duplicate}</Label>
    </div> : null}
    {options ? <SupportWorkFields workspace={workspace} work={input.work} options={options} locale={locale} disabled={pending} targetLocked={Boolean(initialWork?.classroomId)} onChange={work => change({ work })} />
      : !error ? <p role="status">{m.loading}</p> : null}
    {error ? <p role="alert" className="text-rose">{error}{!options ? <Button variant="ghost" size="sm" onClick={() => setRevision(value => value + 1)}>{m.retry}</Button> : null}</p> : null}
    <div className="flex items-center justify-end gap-2"><Button variant="ghost" size="sm" disabled={pending} onClick={cancel}>{m.cancel}</Button>
      <Button size="sm" disabled={pending || !ready || Boolean(person && !options?.canCreate) || !supportEntrySchema.safeParse(input).success} onClick={() => void save()}>{pending ? m.loading : initialWork?.classroomId ? (en ? 'Save and place student' : '保存并补入此座位') : m.save}</Button></div>
  </div>;
  return panel ? details : <>
    <TableRow data-support-entry-summary onKeyDown={event=>{if((event.ctrlKey||event.metaKey)&&event.key==="Enter"&&!event.nativeEvent.isComposing){event.preventDefault();void save();}}} className="bg-moon/25 [&>td]:px-2 [&>td]:py-1">{columns.map((column, index) => <TableCell key={index}>{field(column)}</TableCell>)}</TableRow>
    <TableRow className="bg-moon/15"><TableCell colSpan={columns.length} className="p-0">{details}</TableCell></TableRow>
  </>;
}

export function SchoolSupportSeatEntry({ open, onClose, classroomName, seat, classroomId, courseId, termId }: {
  open: boolean; onClose: () => void; classroomName: string; seat: number; classroomId: string; courseId: string; termId: string;
}) {
  const [busy,setBusy]=useState(false);
  const locale = useLocale(), title = locale === 'en' ? 'Add student to this seat' : '补入学生';
  return <Dialog open={open} onOpenChange={value => { if (!value && !busy) onClose(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
    <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{classroomName} · {locale === 'en' ? `Seat ${seat}` : `${seat} 号位`}</DialogDescription></DialogHeader>
    <SupportInlineForm workspace="enrollments" columns={[]} panel onClose={onClose} onBusyChange={setBusy} initialWork={{ classroomId, courseId, termId, seat }} />
  </DialogContent></Dialog>;
}
