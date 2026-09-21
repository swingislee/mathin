'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocale } from 'next-intl';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { TableCell, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useRouter } from '@/i18n/navigation';
import { newId } from '@/lib/uuid';
import { cn } from '@/lib/utils';
import { FollowupInlineDetails } from './dashboard-page/FollowupInlineDetails';
import { addSupportWorkAction, getSupportOptionsAction, readSupportProfileAction, readSupportFamilyAction } from './school-support-actions';
import { SupportChoice, SupportSubjectSearch, SupportWorkFields, type SupportOptions } from './SchoolSupportEntry';
import { SUPPORT_REFRESH_EVENT, supportEntryHref, supportEntrySchema, supportError, supportMessages, supportProfileSchema, supportFamilyPreviewSchema,
  type SupportCandidate, type SupportEntry, type SupportItem, type SupportWork, type SupportWorkspace, type SupportProfile, type SupportFamilyPreview } from './school-support-contract';

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
  const [position, setPosition] = useState<{key:string;top:number} | null>(null);
  const root = useRef<HTMLDivElement>(null), locale = useLocale();
  const positions = () => {
    if (!root.current || active) return [];
    const container = root.current.querySelector('[data-slot="table-container"]') ?? root.current;
    const bounds = container.getBoundingClientRect(), origin = root.current.getBoundingClientRect().top;
    const headerBottom = root.current.querySelector('thead th')?.getBoundingClientRect().bottom ?? bounds.top;
    return Array.from(root.current.querySelectorAll<HTMLElement>('[data-support-insertion]')).flatMap(anchor => {
      const top = anchor.getBoundingClientRect().top;
      return top >= Math.max(bounds.top, headerBottom, 0) && top <= Math.min(bounds.bottom, window.innerHeight)
        ? [{key:anchor.dataset.supportInsertion!,top:top-origin}] : [];
    });
  };
  const pointAt = (clientY:number) => {
    const y = clientY - (root.current?.getBoundingClientRect().top ?? 0);
    const closest = positions().reduce<{key:string;top:number}|null>((nearest,item) => !nearest || Math.abs(item.top-y)<Math.abs(nearest.top-y) ? item : nearest,null);
    const next = closest && Math.abs(closest.top-y)<=24 ? closest : null;
    setPosition(current => current?.key===next?.key && current?.top===next?.top ? current : next);
  };
  return <EntryContext.Provider value={enabled ? { workspace, columns, initialWork, active, setActive, onSaved } : null}>
    <div ref={root} className="relative flex min-h-0 min-w-0 flex-1 flex-col" onScrollCapture={() => setPosition(null)}>
      {children}
      {enabled && !active ? <div data-support-insertion-gutter className="absolute inset-y-0 right-full z-20 w-[min(var(--dashboard-gutter,1.75rem),1.75rem)]"
        onPointerMove={event => pointAt(event.clientY)} onPointerLeave={event => { if (!event.currentTarget.contains(document.activeElement)) setPosition(null); }}>
        <Button type="button" variant="ghost" size="sm" data-support-insertion-target={position?.key}
          className={cn("absolute left-1/2 size-5 max-w-full -translate-x-1/2 -translate-y-1/2 rounded-full border border-line bg-card p-0 text-muted shadow-sm hover:bg-moon hover:text-ink focus-visible:opacity-100",position ? "opacity-100 transition-opacity" : "pointer-events-none opacity-0 transition-none")}
          style={{top:position?.top ?? 0}} aria-label={locale === 'en' ? 'Insert student below this row' : '在此行下方补入学生'}
          onFocus={() => { if (!position) setPosition(positions()[0] ?? null); }} onBlur={() => setPosition(null)}
          onKeyDown={event => { if (event.key==='ArrowUp' || event.key==='ArrowDown') {
            event.preventDefault(); const items=positions(), index=items.findIndex(item=>item.key===position?.key);
            setPosition(items[Math.max(0,Math.min(items.length-1,index+(event.key==='ArrowDown'?1:-1)))] ?? null);
          } }} onClick={() => { if (position) { setActive(position.key); setPosition(null); } }}><Plus className="size-3.5" /></Button>
      </div> : null}
    </div>
  </EntryContext.Provider>;
}

export function SchoolSupportInsertion({ after }: { after: string }) {
  const context = useContext(EntryContext);
  if (!context) return null;
  const open = context.active === after;
  return <>
    <TableRow data-support-insertion={after} aria-hidden style={{height:0,border:0}} className="hover:bg-transparent">
      <TableCell style={{height:0,padding:0,border:0}} colSpan={context.columns.length} />
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
  const [profile, setProfile] = useState<SupportProfile | null>(null), [latestProfile, setLatestProfile] = useState<SupportProfile | null>(null);
  const [family, setFamily] = useState<SupportFamilyPreview | null>(null), [reading, setReading] = useState(false);
  const readSequence = useRef(0);
  useEffect(() => () => { readSequence.current++; }, []);
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
        if(parsed.success&&typeof stored.requestId==='string'){
          setDraft({input:parsed.data,requestId:stored.requestId});if(stored.selected)setSelected(stored.selected);
          const storedProfile=supportProfileSchema.safeParse(stored.profile), storedFamily=supportFamilyPreviewSchema.safeParse(stored.family);
          if(storedProfile.success)setProfile(storedProfile.data);if(storedFamily.success)setFamily(storedFamily.data);
        }
      } catch { /* 当前空白行仍可继续填写。 */ }
      setOptions(result.data); setReady(true); setError('');
    } else setError(supportError(result.code, locale));
  }).catch(() => { if (live) setError(supportError('', locale)); }); return () => { live = false; }; }, [locale, revision, workspace, initialWork?.classroomId, initialWork?.seat]);
  useEffect(() => { if (ready) nameRef.current?.focus(); }, [ready]);
  useEffect(() => { if (ready && storageKey) { try { sessionStorage.setItem(storageKey, JSON.stringify({...draft,selected,profile,family})); } catch { /* 保留当前行草稿。 */ } } }, [draft, selected, profile, family, ready, storageKey]);
  const change = (patch: Partial<SupportEntry>) => setDraft(current => ({ input: { ...current.input, ...patch }, requestId: newId() }));
  const input = draft.input, newPerson = input.newPerson, person = newPerson ?? input.profileEdit?.values ?? profile?.values;
  const busy = pending || reading;
  const profileDisabled = busy || !ready || Boolean(input.subject && !profile?.canEdit);
  const changePerson = (patch: Partial<NonNullable<SupportEntry['newPerson']>>) => {
    if (input.subject) {
      if (profile?.canEdit) change({confirmLeadProfile:false,acknowledgeDuplicate:false,profileEdit:{version:input.profileEdit?.version ?? profile.version,values:{...profile.values,...input.profileEdit?.values,...patch}},
        familyLink:input.familyLink?{...input.familyLink,confirmed:false}:null});
    } else change({ acknowledgeDuplicate: false, familyLink:input.familyLink?{...input.familyLink,confirmed:false}:null,
      newPerson: { name: '', phone: '', grade: null, createStudent: false, identityPending: true, ...newPerson, ...patch } });
  };
  const selectProfile = async (candidate:SupportCandidate, reload=false) => {
    const sequence=++readSequence.current;setReading(true);setError('');
    try {
      const result=await readSupportProfileAction({studentId:candidate.studentId,leadId:candidate.leadId});
      if(sequence!==readSequence.current)return;
      if(!result.ok){setError(supportError(result.code,locale));return;}
      if(reload){setLatestProfile(result.data);return;}
      const next=result.data;setProfile(next);setSelected({...candidate,studentId:next.studentId,leadId:next.studentId?null:next.leadId,...next.values,version:next.version});
      setFamily(null);setLatestProfile(null);
      change({subject:{studentId:next.studentId,leadId:next.studentId?null:next.leadId,version:next.version},newPerson:null,profileEdit:null,familyLink:null,acknowledgeDuplicate:false,confirmLeadProfile:false});
    } catch { if(sequence===readSequence.current)setError(supportError('',locale)); }
    finally { if(sequence===readSequence.current)setReading(false); }
  };
  const selectFamily = async (candidate:SupportCandidate) => {
    if(!candidate.studentId)return;
    const sequence=++readSequence.current;setReading(true);setError('');
    try {
      const result=await readSupportFamilyAction(input.subject?.studentId ?? null,candidate.studentId);
      if(sequence!==readSequence.current)return;
      if(!result.ok){setError(supportError(result.code,locale));return;}
      setFamily(result.data);change({familyLink:{otherStudentId:result.data.otherStudentId,otherVersion:result.data.otherVersion,version:result.data.version,confirmed:false}});
    } catch { if(sequence===readSequence.current)setError(supportError('',locale)); }
    finally { if(sequence===readSequence.current)setReading(false); }
  };
  const canSave = !busy && !latestProfile && ready && (!newPerson || options?.canCreate) && (!input.familyLink || family && input.familyLink.confirmed && !family.blocker && (input.subject?.studentId || input.confirmLeadProfile || newPerson?.createStudent))
    && supportEntrySchema.safeParse(input).success;
  const cancel = () => { if (pending) return; if (storageKey) sessionStorage.removeItem(storageKey); onClose(); };
  const save = async () => {
    if (saving.current || !options || !canSave) return;
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
    const value = column === 'note' ? input.work.note : column === 'grade' ? (person ? person.grade : selected?.grade)?.toString() ?? '' : person?.[column] ?? selected?.[column] ?? '';
    if (column === 'grade') return <SupportChoice label={m.grade} value={value} disabled={profileDisabled}
      onChange={value => changePerson({ grade: value ? Number(value) : null })}
      options={[{ value: '', label: '—' }, ...Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))]} />;
    return <Input ref={column === 'name' && !inDetails ? nameRef : undefined} aria-label={m[column]} placeholder={m[column]}
      value={value} maxLength={column === 'note' ? 2000 : column === 'phone' ? 40 : 100} className="h-8 min-w-0 text-xs"
      disabled={column === 'note' ? busy || !ready : profileDisabled}
      onChange={event => column === 'note' ? change({ work: { ...input.work, note: event.target.value } }) : changePerson({ [column]: event.target.value })} />;
  };
  const details = <div className="space-y-3 p-3 text-xs [&_[role=combobox]]:h-8 [&_[role=combobox]]:py-1 [&_[role=combobox]]:text-xs [&_input[data-slot=input]]:h-8 [&_input[data-slot=input]]:text-xs" data-support-entry-details onKeyDown={event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void save(); }
  }}>
    {!panel?<div className="font-medium">{contextLabel ?? m.add}</div>:null}
    <div className="grid gap-3 sm:grid-cols-3">{(['name', 'phone', 'grade'] as const).filter(key => panel || !columns.includes(key)).map(key => <div key={key} className="grid gap-1.5">{key === 'grade' ? null : m[key]}{field(key, !panel)}</div>)}</div>
    {input.subject ? <div className="flex items-center justify-between rounded-md border border-line bg-card p-2"><span>{en ? 'Selected profile' : '已选择档案'} · {selected?.name ?? m.details} · {selected?.phone}</span>
      <div className="flex gap-1"><Button variant="ghost" size="sm" disabled={busy||!selected} onClick={()=>{if(selected)void selectProfile(selected,true);}}>{en?'Read latest profile':'读取最新档案'}</Button>
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => {setSelected(null);setProfile(null);setLatestProfile(null);setFamily(null);change({subject:null,profileEdit:null,familyLink:null,confirmLeadProfile:false,acknowledgeDuplicate:false,
        newPerson:{name:selected?.name??'',phone:selected?.phone??'',grade:selected?.grade??null,...person,createStudent:false,identityPending:true}});}}>{en ? 'Change' : '重新填写'}</Button></div></div>
      : <SupportSubjectSearch locale={locale} disabled={busy || !ready} phoneQueries={[person?.phone ?? '', person?.parentPhone ?? '']} queries={[person?.name ?? '', person?.parentName ?? '', person?.wechat ?? '']}
        onSelect={candidate=>void selectProfile(candidate)} onFamilySelect={options?.canEdit?candidate=>void selectFamily(candidate):undefined} />}
    {reading?<p role="status">{m.loading}</p>:null}
    {input.subject&&profile?.canEdit?<p className="text-muted">{en?'Correct any profile details above or below; changes are saved with this entry.':'可直接更正姓名、年级、电话及下方资料，修订随本次办理一起保存。'}</p>:null}
    {person ? <div className="grid gap-3 sm:grid-cols-3" data-support-profile-fields>
      {(['parentPhone','parentName','school','wechat'] as const).map(key => <Label key={key} className="grid gap-1.5 text-xs">{m[key]}
        <Input aria-label={m[key]} value={person[key] ?? ''} maxLength={key === 'parentPhone' ? 40 : key === 'wechat' ? 80 : 100} disabled={profileDisabled}
          className="h-8 text-xs" onChange={event => changePerson({[key]:event.target.value})} />
      </Label>)}
      <Label className="grid gap-1.5 text-xs sm:col-span-2">{m.remark}<Textarea aria-label={m.remark} value={person.remark ?? ''} maxLength={2000} disabled={profileDisabled}
        onChange={event => changePerson({remark:event.target.value})} /></Label>
    </div> : null}
    {latestProfile?<div className="space-y-2 rounded-md border border-line p-2" data-support-profile-review><p className="font-medium">{en?'Review latest profile against this draft':'核对最新档案与当前草稿'}</p>
      {(['name','grade','phone','parentPhone','parentName','school','wechat','remark'] as const).filter(key=>(latestProfile.values[key]??'')!==(person?.[key]??'')).map(key=><p key={key}>{m[key]} · {en?'Latest':'最新'}：{latestProfile.values[key]??'—'} → {en?'Draft':'草稿'}：{person?.[key]??'—'}</p>)}
      <Button variant="secondary" size="sm" disabled={busy} onClick={()=>{const next=latestProfile;setProfile(next);setLatestProfile(null);setFamily(null);setError('');
        if(selected)setSelected({...selected,...next.values,studentId:next.studentId,leadId:next.studentId?null:next.leadId,version:next.version});
        change({subject:{studentId:next.studentId,leadId:next.studentId?null:next.leadId,version:next.version},profileEdit:input.profileEdit?{version:next.version,values:input.profileEdit.values}:null,familyLink:null,confirmLeadProfile:false,acknowledgeDuplicate:false});
      }}>{en?'Details checked; keep these corrections':'核对无误，保留当前修订'}</Button></div>:null}
    {input.subject?.leadId&&!input.subject.studentId&&options?.canCreate?<Label className="flex items-center gap-2 text-xs"><Checkbox
      checked={input.confirmLeadProfile??false} disabled={busy||!person?.name.trim()}
      onCheckedChange={value=>change({confirmLeadProfile:value===true})}/>{en?'Identity checked; create a profile using this record':'已核对孩子身份，沿用这条记录建立学生档案'}</Label>:null}
    {(newPerson || input.subject?.leadId&&!input.subject.studentId) && options?.canCreate ? <div className="flex flex-wrap gap-x-5 gap-y-2">
      {newPerson ?
      <Label className="flex items-center gap-2 text-xs"><Checkbox checked={newPerson.createStudent} disabled={busy || !newPerson.name.trim()}
        onCheckedChange={value => changePerson({ createStudent: value === true, identityPending: value !== true })} />{m.confirmed}</Label> : null}
      <Label className="flex items-center gap-2 text-xs"><Checkbox checked={input.acknowledgeDuplicate} disabled={pending}
        onCheckedChange={value => change({ acknowledgeDuplicate: value === true })} />{m.duplicate}</Label>
    </div> : null}
    {input.subject?.studentId&&options?.canEdit&&!family?<SupportSubjectSearch locale={locale} disabled={busy} studentsOnly familyOnly excludeStudentId={input.subject.studentId} queries={[]}
      phoneQueries={[person?.phone??'',person?.parentPhone??'']} onSelect={()=>{}} onFamilySelect={candidate=>void selectFamily(candidate)} />:null}
    {family?<div className="space-y-2 rounded-md border border-line p-2" data-support-family-review>
      <div className="flex items-center justify-between gap-2"><span className="font-medium">{en?'Family link':'家庭关联'} · {family.familyName}</span>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={()=>{setFamily(null);change({familyLink:null});}}>{m.cancel}</Button></div>
      <p>{person?.name||m.unknown} ↔ {family.otherName} · {family.otherPhone}</p>
      {family.blocker?<p role="alert" className="text-rose">{supportError(family.blocker,locale)}</p>:<>
        <p className="text-muted">{family.alreadyLinked?(en?'These students are already linked.':'两名学生已有关联。'):family.familyId?(en?'Add to this existing family.':'加入以上已有家庭。'):(en?'Create a family for these two students.':'为这两名学生建立家庭。')}</p>
        <Label className="flex items-center gap-2 text-xs"><Checkbox checked={input.familyLink?.confirmed??false} disabled={busy}
          onCheckedChange={value=>{if(input.familyLink)change({familyLink:{...input.familyLink,confirmed:value===true},acknowledgeDuplicate:value===true});}} />{en?'I confirmed these are two different children in the same family.':'已核对：这是同一家庭的两个不同孩子，各自保留学生档案。'}</Label>
        {newPerson&&!newPerson.createStudent?<p className="text-muted">{en?'Confirm the new student profile above to save this family link.':'请同时勾选上方“已确认是新学生，建立学生档案”。'}</p>:null}
      </>}
    </div>:null}
    {options ? <SupportWorkFields workspace={workspace} work={input.work} options={options} locale={locale} disabled={busy} targetLocked={Boolean(initialWork?.classroomId)} onChange={work => change({ work })} />
      : !error ? <p role="status">{m.loading}</p> : null}
    {error ? <p role="alert" className="text-rose">{error}{!options ? <Button variant="ghost" size="sm" onClick={() => setRevision(value => value + 1)}>{m.retry}</Button> : null}</p> : null}
    <div className="flex items-center justify-end gap-2"><Button variant="ghost" size="sm" disabled={pending} onClick={cancel}>{m.cancel}</Button>
      <Button size="sm" disabled={!canSave} onClick={() => void save()}>{pending ? m.loading : initialWork?.classroomId ? (en ? 'Save and place student' : '保存并补入此座位') : m.save}</Button></div>
  </div>;
  return panel ? details : <>
    <TableRow data-support-entry-summary onKeyDown={event=>{if((event.ctrlKey||event.metaKey)&&event.key==="Enter"&&!event.nativeEvent.isComposing){event.preventDefault();void save();}}} className="bg-moon/25 [&>td]:px-2 [&>td]:py-1">{columns.map((column, index) => <TableCell key={index}>{field(column)}</TableCell>)}</TableRow>
    <FollowupInlineDetails open colSpan={columns.length} title={contextLabel ?? m.add} hideTitle flush pending={busy} closeLabel={m.cancel}
      onOpenChange={open=>{if(!open)cancel();}} onSubmit={()=>void save()}>{details}</FollowupInlineDetails>
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
