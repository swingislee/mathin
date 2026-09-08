'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useRouter } from '@/i18n/navigation';
import { newId } from '@/lib/uuid';
import { addSupportWorkAction, getSupportOptionsAction, searchSupportSubjectsAction } from './school-support-actions';
import { SUPPORT_REFRESH_EVENT, SUPPORT_WORKSPACES, supportEntryHref, supportEntrySchema, supportError, supportMessages,
  type SupportCandidate, type SupportEntry, type SupportItem, type SupportWork, type SupportWorkspace } from './school-support-contract';

export type SupportOptions = Extract<Awaited<ReturnType<typeof getSupportOptionsAction>>, {ok:true}>['data'];
export function SupportSubjectSearch({ locale, onSelect, studentsOnly=false, disabled=false }: {
  locale: string; onSelect:(candidate:SupportCandidate)=>void; studentsOnly?:boolean; disabled?:boolean;
}) {
  const m=supportMessages(locale);
  const [query,setQuery]=useState(''),[items,setItems]=useState<SupportCandidate[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    const timer=setTimeout(()=>{
      if (!query.trim()) { setItems([]); setError(''); return; }
      setLoading(true);setError('');
      void searchSupportSubjectsAction(query).then(result=>{
        if(!active)return;
        if(result.ok)setItems(result.data);else {setItems([]);setError(supportError(result.code,locale));}
      }).catch(()=>{if(active){setItems([]);setError(supportError('',locale));}}).finally(()=>{if(active)setLoading(false);});
    },250);
    return ()=>{active=false;clearTimeout(timer);};
  },[query,locale]);
  return <div className="space-y-2">
    <Label className="flex items-center gap-2"><Search className="size-4"/><Input autoFocus value={query} maxLength={100} disabled={disabled} placeholder={m.search} aria-label={m.search} onChange={e=>setQuery(e.target.value)}/></Label>
    <p className="text-xs text-muted">{m.searchFirst}</p>
    {loading?<p role="status" className="text-xs text-muted">{m.loading}</p>:null}
    {error?<p role="alert" className="text-xs text-rose">{error}</p>:null}
    <div className="max-h-56 overflow-y-auto rounded-md border-line divide-y divide-line">{items.filter(item=>!studentsOnly||item.studentId).map(item=><Button
      key={item.studentId??item.leadId} type="button" variant="ghost" className="h-auto w-full justify-start whitespace-normal px-2 py-2 text-left"
      disabled={disabled||!item.canWrite} onClick={()=>onSelect(item)}>
      <span className="min-w-0"><span className="block font-medium">{item.name||m.unknown} <span className="text-xs font-normal text-muted">{item.phone}</span></span>
        <span className="block text-xs text-muted">{[item.grade?`${m.grade} ${item.grade}`:m.unknown,item.parentName,item.school,item.ownerName].filter(Boolean).join(' · ')}</span></span>
    </Button>)}</div>
  </div>;
}

export function SupportChoice({label,value,onChange,options,disabled=false}:{label:string;value:string;onChange:(value:string)=>void;options:{value:string;label:string}[];disabled?:boolean}) {
  return <Label className="grid gap-1.5 text-xs"><span>{label}</span><Select value={value||'__pending'} onValueChange={value=>onChange(value==='__pending'?'':value)} disabled={disabled}>
    <SelectTrigger className="w-full" aria-label={label}><SelectValue/></SelectTrigger><SelectContent>{options.map(option=><SelectItem key={option.value||'__pending'} value={option.value||'__pending'}>{option.label}</SelectItem>)}</SelectContent>
  </Select></Label>;
}

export function SupportWorkFields({ workspace,work,onChange,options,locale,disabled=false,targetLocked=false }:{
  workspace:SupportWorkspace;work:SupportWork;onChange:(work:SupportWork)=>void;options:SupportOptions;locale:string;disabled?:boolean;targetLocked?:boolean;
}) {
  const m=supportMessages(locale);
  const change=(patch:Partial<SupportWork>)=>onChange({...work,...patch});
  const localTime=work.scheduledAt?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(work.scheduledAt)).replace(' ','T'):'';
  return <div className="grid gap-3 sm:grid-cols-2">
    {workspace==='communication'?<Label className="grid gap-1.5 text-xs">{m.date}<Input type="date" value={work.date??''} disabled={disabled} onChange={e=>change({date:e.target.value||null})}/></Label>:null}
    {workspace==='assessments'?<>
      <SupportChoice label={m.activity} value={work.activityId??(work.scheduledAt?'direct':'')} disabled={disabled} onChange={value=>change({activityId:value&&value!=='direct'?value:null,scheduledAt:value==='direct'?new Date().toISOString():null})}
        options={[{value:'',label:m.pendingActivity},{value:'direct',label:m.direct},...options.activities.filter(item=>['assessment_1v1','trial_class','public_class','sanbanfu'].includes(item.kind)).map(item=>({value:item.id,label:`${item.title} · ${item.scheduledAt?.slice(0,10)??''}`}))]}/>
      {!work.activityId&&work.scheduledAt?<Label className="grid gap-1.5 text-xs">{m.time}<Input type="datetime-local" value={localTime} disabled={disabled} onChange={e=>{if(e.target.value)change({scheduledAt:new Date(`${e.target.value}:00+08:00`).toISOString()});}}/></Label>:null}
      <Label className="grid gap-1.5 text-xs">{m.location}<Input value={work.location??''} maxLength={200} disabled={disabled} onChange={e=>change({location:e.target.value})}/></Label>
      <Label className="flex items-center gap-2 text-sm"><Checkbox checked={work.arrived??false} disabled={disabled||!work.activityId&&!work.scheduledAt} onCheckedChange={value=>change({arrived:value===true})}/>{m.arrived}</Label>
    </>:null}
    {workspace==='enrollments'||workspace==='renewals'?<>
      <SupportChoice label={m.course} value={work.courseId??''} disabled={disabled||targetLocked} onChange={value=>change({courseId:value||null})} options={[{value:'',label:m.unknown},...options.enrollment.courses.map(item=>({value:item.id,label:item.title}))]}/>
      <SupportChoice label={m.term} value={work.termId??''} disabled={disabled||targetLocked} onChange={value=>change({termId:value||null})} options={[{value:'',label:m.unknown},...options.enrollment.terms.map(item=>({value:item.id,label:item.name}))]}/>
      <p className="text-xs text-muted sm:col-span-2">{m.workHint}</p>
    </>:null}
    <Label className="grid gap-1.5 text-xs sm:col-span-2">{m.note}<Textarea value={work.note} maxLength={2000} disabled={disabled} onChange={e=>change({note:e.target.value})}/></Label>
  </div>;
}

function SupportEntryForm({workspace,initialWork,options,locale,onSaved}:{workspace:SupportWorkspace;initialWork?:Partial<SupportWork>;options:SupportOptions;locale:string;onSaved:(item:SupportItem)=>void}) {
  const m=supportMessages(locale),storageKey=`mathin:support-entry:v1:${options.currentUserId}:${workspace}`;
  const [draft,setDraft]=useState(()=>{
    try {const stored=JSON.parse(sessionStorage.getItem(storageKey)??'null');const result=supportEntrySchema.safeParse(stored?.input);if(result.success&&typeof stored.requestId==='string')return {input:result.data,requestId:stored.requestId};}catch{/* 会话草稿不可用时使用当前业务。 */}
    return {requestId:newId(),input:{workspace,subject:null,newPerson:null,acknowledgeDuplicate:false,work:{note:'',date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date()),...initialWork}} as SupportEntry};
  });
  const [selected,setSelected]=useState<SupportCandidate|null>(null),[error,setError]=useState(''),[pending,setPending]=useState(false);
  const saving=useRef(false),input=draft.input;
  useEffect(()=>{try{sessionStorage.setItem(storageKey,JSON.stringify(draft));}catch{/* 保持当前表单草稿。 */}},[draft,storageKey]);
  const change=(patch:Partial<SupportEntry>)=>setDraft(current=>({input:{...current.input,...patch},requestId:newId()}));
  const person=input.newPerson;
  const save=async()=>{
    if(saving.current)return;saving.current=true;setPending(true);setError('');
    try{const result=await addSupportWorkAction(draft.requestId,input);if(!result.ok){setError(supportError(result.code,locale));return;}
      try{sessionStorage.removeItem(storageKey);}catch{/* 已完成保存。 */}onSaved(result.data);
    }catch{setError(supportError('',locale));}finally{saving.current=false;setPending(false);}
  };
  return <div className="space-y-4">
    <SupportSubjectSearch locale={locale} disabled={pending} onSelect={candidate=>{setSelected(candidate);change({subject:{studentId:candidate.studentId,leadId:candidate.leadId,version:candidate.version},newPerson:null,acknowledgeDuplicate:false});}}/>
    {input.subject?<div className="rounded-md border border-line bg-paper p-3 text-sm"><span className="font-medium">{selected?.name??m.details}</span>{selected?<span className="ml-2 text-muted">{selected.phone}</span>:null}</div>:null}
    {options.canCreate?<Button type="button" variant="secondary" size="sm" disabled={pending} onClick={()=>{setSelected(null);change({subject:null,newPerson:{name:'',phone:'',grade:null,createStudent:false,identityPending:true}});}}>{m.newPerson}</Button>:null}
    {person?<div className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-2">
      <p className="text-xs text-muted sm:col-span-2">{m.minimal}</p>
      <Label className="grid gap-1.5 text-xs">{m.name}<Input value={person.name} maxLength={100} disabled={pending} onChange={e=>change({newPerson:{...person,name:e.target.value}})}/></Label>
      <Label className="grid gap-1.5 text-xs">{m.phone}<Input value={person.phone} maxLength={40} disabled={pending} onChange={e=>change({newPerson:{...person,phone:e.target.value}})}/></Label>
      <SupportChoice label={m.grade} value={person.grade?.toString()??''} disabled={pending} onChange={value=>change({newPerson:{...person,grade:value?Number(value):null}})} options={[{value:'',label:m.unknown},...Array.from({length:12},(_,i)=>({value:String(i+1),label:String(i+1)}))]}/>
      <Label className="flex items-center gap-2 text-xs"><Checkbox checked={person.createStudent} disabled={pending||!person.name.trim()} onCheckedChange={value=>change({newPerson:{...person,createStudent:value===true,identityPending:value!==true}})}/>{m.confirmed}</Label>
      <Label className="flex items-center gap-2 text-xs sm:col-span-2"><Checkbox checked={input.acknowledgeDuplicate} disabled={pending} onCheckedChange={value=>change({acknowledgeDuplicate:value===true})}/>{m.duplicate}</Label>
    </div>:null}
    {workspace==='students'?<SupportChoice label={m.note} value={input.workspace} disabled={pending} onChange={value=>change({workspace:value as SupportWorkspace})} options={SUPPORT_WORKSPACES.filter(value=>options.canEnroll||value!=='enrollments').map(value=>({value,label:m.workspaces[SUPPORT_WORKSPACES.indexOf(value)]}))}/>:null}
    <SupportWorkFields locale={locale} options={options} workspace={input.workspace} work={input.work} disabled={pending} onChange={work=>change({work})}/>
    {error?<p role="alert" className="text-sm text-rose">{error}</p>:null}
    <div className="flex justify-end"><Button type="button" disabled={pending||!supportEntrySchema.safeParse(input).success} onClick={()=>void save()}>{pending?m.loading:m.add}</Button></div>
  </div>;
}

export function SchoolSupportAddButton({workspace,initialWork,onSaved}:{workspace:SupportWorkspace;initialWork?:Partial<SupportWork>;onSaved?:(item:SupportItem)=>void}) {
  const locale=useLocale(),m=supportMessages(locale),router=useRouter();
  const [open,setOpen]=useState(false),[options,setOptions]=useState<SupportOptions|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  useEffect(()=>{if(!open)return;let active=true;void getSupportOptionsAction().then(result=>{if(active){if(result.ok){setOptions(result.data);setError('');}else setError(supportError(result.code,locale));}}).catch(()=>{if(active)setError(supportError('',locale));});return()=>{active=false;};},[open,locale,revision]);
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button type="button" size="sm"><Plus className="size-4"/>{m.add}</Button></DialogTrigger>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{m.add}</DialogTitle><DialogDescription>{m.workspaces[SUPPORT_WORKSPACES.indexOf(workspace)]}</DialogDescription></DialogHeader>
      {options?<SupportEntryForm key={`${workspace}:${options.currentUserId}`} locale={locale} workspace={workspace} initialWork={initialWork} options={options} onSaved={item=>{setOpen(false);toast.success(m.saved);window.dispatchEvent(new Event(SUPPORT_REFRESH_EVENT));onSaved?.(item);router.replace(supportEntryHref(item));router.refresh();}}/>
        :error?<div role="alert" className="space-y-2 text-sm text-rose">{error}<Button variant="secondary" onClick={()=>setRevision(value=>value+1)}>{m.retry}</Button></div>:<p role="status">{m.loading}</p>}
    </DialogContent>
  </Dialog>;
}
