'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useRouter } from '@/i18n/navigation';
import { readSupportProfileAction, resolveSupportIdentityAction, updateSupportProfileAction } from './school-support-actions';
import { SUPPORT_REFRESH_EVENT, supportError, supportMessages, type SupportCandidate, type SupportProfile } from './school-support-contract';
import { SupportChoice, SupportSubjectSearch } from './SchoolSupportEntry';
import { STUDENT_360_REFRESH_EVENT } from './student-360-contract';

export function SchoolSupportProfileButton({studentId,leadId,onSaved}:{studentId:string|null;leadId:string|null;onSaved?:()=>void}) {
  const locale=useLocale(),m=supportMessages(locale),router=useRouter();
  const [open,setOpen]=useState(false),[profile,setProfile]=useState<SupportProfile|null>(null),[values,setValues]=useState<SupportProfile['values']|null>(null);
  const [error,setError]=useState(''),[pending,setPending]=useState(false),[revision,setRevision]=useState(0),[conflict,setConflict]=useState(false);
  const [candidate,setCandidate]=useState<SupportCandidate|null>(null),[identityOpen,setIdentityOpen]=useState(false);
  const [reviewLatest,setReviewLatest]=useState(false);
  useEffect(()=>{
    if(!open)return;let active=true;
    void readSupportProfileAction({studentId,leadId}).then(result=>{
      if(!active)return;
      if(result.ok){setProfile(result.data);setValues(current=>conflict&&current?current:result.data.values);setReviewLatest(conflict);setError('');setConflict(false);}
      else setError(supportError(result.code,locale));
    }).catch(()=>{if(active)setError(supportError('',locale));});return()=>{active=false;};
    // 冲突草稿只在用户明确重新读取时与最新档案并排核对。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[open,studentId,leadId,locale,revision]);
  const saved=(next:SupportProfile)=>{setProfile(next);setValues(next.values);setConflict(false);setReviewLatest(false);setError('');setCandidate(null);setIdentityOpen(false);
    toast.success(m.saved);window.dispatchEvent(new Event(SUPPORT_REFRESH_EVENT));window.dispatchEvent(new Event(STUDENT_360_REFRESH_EVENT));router.refresh();onSaved?.();};
  const save=async()=>{
    if(!profile||!values||pending||conflict)return;setPending(true);setError('');
    try{const result=await updateSupportProfileAction({...profile,values});if(result.ok)saved(result.data);else{setError(supportError(result.code,locale));setConflict(result.code==='PROFILE_CONFLICT');}}
    catch{setError(supportError('',locale));}finally{setPending(false);}
  };
  const resolve=async(target:string|null)=>{
    if(!profile?.leadId||pending)return;setPending(true);setError('');
    try{const result=await resolveSupportIdentityAction(profile.leadId,target,profile.version);if(result.ok)saved(result.data);else{setError(supportError(result.code,locale));setConflict(result.code==='PROFILE_CONFLICT');}}
    catch{setError(supportError('',locale));}finally{setPending(false);}
  };
  const fields=(profile?.values.parentName!==undefined?['name','phone','parentPhone','parentName','school','wechat']:['name','phone']) as Array<'name'|'phone'|'parentPhone'|'parentName'|'school'|'wechat'>;
  return <Dialog open={open} onOpenChange={value=>{if(!pending){setOpen(value);if(!value){setProfile(null);setValues(null);setConflict(false);}}}}><DialogTrigger asChild><Button variant="ghost" type="button" size="sm">{m.edit}</Button></DialogTrigger>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{m.edit}</DialogTitle><DialogDescription>{profile?.values.name||m.details}</DialogDescription></DialogHeader>
      {profile&&values?<div className="space-y-4">
        {reviewLatest?<div className="space-y-1 rounded-md border border-line bg-paper p-3 text-xs"><p>{locale==='en'?'Compare the latest profile with your retained draft before saving.':'已重新读取最新档案，请核对以下字段与保留的草稿后保存。'}</p>
          {(Object.keys(values) as Array<keyof SupportProfile['values']>).filter(key=>values[key]!==profile.values[key]).map(key=><p key={key}>{m[key]}: {String(profile.values[key]??'—')} → {String(values[key]??'—')}</p>)}</div>:null}
        <div className="grid gap-3 sm:grid-cols-2">{fields.map(field=><Label key={field} className="grid gap-1.5 text-xs">{m[field]}<Input value={values[field]??''} disabled={pending||!profile.canEdit} maxLength={field.toLowerCase().includes('phone')?40:field==='wechat'?80:100} onChange={e=>setValues({...values,[field]:e.target.value})}/></Label>)}
          <SupportChoice label={m.grade} value={values.grade?.toString()??''} disabled={pending||!profile.canEdit} onChange={value=>setValues({...values,grade:value?Number(value):null})} options={[{value:'',label:m.unknown},...Array.from({length:12},(_,i)=>({value:String(i+1),label:String(i+1)}))]}/>
          <Label className="grid gap-1.5 text-xs sm:col-span-2">{m.remark}<Textarea value={values.remark} maxLength={2000} disabled={pending||!profile.canEdit} onChange={e=>setValues({...values,remark:e.target.value})}/></Label>
        </div>
        {profile.canEdit?<div className="flex justify-end"><Button type="button" disabled={pending||conflict} onClick={()=>void save()}>{pending?m.loading:m.save}</Button></div>:null}
        {profile.canResolveIdentity&&!profile.studentId?<div className="space-y-3 border-t border-line pt-3">
          <Button type="button" size="sm" variant="secondary" disabled={pending||conflict} onClick={()=>setIdentityOpen(value=>!value)}>{m.identity}</Button>
          {identityOpen?<><SupportSubjectSearch locale={locale} studentsOnly disabled={pending} onSelect={setCandidate}/>
            {candidate?<div className="flex items-center justify-between gap-2 text-sm"><span>{candidate.name} · {candidate.phone}</span><Button type="button" disabled={pending} onClick={()=>void resolve(candidate.studentId)}>{m.link}</Button></div>:null}
            <Button type="button" variant="secondary" disabled={pending||!profile.values.name.trim()} onClick={()=>void resolve(null)}>{m.create}</Button></>:null}
        </div>:null}
        {profile.changes.length?<details className="border-t border-line pt-3 text-xs"><summary className="cursor-pointer">{m.history} ({profile.changes.length})</summary>
          <div className="mt-2 space-y-3">{profile.changes.map(change=><div key={change.id} className="space-y-1"><p className="text-muted">{change.recordedAt.slice(0,19).replace('T',' ')} · {change.recordedBy}</p>
            {(Object.keys(change.after) as Array<keyof SupportProfile['values']>).filter(key=>change.before[key]!==change.after[key]).map(key=><p key={key}>{m[key]}: {String(change.before[key]??'—')} → {String(change.after[key]??'—')}</p>)}</div>)}</div>
        </details>:null}
      </div>:!error?<p role="status">{m.loading}</p>:null}
      {error?<div role="alert" className="space-y-2 text-sm text-rose"><p>{error}</p><Button variant="secondary" disabled={pending} onClick={()=>setRevision(value=>value+1)}>{m.retry}</Button></div>:null}
    </DialogContent>
  </Dialog>;
}
