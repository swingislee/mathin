'use client';

import { useEffect, useId, useState, useTransition } from 'react';
import { useLocale } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useRouter } from '@/i18n/navigation';
import { STUDENT_360_REFRESH_EVENT } from './student-360-contract';
import { getBusinessRecordRevisionAction, saveBusinessRecordRevisionAction } from './business-record-revision-actions';
import { REVISION_FIELDS, businessRevisionMessages, businessRevisionChanges, revisionFieldLabel, revisionFieldValue, type BusinessRecordRevisionContext, type BusinessRecordRevisionTarget, type RevisionValues } from './business-record-revision-contract';

export default function BusinessRecordRevisionDialog({kind,recordId,subject,onClose}:BusinessRecordRevisionTarget & {subject?:string;onClose:()=>void}) {
  const locale=useLocale(),m=businessRevisionMessages(locale),router=useRouter(),prefix=useId();
  const [context,setContext]=useState<BusinessRecordRevisionContext|null>(null),[values,setValues]=useState<RevisionValues>({});
  const [reason,setReason]=useState(''),[error,setError]=useState(''),[reload,setReload]=useState(0),[pending,startTransition]=useTransition();
  useEffect(()=>{
    let active=true;
    getBusinessRecordRevisionAction({kind,recordId}).then(result=>{
      if(!active)return;
      if(!result.ok){setError(result.code);return;}
      setContext(result.data);setValues(Object.fromEntries(result.data.sections.map(section=>[section.relation,section.values])));setError('');
    }).catch(()=>{if(active)setError('LOAD_FAILED');});
    return ()=>{active=false;};
  },[kind,recordId,reload]);
  function update(relation:string,key:string,value:string|number|null) {
    setValues(current=>({...current,[relation]:{...current[relation],[key]:value,
      ...(relation==='activity_registrations'&&key==='reported_result'?{result_link_status:!String(value??'').trim()?'none':current[relation].result_link_status==='none'?'edition_unconfirmed':current[relation].result_link_status}:{}),
    }}));
  }
  function save() {
    if(!context)return;
    setError('');
    startTransition(async()=>{
      try {
        const result=await saveBusinessRecordRevisionAction({kind,recordId,expectedVersion:context.version,values,reason});
        if(!result.ok){setError(result.code);return;}
        toast.success(m.saved);router.refresh();window.dispatchEvent(new Event(STUDENT_360_REFRESH_EVENT));onClose();
      } catch {setError('SAVE_FAILED');}
    });
  }
  return <Dialog open onOpenChange={open=>{if(!open&&!pending)onClose();}}>
    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl" onClick={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()}>
      <DialogHeader><DialogTitle>{subject ? `${subject} · ${m.title}` : m.title}</DialogTitle><DialogDescription>{m.hint}</DialogDescription></DialogHeader>
      {error&&<p role="alert" className="text-sm text-rose">{error==='REVISION_CONFLICT'?m.conflict:error==='VALIDATION'?m.invalid:error==='NO_CHANGES'?m.noChanges:m.failed}</p>}
      {(!context&&!error)&&<p role="status" className="text-sm text-muted">{m.loading}</p>}
      {error&&<Button type="button" variant="secondary" disabled={pending} onClick={()=>{setContext(null);setError('');setReload(value=>value+1);}}>{m.retry}</Button>}
      {context&&<form id={`${prefix}-form`} className="space-y-5" onSubmit={event=>{event.preventDefault();save();}}>
        {context.sections.map(section=>{
          const definition=REVISION_FIELDS[section.relation];
          if(!definition)return null;
          return <fieldset key={section.relation} disabled={pending} className="min-w-0 space-y-3">
            <legend className="mb-2 text-sm font-medium">{locale==='zh'?definition.zh:definition.en}</legend>
            <div className="grid gap-3 sm:grid-cols-2">{definition.fields.map(field=>{
              const id=`${prefix}-${section.relation}-${field.key}`,value=values[section.relation]?.[field.key],label=locale==='zh'?field.zh:field.en;
              return <div key={field.key} className={field.type==='textarea'?'space-y-1.5 sm:col-span-2':'space-y-1.5'}>
                <Label htmlFor={id}>{label}</Label>
                {field.options?<Select value={value==null?'$unknown':String(value)} onValueChange={value=>update(section.relation,field.key,value==='$unknown'?null:value)} disabled={pending}>
                  <SelectTrigger id={id} className="w-full"><SelectValue/></SelectTrigger>
                  <SelectContent>{field.nullable&&<SelectItem value="$unknown">{m.unknown}</SelectItem>}{field.options.map(option=><SelectItem key={option[0]} value={option[0]}>{option[locale==='zh'?1:2]}</SelectItem>)}</SelectContent>
                </Select>:field.type==='textarea'?<Textarea id={id} value={value==null?'':String(value)} rows={5} onChange={event=>update(section.relation,field.key,event.target.value)}/>
                  :<Input id={id} type={field.type??'text'} step={field.key==='amount'?'0.01':field.type==='number'?'1':undefined} value={value??''} placeholder={field.nullable?m.unknown:undefined} onChange={event=>update(section.relation,field.key,event.target.value===''&&field.nullable?null:field.type==='number'?event.target.valueAsNumber:event.target.value)}/>}
              </div>;
            })}</div>
          </fieldset>;
        })}
        <div className="space-y-1.5"><Label htmlFor={`${prefix}-reason`}>{m.reason}</Label><Textarea id={`${prefix}-reason`} value={reason} maxLength={1000} rows={2} disabled={pending} onChange={event=>setReason(event.target.value)}/></div>
      </form>}
      {context&&<details className="text-sm"><summary className="cursor-pointer text-muted">{m.history} · {context.revisions.length}</summary>
        {!context.revisions.length?<p className="mt-3 text-muted">{m.empty}</p>:<ol className="mt-3 divide-y divide-line">{context.revisions.map(revision=><li key={revision.id} className="space-y-2 py-3">
          <p className="text-xs text-muted">{new Intl.DateTimeFormat(locale,{dateStyle:'short',timeStyle:'short'}).format(new Date(revision.recorded_at))} · {revision.recorded_by||m.unknown}</p>
          {revision.reason&&<p className="whitespace-pre-wrap">{revision.reason}</p>}
          <dl className="space-y-2">{businessRevisionChanges(revision).map(change=><div key={`${change.relation}:${change.key}`}><dt className="text-xs font-medium">{revisionFieldLabel(change.relation,change.key,locale)}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-xs"><span className="text-muted">{revisionFieldValue(change.relation,change.key,change.before,locale)}</span><span className="mx-2">→</span>{revisionFieldValue(change.relation,change.key,change.after,locale)}</dd></div>)}</dl>
        </li>)}</ol>}
      </details>}
      <DialogFooter><Button type="button" variant="secondary" onClick={onClose} disabled={pending}>{m.cancel}</Button><Button type="submit" form={`${prefix}-form`} disabled={!context||pending||error==='REVISION_CONFLICT'}>{m.save}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
