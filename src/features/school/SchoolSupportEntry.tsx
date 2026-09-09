'use client';

import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getSupportOptionsAction, searchSupportSubjectsAction } from './school-support-actions';
import { supportError, supportMessages,
  type SupportCandidate, type SupportWork, type SupportWorkspace } from './school-support-contract';

export type SupportOptions = Extract<Awaited<ReturnType<typeof getSupportOptionsAction>>, {ok:true}>['data'];
export function SupportSubjectSearch({ locale, onSelect, studentsOnly=false, disabled=false, queries, phoneQueries=[] }: {
  locale: string; onSelect:(candidate:SupportCandidate)=>void; studentsOnly?:boolean; disabled?:boolean; queries?:string[]; phoneQueries?:string[];
}) {
  const m=supportMessages(locale), [query,setQuery]=useState('');
  const isPhone = !queries && /^[+\d\s()-]+$/.test(query.trim());
  const phones = (isPhone ? [query] : phoneQueries).map(value=>value.replace(/\D/g,'')).filter(Boolean);
  const incompletePhone = phones.some(value=>value.length<9);
  const queryKey=JSON.stringify(disabled || incompletePhone ? [] : [...new Set([
    ...(queries??(isPhone?[]:[query])),...phones,
  ].map(value=>value.trim()).filter(Boolean))]);
  const [result,setResult]=useState<{key:string;items:SupportCandidate[];error:string}>({key:'',items:[],error:''});
  useEffect(()=>{
    let active=true;
    const timer=setTimeout(()=>{
      const searches=JSON.parse(queryKey) as string[];
      void Promise.all(searches.map(value=>searchSupportSubjectsAction(value))).then(results=>{
        if(!active)return;
        const unique=new Map<string,SupportCandidate>();let error='';
        for(const result of results){if(result.ok){for(const item of result.data)unique.set(item.studentId??item.leadId!,item);}else error=supportError(result.code,locale);}
        setResult({key:queryKey,items:[...unique.values()],error});
      }).catch(()=>{if(active)setResult({key:queryKey,items:[],error:supportError('',locale)});});
    },250);
    return ()=>{active=false;clearTimeout(timer);};
  },[queryKey,locale]);
  const loading=result.key!==queryKey&&queryKey!=='[]';
  const items=result.key===queryKey?result.items.filter(item=>!studentsOnly||item.studentId):[];
  return <div className="space-y-2" data-support-candidates>
    {queries? <p className="font-medium">{locale==='en'?'Possible student matches':'可能匹配的学生'}</p>
      :<Label className="flex items-center gap-2"><Search className="size-4"/><Input autoFocus value={query} maxLength={100} disabled={disabled} placeholder={m.search} aria-label={m.search} onChange={e=>setQuery(e.target.value)}/></Label>}
    <p className="text-xs text-muted" role={incompletePhone?'status':undefined}>{incompletePhone
      ? (locale==='en'?'Complete the phone number to search; matching starts at 9 digits.':'请补完电话号码后搜索，输入到第 9 位时开始匹配。')
      : queries?(locale==='en'?'Enter a name, phone, parent or WeChat, then select the matching profile.':'填写姓名、电话、家长或微信后，在这里核对并选择已有档案。'):m.searchFirst}</p>
    {loading?<p role="status" className="text-xs text-muted">{m.loading}</p>:null}
    {result.key===queryKey&&result.error?<p role="alert" className="text-xs text-rose">{result.error}</p>:null}
    {queries&&queryKey!=='[]'&&!loading&&!result.error&&!items.length?<p className="text-xs text-muted">{locale==='en'?'No matching profiles. Continue with the details you have.':'暂未找到匹配档案，可继续填写现有资料。'}</p>:null}
    <ul className="max-h-56 divide-y divide-line overflow-y-auto rounded-md border-line">{items.map(item=><li key={item.studentId??item.leadId}><Button
      type="button" variant="ghost" className="h-auto w-full justify-start whitespace-normal px-2 py-2 text-left"
      disabled={disabled||!item.canWrite} onClick={()=>onSelect(item)}>
      <span className="min-w-0"><span className="block font-medium">{item.name||m.unknown} <span className="text-xs font-normal text-muted">{item.phone}</span></span>
        <span className="block text-xs text-muted">{[item.grade?m.grade+' '+item.grade:m.unknown,item.parentName,item.school,item.ownerName].filter(Boolean).join(' · ')}</span></span>
    </Button></li>)}</ul>
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
