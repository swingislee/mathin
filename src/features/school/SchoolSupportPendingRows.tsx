'use client';

import { Fragment, useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { TableCell, TableRow } from '@/components/ui/table';
import { useRouter } from '@/i18n/navigation';
import { getSupportOptionsAction, listSupportWorkAction, updateSupportWorkAction } from './school-support-actions';
import { getStudentStageSubjectAction } from './student-stage-actions';
import { SUPPORT_REFRESH_EVENT, supportError, supportMessages, type SupportItem, type SupportWork, type SupportWorkspace } from './school-support-contract';
import { SupportWorkFields, type SupportOptions } from './SchoolSupportEntry';
import { SchoolSupportProfileButton } from './SchoolSupportProfile';
import { StudentStageEntry } from './StudentStageEntry';
import type { StudentStageRow } from './student-stage-contract';
import { Student360Trigger } from './Student360Sheet';
import { STUDENT_360_REFRESH_EVENT } from './student-360-contract';

function PendingWorkEditor({item,onSaved}:{item:SupportItem;onSaved:()=>void}) {
  const locale=useLocale(),m=supportMessages(locale),router=useRouter();
  const [work,setWork]=useState<SupportWork>({note:item.note,courseId:item.courseId,termId:item.termId,date:item.workDate,cycleId:item.cycleId});
  const [options,setOptions]=useState<SupportOptions|null>(null),[row,setRow]=useState<StudentStageRow|null>(null),[error,setError]=useState(''),[pending,setPending]=useState(false),[showEntry,setShowEntry]=useState(false);
  useEffect(()=>{let active=true;void getSupportOptionsAction().then(result=>{if(active){if(result.ok)setOptions(result.data);else setError(supportError(result.code,locale));}}).catch(()=>{if(active)setError(supportError('',locale));});return()=>{active=false;};},[locale]);
  const save=async(closed=false)=>{
    setPending(true);setError('');
    try{const result=await updateSupportWorkAction(item.id,item.revision,{...work,closed});if(!result.ok){setError(supportError(result.code,locale));return;}onSaved();router.refresh();}
    catch{setError(supportError('',locale));}finally{setPending(false);}
  };
  const openEntry=async()=>{
    setPending(true);setError('');
    try{const result=await getStudentStageSubjectAction({studentId:item.studentId,leadId:item.leadId});if(!result.ok){setError(supportError(result.code,locale));return;}setRow(result.data);setShowEntry(true);}
    catch{setError(supportError('',locale));}finally{setPending(false);}
  };
  return <div className="space-y-3 p-3">
    <div className="flex flex-wrap items-center gap-2"><SchoolSupportProfileButton studentId={item.studentId} leadId={item.leadId} onSaved={onSaved}/>
      {item.studentId&&item.canWrite?<Button type="button" variant="secondary" size="sm" disabled={pending} onClick={()=>void openEntry()}>{m.continue}</Button>:null}</div>
    {options?<SupportWorkFields workspace={item.workspace} work={work} onChange={setWork} options={options} locale={locale} disabled={pending||!item.canWrite} targetLocked={Boolean(item.opportunityId)}/>:!error?<p role="status">{m.loading}</p>:null}
    {item.canWrite?<div className="flex gap-2"><Button type="button" size="sm" disabled={pending||!options} onClick={()=>void save()}>{m.save}</Button>
      <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={()=>void save(true)}>{m.close}</Button></div>:null}
    {error?<p role="alert" className="text-sm text-rose">{error}</p>:null}
    {showEntry&&row&&options?<div className="border-t border-line pt-3"><StudentStageEntry key={`${item.id}:${item.revision}`} row={row} requestedMode={item.workspace==='enrollments'||item.workspace==='renewals'?'enrollment':'note'}
      enrollmentContext={item.workspace==='enrollments'||item.workspace==='renewals'?{type:item.workspace==='renewals'?'renewal':'new',courseId:item.courseId,termId:item.termId}:undefined}
      locale={locale} currentUserId={options.currentUserId} canEnroll={options.canEnroll} canAdvance={false} outcomeRequest={null} onBusyChange={setPending} onSaved={()=>{setShowEntry(false);onSaved();window.dispatchEvent(new Event(STUDENT_360_REFRESH_EVENT));router.refresh();}}/></div>:null}
  </div>;
}

/** 未齐资料作为原工作表中的待办行保留，形成领域记录后自然移出。 */
export function SchoolSupportPendingRows({workspace,colSpan}:{workspace:SupportWorkspace;colSpan:number}) {
  const locale=useLocale(),m=supportMessages(locale),query=useSearchParams();
  const [items,setItems]=useState<SupportItem[]>([]),[expanded,setExpanded]=useState<string|null>(query.get('manual')),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  const focus=query.get('manual');
  const [acceptedFocus,setAcceptedFocus]=useState(focus);
  if(focus!==acceptedFocus){setAcceptedFocus(focus);if(focus)setExpanded(focus);}
  useEffect(()=>{const refresh=()=>setRevision(value=>value+1);window.addEventListener(SUPPORT_REFRESH_EVENT,refresh);window.addEventListener(STUDENT_360_REFRESH_EVENT,refresh);return()=>{window.removeEventListener(SUPPORT_REFRESH_EVENT,refresh);window.removeEventListener(STUDENT_360_REFRESH_EVENT,refresh);};},[]);
  useEffect(()=>{let active=true;void listSupportWorkAction(workspace).then(result=>{if(active){if(result.ok){setItems(result.data);setError('');}else if(result.code.includes('FORBIDDEN')){setItems([]);setError('');}else setError(supportError(result.code,locale));}}).catch(()=>{if(active)setError(supportError('',locale));});return()=>{active=false;};},[workspace,locale,revision]);
  return <>{items.map(item=><Fragment key={`${item.id}:${item.revision}`}><TableRow className="bg-paper/70" data-manual-work={item.id}>
    <TableCell colSpan={colSpan} className="px-3 py-2"><div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Student360Trigger subject={{studentId:item.studentId,leadId:item.leadId}} fallback={{name:item.name,phone:item.phone,grade:item.grade}}>{item.name}</Student360Trigger>
      <span className="text-xs text-muted">{item.phone} · {m.pending}{item.identityPending?` · ${m.identity}`:''}</span><span className="min-w-0 flex-1 text-xs">{[item.courseTitle,item.termName,item.note].filter(Boolean).join(' · ')}</span>
      <Button type="button" variant="secondary" size="sm" aria-expanded={expanded===item.id} onClick={()=>setExpanded(value=>value===item.id?null:item.id)}>{m.continue}</Button>
    </div></TableCell>
  </TableRow>{expanded===item.id?<TableRow><TableCell colSpan={colSpan} className="p-0"><PendingWorkEditor item={item} onSaved={()=>setRevision(value=>value+1)}/></TableCell></TableRow>:null}</Fragment>)}
    {error?<TableRow><TableCell colSpan={colSpan} className="text-xs text-rose"><span role="alert">{error}</span><Button variant="ghost" size="sm" onClick={()=>setRevision(value=>value+1)}>{m.retry}</Button></TableCell></TableRow>:null}
  </>;
}
