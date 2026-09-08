'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, GitMerge, LoaderCircle, Search } from 'lucide-react';
import { useLocale } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useRouter } from '@/i18n/navigation';
import { SUPPORT_REFRESH_EVENT } from './school-support-contract';
import { STUDENT_360_REFRESH_EVENT } from './student-360-contract';
import { confirmStudentMergeAction, getStudentMergeHistoryAction, previewStudentMergeAction, searchStudentMergeCandidatesAction } from './student-merge-actions';
import { STUDENT_MERGE_FIELDS, defaultStudentMergeChoices, studentMergeError, studentMergeMessages,
  type StudentMergeChoices, type StudentMergeField, type StudentMergeHistory, type StudentMergeProfile, type StudentMergeReview } from './student-merge-contract';

export function StudentMergePanel({studentId,name,phone,compact=false,onSaved}:{studentId:string;name:string;phone:string;compact?:boolean;onSaved?:()=>void}) {
  const locale=useLocale(),m=studentMergeMessages(locale),router=useRouter();
  const [open,setOpen]=useState(false),[query,setQuery]=useState(phone||name);
  const [search,setSearch]=useState<{key:string;rows:StudentMergeProfile[];error:string}>({key:'',rows:[],error:''});
  const [history,setHistory]=useState<StudentMergeHistory>([]),[historyError,setHistoryError]=useState('');
  const [review,setReview]=useState<StudentMergeReview|null>(null),[choices,setChoices]=useState<StudentMergeChoices>({});
  const [reason,setReason]=useState(''),[checked,setChecked]=useState(false),[error,setError]=useState(''),[reloadRequired,setReloadRequired]=useState(false);
  const [loading,setLoading]=useState(false),[pending,setPending]=useState(false),[revision,setRevision]=useState(0);
  const saving=useRef(false),sequence=useRef(0),searchKey=`${studentId}:${query.trim()}`;
  useEffect(()=>{
    if(!open)return;
    let active=true;
    const timer=setTimeout(()=>{void searchStudentMergeCandidatesAction(studentId,query).then(result=>{
      if(active)setSearch(result.ok?{key:searchKey,rows:result.data,error:''}:{key:searchKey,rows:[],error:studentMergeError(result.code,locale)});
    }).catch(()=>{if(active)setSearch({key:searchKey,rows:[],error:studentMergeError('',locale)});});},250);
    return()=>{active=false;clearTimeout(timer);};
  },[open,studentId,query,searchKey,locale,revision]);
  useEffect(()=>{
    if(!open)return;
    let active=true;
    void getStudentMergeHistoryAction(studentId).then(result=>{if(active){if(result.ok){setHistory(result.data);setHistoryError('');}else setHistoryError(studentMergeError(result.code,locale));}})
      .catch(()=>{if(active)setHistoryError(studentMergeError('',locale));});
    return()=>{active=false;};
  },[open,studentId,locale,revision]);
  const loadPreview=async(keptId:string,mergedId:string,retainChoices=false)=>{
    const request=++sequence.current;setLoading(true);setError('');
    try {
      const result=await previewStudentMergeAction(keptId,mergedId);
      if(request!==sequence.current)return;
      if(!result.ok){setError(studentMergeError(result.code,locale));return;}
      setReview(result.data);setChoices(current=>retainChoices?{...defaultStudentMergeChoices(result.data),...current}:defaultStudentMergeChoices(result.data));
      setChecked(false);setReloadRequired(false);
    }catch{if(request===sequence.current)setError(studentMergeError('',locale));}
    finally{if(request===sequence.current)setLoading(false);}
  };
  const confirm=async()=>{
    if(saving.current||!review||!checked||!reason.trim()||reloadRequired||review.blockers.length)return;
    saving.current=true;setPending(true);setError('');
    try{
      const result=await confirmStudentMergeAction({keptId:review.kept.id,mergedId:review.merged.id,token:review.token,choices,reason});
      if(!result.ok){setError(studentMergeError(result.code,locale));if(['MERGE_CHANGED','MERGE_CONFLICT'].includes(result.code))setReloadRequired(true);return;}
      toast.success(m.done);setOpen(false);setReview(null);setChecked(false);setReason('');
      window.dispatchEvent(new Event(STUDENT_360_REFRESH_EVENT));window.dispatchEvent(new Event(SUPPORT_REFRESH_EVENT));onSaved?.();
      if(result.data.keptId!==studentId)router.replace(`/dashboard/students/${result.data.keptId}`);
      router.refresh();
    }catch{setError(studentMergeError('',locale));}finally{saving.current=false;setPending(false);}
  };
  const display=(profile:StudentMergeProfile,field:StudentMergeField)=>{
    const value=profile.values[field];
    return value===null||value===''?m.empty:field==='status'?m.status[String(value)]??String(value):String(value);
  };
  const busy=loading||pending;
  return <Dialog open={open} onOpenChange={value=>{if(!pending){if(!value){sequence.current++;setLoading(false);}setOpen(value);}}}>
    <DialogTrigger asChild><Button type="button" variant={compact?'ghost':'secondary'} size="sm" className={compact?'h-8 gap-1.5 px-2 text-xs':undefined}><GitMerge className="size-4"/>{m.open}</Button></DialogTrigger>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
      <DialogHeader><DialogTitle>{m.title}</DialogTitle><DialogDescription>{m.description}</DialogDescription></DialogHeader>
      {!review?<div className="space-y-3">
        <p className="text-sm"><span className="text-muted">{m.kept} · </span>{name} · {phone||m.empty}</p>
        <Label className="flex items-center gap-2"><Search className="size-4 shrink-0 text-muted"/><Input value={query} onChange={event=>setQuery(event.target.value)} aria-label={m.search} placeholder={m.search} maxLength={100} disabled={busy}/></Label>
        {search.key!==searchKey?<p role="status" className="text-xs text-muted">{m.loading}</p>:search.error?<p role="alert" className="text-sm text-rose">{search.error}</p>:search.rows.length?<ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-md border border-line">{search.rows.map(profile=><li key={profile.id} className="flex items-center gap-3 px-3 py-2">
          <div className="min-w-0 flex-1 text-sm"><p className="font-medium">{profile.values.name} <span className="font-normal text-muted">{profile.values.phone||profile.values.parentPhone}</span></p>
            <p className="mt-1 truncate text-xs text-muted">{[profile.owner,profile.values.school,profile.values.parentName,profile.values.grade?`${m.fields.grade} ${profile.values.grade}`:''].filter(Boolean).join(' · ')}</p></div>
          <Button variant="secondary" size="sm" disabled={busy} aria-label={`${m.compare} ${profile.values.name}`} onClick={()=>void loadPreview(studentId,profile.id)}>{m.compare}</Button>
        </li>)}</ul>:<p className="text-xs text-muted">{m.noMatches}</p>}
      </div>:<div className="space-y-4" data-student-merge-review>
        <div className="grid gap-3 sm:grid-cols-2">{(['kept','merged'] as const).map(side=><section key={side} className="rounded-md border border-line bg-paper/60 p-3">
          <p className="text-xs text-muted">{m[side]}</p><h3 className="mt-1 text-base font-medium">{review[side].values.name}</h3>
          <p className="mt-1 text-xs text-muted">{review[side].owner||m.empty} · {new Date(review[side].createdAt).toLocaleDateString(locale,{timeZone:'Asia/Shanghai'})}</p>
          <p className="mt-2 break-all font-mono text-[10px] text-muted">{review[side].id}</p>
        </section>)}</div>
        <div className="flex flex-wrap gap-2"><Button variant="ghost" size="sm" disabled={busy} onClick={()=>void loadPreview(review.merged.id,review.kept.id)}><ArrowLeftRight className="size-3.5"/>{m.swap}</Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={()=>{setReview(null);setError('');setReloadRequired(false);setChecked(false);}}>{m.chooseOther}</Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={()=>void loadPreview(review.kept.id,review.merged.id,true)}>{m.reload}</Button></div>
        <div className="overflow-x-auto"><table className="w-full table-fixed text-xs"><thead><tr className="border-b border-line text-left text-muted"><th className="w-24 py-2"></th><th className="px-2 py-2">{m.kept}</th><th className="px-2 py-2">{m.merged}</th></tr></thead>
          <tbody className="divide-y divide-line">{STUDENT_MERGE_FIELDS.map(field=><tr key={field}><th className="py-2 text-left font-normal text-muted">{m.fields[field]}</th>{(['kept','merged'] as const).map(side=><td key={side} className="px-2 py-2 align-top">
            <label className="flex cursor-pointer items-start gap-2"><input type="radio" name={`student-merge-${field}`} aria-label={`${m.fields[field]} · ${m[side]}`} className="mt-0.5 accent-crater" checked={choices[field]===side} disabled={busy} onChange={()=>{setChoices(current=>({...current,[field]:side}));setChecked(false);}}/>
              <span className="min-w-0 whitespace-pre-wrap break-words">{display(review[side],field)}</span></label>
          </td>)}</tr>)}</tbody></table></div>
        <section className="space-y-2"><h3 className="text-sm font-medium">{m.records}</h3><p className="text-xs leading-5 text-muted">{m.preservation}</p>
          <dl className="grid gap-x-5 gap-y-2 text-xs sm:grid-cols-2">{Object.entries(review.counts).filter(([,count])=>count.kept+count.merged>0).map(([category,count])=><div key={category} className="flex justify-between gap-3 border-b border-line pb-1"><dt>{m.categories[category]??m.records}</dt><dd className="tabular-nums">{m.kept} {count.kept} · {m.merged} {count.merged}</dd></div>)}</dl>
        </section>
        {review.accounts?<p className="rounded-md border border-line p-3 text-xs tabular-nums">{m.balance}: {review.accounts.kept.balance} + {review.accounts.merged.balance} = {review.accounts.kept.balance + review.accounts.merged.balance} · {m.lessons}: {review.accounts.kept.lessons} + {review.accounts.merged.lessons} = {review.accounts.kept.lessons + review.accounts.merged.lessons}</p>:null}
        {review.blockers.length?<section className="space-y-2 rounded-md border border-rose/30 bg-cheek/20 p-3 text-sm" role="alert"><h3 className="font-medium">{m.conflicts}</h3>
          <ul className="space-y-1 text-xs">{review.blockers.map((blocker,index)=><li key={index}>{blocker.kind==='accounts'?m.accountConflict:blocker.kind==='finance'?m.financeConflict:blocker.kind==='unsupported'?m.unsupported:`${m.recordTypes[blocker.recordType??'']??m.categories[blocker.category]??m.records} · ${m.overlap}`}</li>)}</ul></section>:null}
        <Label className="grid gap-1.5 text-xs">{m.reason}<Textarea value={reason} onChange={event=>setReason(event.target.value)} placeholder={m.reasonHint} maxLength={2000} disabled={busy}/></Label>
        <Label className="flex items-start gap-2 text-xs leading-5"><Checkbox checked={checked} onCheckedChange={value=>setChecked(value===true)} disabled={busy||reloadRequired||Boolean(review.blockers.length)} className="mt-0.5"/>{m.confirmIdentity}</Label>
      </div>}
      {loading?<p role="status" className="flex items-center gap-2 text-xs text-muted"><LoaderCircle className="size-3.5 animate-spin"/>{m.loading}</p>:null}
      {error?<p role="alert" className="text-sm text-rose">{error}</p>:null}
      <div className="flex justify-end gap-2"><Button variant="ghost" disabled={pending} onClick={()=>setOpen(false)}>{m.cancel}</Button>{review?<Button disabled={busy||!checked||!reason.trim()||reloadRequired||Boolean(review.blockers.length)} onClick={()=>void confirm()}>{pending?<LoaderCircle className="size-4 animate-spin"/>:<GitMerge className="size-4"/>}{m.confirm}</Button>:null}</div>
      {!review&&(history.length>0||historyError)?<details className="border-t border-line pt-3 text-xs"><summary className="cursor-pointer font-medium">{m.history}{history.length?` · ${history.length}`:''}</summary>
        {historyError?<p className="mt-2 text-rose" role="alert">{historyError}<Button variant="ghost" size="sm" onClick={()=>setRevision(value=>value+1)}>{m.reload}</Button></p>:null}
        <ul className="mt-3 space-y-3">{history.map(item=><li key={item.id} className="rounded-md border border-line p-3"><p className="font-medium">{item.original.values.name} · {item.original.values.phone||item.original.values.parentPhone}</p>
          <p className="mt-1 text-muted">{new Date(item.at).toLocaleString(locale,{timeZone:'Asia/Shanghai'})} · {item.actor}</p><p className="mt-2 whitespace-pre-wrap">{item.reason}</p>
          <details className="mt-2"><summary className="cursor-pointer text-muted">{m.original}</summary><p className="mt-2 break-all font-mono text-[10px]">{item.mergedId}</p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">{STUDENT_MERGE_FIELDS.map(field=><div key={field} className="contents"><dt className="text-muted">{m.fields[field]}</dt><dd className="whitespace-pre-wrap break-words">{display(item.original,field)}</dd></div>)}</dl></details>
        </li>)}</ul></details>:null}
    </DialogContent>
  </Dialog>;
}