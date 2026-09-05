"use client";
import { useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Search } from 'lucide-react';
import { useAction } from '@/components/action-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DashboardPage, DashboardCommandPanel, DashboardCommandState, DashboardCommandFilters, DashboardCommandActions, DashboardSection, DashboardTableShell, DashboardTableColumnHeader } from './dashboard-page';
import { DashboardInlineEntry } from './dashboard-page/DashboardInlineEntry';
import { useDashboardTableView } from './dashboard-page/useDashboardTableView';
import { Student360Trigger } from './Student360Sheet';
import { RenewalNavTabs } from './RenewalNavTabs';
import { CreateCycleDialog } from './RenewalPoolWorkspace';
import type { RenewalWorkspaceData } from './renewals';
import type { RenewalPoolSupplement } from './renewal-pool-data';
import { renewalHealthSignals } from './renewal-health-contract';
import { registerRenewalResultAction } from './renewal-pool-actions';
import { createTeacherProfessionalSignalAction, setRenewalCycleStatusAction, snapshotRenewalCycleMembershipsAction } from './actions/renewals';
import { TEACHER_PROFESSIONAL_SIGNAL_TYPES, type TeacherProfessionalSignalType } from './renewal-contract';
import { useRouter } from '@/i18n/navigation';

type PoolRow={membershipId:string;studentId:string;name:string;grade:number|null;classroom:string;owner:string;stage:string;note:string;opportunityId:string|null};
type ResultStage='considering'|'payment_pending'|'enrolled'|'not_enrolled'|'nurturing';
const resultStages:ResultStage[]=['considering','payment_pending','enrolled','not_enrolled','nurturing'];
export function RenewalStudentPool({data,supplement,canWrite,canReview,canEnroll,settings=false}:{data:RenewalWorkspaceData;supplement:RenewalPoolSupplement;canWrite:boolean;canReview:boolean;canEnroll:boolean;settings?:boolean}) {
  const t=useTranslations('school.renewals.poolV2');
  const legacy=useTranslations('school.renewals');
  const locale=useLocale();
  const router=useRouter();
  const [query,setQuery]=useState('');
  const [editing,setEditing]=useState<{row:PoolRow;stage:ResultStage}|null>(null);
  const [entryBusy,setEntryBusy]=useState(false);
  const [observing,setObserving]=useState<PoolRow|null>(null);
  const [healthRow,setHealthRow]=useState<PoolRow|null>(null);
  const [createOpen,setCreateOpen]=useState(false);
  const [closeCycleOpen,setCloseCycleOpen]=useState(false);
  const cycle=data.cycles.find(row=>row.id===data.selectedCycleId);
  const facts=new Map(supplement.health.map(row=>[row.studentId,row]));
  const signalsFor=(row:PoolRow)=>renewalHealthSignals(facts.get(row.studentId),supplement.now);
  const healthLevel=(row:PoolRow)=>{const signals=signalsFor(row);return signals.some(signal=>signal.level==='attention')?'attention':signals.some(signal=>signal.level==='unknown')?'unknown':'observed';};
  const rows:PoolRow[]=[...data.candidates.map(row=>({membershipId:row.membershipId,studentId:row.studentId,name:row.studentName,grade:row.grade,classroom:row.classroomName,owner:row.currentOwnerName,stage:'unprepared',note:'',opportunityId:null})),...data.opportunities.filter(row=>row.opportunityType==='renewal'&&row.cycleId===cycle?.id&&row.sourceMembershipId).map(row=>({membershipId:row.sourceMembershipId!,studentId:row.studentId,name:row.studentName,grade:row.grade,classroom:row.sourceClassroomName,owner:row.ownerName,stage:row.stage,note:row.note,opportunityId:row.id}))];
  const stageLabel=(stage:string,opportunityId?:string|null)=>stage==='enrolled'&&!supplement.payments.some(payment=>payment.opportunity_id===opportunityId)?legacy('stage_enrolled'):stage==='unprepared'?t('unprepared'):resultStages.includes(stage as ResultStage)?t(stage as ResultStage):legacy(`stage_${stage}`);
  const filtered=rows.filter(row=>[row.name,row.classroom,row.owner].some(value=>value.toLocaleLowerCase(locale).includes(query.trim().toLocaleLowerCase(locale))));
  const columns={
    name:{filterValues:(row:PoolRow)=>({value:row.studentId,label:row.name}),sortValue:(row:PoolRow)=>row.name},
    classroom:{filterValues:(row:PoolRow)=>({value:row.classroom,label:row.classroom}),sortValue:(row:PoolRow)=>row.classroom},
    owner:{filterValues:(row:PoolRow)=>({value:row.owner||'none',label:row.owner||'—'}),sortValue:(row:PoolRow)=>row.owner},
    stage:{filterValues:(row:PoolRow)=>({value:row.stage==='enrolled'&&supplement.payments.some(payment=>payment.opportunity_id===row.opportunityId)?'paid':row.stage,label:stageLabel(row.stage,row.opportunityId)}),sortValue:(row:PoolRow)=>row.stage},
    health:{filterValues:(row:PoolRow)=>({value:healthLevel(row),label:t(healthLevel(row))}),sortValue:(row:PoolRow)=>signalsFor(row).filter(signal=>signal.level==='attention').length},
  };
  const table=useDashboardTableView({rows:filtered,columns,locale});
  const errors={default:legacy('actionFailed')};
  const refresh=useAction(snapshotRenewalCycleMembershipsAction,{successMessage:result=>legacy('snapshotSuccess',result),errorMessage:errors,onSuccess:()=>router.refresh()});
  const status=useAction(setRenewalCycleStatusAction,{successMessage:legacy('cycleStatusSaved'),errorMessage:errors,onSuccess:()=>{setCloseCycleOpen(false);router.refresh();}});
  return <DashboardPage title={settings?t('settings'):t('pool')} commandPanel={<DashboardCommandPanel>
    <DashboardCommandState><RenewalNavTabs active={settings?'settings':'pool'} cycleId={cycle?.id} /></DashboardCommandState>
    {!settings?<DashboardCommandFilters><div className="relative w-full max-w-96"><Search className="absolute left-3 top-3 size-4 text-muted"/><Input aria-label={t('search')} className="pl-9" placeholder={t('search')} value={query} onChange={event=>setQuery(event.target.value)}/></div></DashboardCommandFilters>:null}
    {settings&&canWrite?<DashboardCommandActions>
      {cycle?.status!=='closed'&&cycle?<Button size="sm" variant="secondary" disabled={refresh.pending} onClick={()=>refresh.run(cycle.id)}>{t('refresh')}</Button>:null}
      {cycle?.status==='open'?<Button size="sm" variant="secondary" onClick={()=>setCloseCycleOpen(true)}>{t('closeCycle')}</Button>:null}
      <CreateCycleDialog open={createOpen} onOpenChange={setCreateOpen} terms={data.terms} errors={errors} onSaved={()=>router.refresh()}/>
    </DashboardCommandActions>:null}
  </DashboardCommandPanel>}>
    {settings?<>
      <DashboardSection title={t('settings')}><div className="max-w-xl space-y-4">
        <Label>{t('cycle')}<Select value={cycle?.id??''} onValueChange={id=>router.replace(`/dashboard/renewals?tab=settings&cycle=${id}`)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{data.cycles.map(item=><SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></Label>
        {cycle?<><p>{cycle.sourceTermName} → {cycle.targetTermName}</p><p>{legacy(`cycleStatus_${cycle.status}`)} · {cycle.preparationStartsOn||'—'} — {cycle.decisionDueOn||'—'}</p>
          {canWrite&&cycle.status==='planning'?<Button disabled={status.pending} onClick={()=>status.run(cycle.id,'open')}>{legacy('openCycle')}</Button>:null}
        </>:null}
      </div></DashboardSection>
      <DashboardSection title={t('healthPolicy')} description={t('healthHint')}><dl className="max-w-3xl space-y-4">{['communication','attendance','participation','challenge','homework','accuracy','video','trend'].map(key=><div key={key}><dt className="font-medium">{t(key)}</dt><dd className="mt-1 text-sm text-muted">{t(`${key}Rule`)}</dd></div>)}</dl></DashboardSection>
    </>:<DashboardTableShell><Table className="min-w-[68rem]"><TableHeader><TableRow>
      <TableHead><DashboardTableColumnHeader label={t('student')} {...table.columnProps('name')}/></TableHead>
      <TableHead><DashboardTableColumnHeader label={t('classroom')} {...table.columnProps('classroom')}/></TableHead>
      <TableHead><DashboardTableColumnHeader label={t('owner')} {...table.columnProps('owner')}/></TableHead>
      <TableHead><DashboardTableColumnHeader label={t('health')} {...table.columnProps('health')}/></TableHead>
      <TableHead>{t('observation')}</TableHead>
      <TableHead><DashboardTableColumnHeader label={t('result')} {...table.columnProps('stage')}/></TableHead>
      <TableHead><DashboardTableColumnHeader label={t('cycle')} filterValue={cycle?.id} filterOptions={data.cycles.map(item=>({value:item.id,label:item.name}))} onFilterChange={id=>router.replace(`/dashboard/renewals${id?`?cycle=${id}`:''}`)} onClear={()=>router.replace('/dashboard/renewals')}/></TableHead>
    </TableRow></TableHeader><TableBody>{table.visibleRows.map(row=>{
      const payment=supplement.payments.find(item=>item.opportunity_id===row.opportunityId);
      const observation=supplement.signals.find(item=>item.student_id===row.studentId);
      const active=editing?.row.membershipId===row.membershipId||observing?.membershipId===row.membershipId;
      return <TableRow key={row.membershipId} aria-expanded={active} aria-selected={active} className={active?'bg-moon/10 hover:bg-moon/10 [&>td]:align-top':'[&>td]:align-top'}>
        <TableCell><Student360Trigger subject={{studentId:row.studentId,leadId:null}} fallback={{name:row.name,grade:row.grade}}/></TableCell>
        <TableCell>{row.classroom}</TableCell><TableCell>{row.owner||'—'}</TableCell>
        <TableCell><Button size="sm" variant="ghost" className={healthLevel(row)==='attention'?'text-rose':''} onClick={()=>setHealthRow(row)}>{t(healthLevel(row))}{healthLevel(row)==='attention'?` · ${signalsFor(row).filter(signal=>signal.level==='attention').length}`:''}</Button></TableCell>
        <TableCell className="max-w-56 whitespace-normal"><p className="line-clamp-2 text-xs text-muted" title={observation?.recommendation}>{observation?.recommendation||t('noObservation')}</p>{canReview&&supplement.observationMemberships.includes(row.membershipId)?<Button size="sm" variant="ghost" disabled={entryBusy} aria-expanded={observing?.membershipId===row.membershipId} onClick={()=>{setEditing(null);setObserving(current=>current?.membershipId===row.membershipId?null:row);}}>{t('observe')}</Button>:null}{observing?.membershipId===row.membershipId?<ObservationPanel row={row} onBusy={setEntryBusy} onClose={()=>setObserving(null)}/>:null}</TableCell>
        <TableCell><div className="flex items-center gap-2"><Badge variant="outline">{stageLabel(row.stage,row.opportunityId)}</Badge>
          {canWrite&&cycle?.status==='open'?<Button size="sm" variant="ghost" disabled={entryBusy} aria-expanded={editing?.row.membershipId===row.membershipId} onClick={()=>{setObserving(null);setEditing(current=>current?.row.membershipId===row.membershipId?null:{row,stage:resultStages.includes(row.stage as ResultStage)?row.stage as ResultStage:'considering'});}}>{t('details')}</Button>:null}</div>
          {row.stage==='enrolled'?<p className="mt-1 text-xs text-muted">{payment?t('paidSummary',{periods:payment.period_count,amount:Number(payment.paid_amount).toFixed(2)}):t('paymentMissing')}</p>:canWrite&&cycle?.status==='open'?<div className="mt-1 flex gap-1">{(['considering','enrolled','not_enrolled'] as const).filter(stage=>stage!=='enrolled'||canEnroll).map(stage=><Button key={stage} size="sm" variant="ghost" disabled={entryBusy} aria-pressed={editing?.row.membershipId===row.membershipId&&editing.stage===stage} onClick={()=>{setObserving(null);setEditing({row,stage});}}>{t(stage)}</Button>)}</div>:null}
          {editing?.row.membershipId===row.membershipId&&cycle?<RegistrationPanel key={row.membershipId} row={row} initialStage={editing.stage} onStageChange={stage=>setEditing(current=>current?{...current,stage}:null)} cycleId={cycle.id} payment={payment} canEnroll={canEnroll} onBusy={setEntryBusy} onClose={()=>setEditing(null)} onSaved={advance=>{
            const index=table.visibleRows.findIndex(item=>item.membershipId===row.membershipId);
            const next=advance?table.visibleRows.slice(index+1).find(item=>['unprepared','planning','contacted','considering','payment_pending'].includes(item.stage)):undefined;
            setEditing(current=>current?.row.membershipId===row.membershipId?(next?{row:next,stage:next.stage==='payment_pending'?'payment_pending':'considering'}:null):current);
            router.refresh();
          }}/>:null}
        </TableCell><TableCell className="max-w-40 whitespace-normal text-xs text-muted">{cycle?.name}</TableCell>
      </TableRow>;
    })}{!table.visibleRows.length?<TableRow><TableCell colSpan={7} className="h-40 text-center text-muted">{t('noRows')}<p className="mt-2 text-xs">{t('readyHint')}</p></TableCell></TableRow>:null}</TableBody></Table></DashboardTableShell>}
    <ConfirmDialog open={closeCycleOpen} onOpenChange={setCloseCycleOpen} title={legacy('closeCycleTitle')} description={legacy('closeCycleDescription')} confirmLabel={legacy('closeCycleConfirm')} cancelLabel={t('cancel')} pending={status.pending} onConfirm={()=>cycle&&status.run(cycle.id,'closed')}/>
    <Sheet open={!!healthRow} onOpenChange={open=>!open&&setHealthRow(null)}><SheetContent className="w-[min(94vw,38rem)]" closeLabel={t('close')}><SheetHeader><SheetTitle>{healthRow?.name} · {t('healthTitle')}</SheetTitle><SheetDescription>{t('healthHint')}</SheetDescription></SheetHeader><div className="mt-6 space-y-5">{healthRow?signalsFor(healthRow).map(signal=><div key={signal.key}><div className="flex justify-between gap-2"><strong>{t(signal.key)}</strong><Badge variant="outline">{t(signal.level)}</Badge></div>{signal.key!=='unavailable'?<><p className="mt-1 text-sm">{t('counts',{count:signal.count??0,total:signal.total??0})}</p><p className="mt-1 text-xs leading-5 text-muted">{t(`${signal.key}Rule`)}</p></>:null}</div>):null}</div></SheetContent></Sheet>
  </DashboardPage>;
}

function RegistrationPanel({row,initialStage,onStageChange,cycleId,payment,canEnroll,onBusy,onClose,onSaved}:{row:PoolRow;initialStage:ResultStage;onStageChange:(stage:ResultStage)=>void;cycleId:string;payment:RenewalPoolSupplement['payments'][number]|undefined;canEnroll:boolean;onBusy:(busy:boolean)=>void;onClose:()=>void;onSaved:(advance:boolean)=>void}) {
  const t=useTranslations('school.renewals.poolV2');
  const legacy=useTranslations('school.renewals');
  const contactT=useTranslations('school.leads');
  const advanceRef=useRef(false);
  const stage=initialStage;
  const setStage=onStageChange;
  const [note,setNote]=useState(payment?.note??row.note);
  const [periods,setPeriods]=useState(payment?String(payment.period_count):'');
  const [amount,setAmount]=useState(payment?String(payment.paid_amount):'');
  const action=useAction(async (input:Parameters<typeof registerRenewalResultAction>[0])=>{
    onBusy(true);
    try { return await registerRenewalResultAction(input); } finally { onBusy(false); }
  },{successMessage:legacy('opportunitySaved'),errorMessage:{default:legacy('actionFailed'),INVALID_CYCLE_STATE:legacy('invalidCycleState')},onSuccess:()=>onSaved(advanceRef.current)});
  const paid=stage==='enrolled';
  const valid=!paid||(canEnroll&&Number.isInteger(Number(periods))&&Number(periods)>=1&&Number(periods)<=24&&Number(amount)>0&&Number.isFinite(Number(amount)));
  const submit=(advance:boolean)=>{
    if(action.pending||!valid)return;
    advanceRef.current=advance;
    action.run({cycleId,membershipId:row.membershipId,stage,note,periodCount:paid?Number(periods):null,paidAmount:paid?Number(amount):null});
  };
  return <DashboardInlineEntry title={`${row.name} · ${t('details')}`} closeLabel={t('close')} onClose={onClose} onSubmit={()=>submit(true)} pending={action.pending} autoFocus>
    <div className="min-w-96 space-y-3" inert={action.pending||undefined}>
      <Label className="text-xs">{t('result')}<Select value={stage} disabled={row.stage==='enrolled'} onValueChange={value=>setStage(value as ResultStage)}><SelectTrigger className="mt-1 h-8"><SelectValue/></SelectTrigger><SelectContent>{resultStages.filter(value=>value!=='enrolled'||canEnroll||row.stage==='enrolled').map(value=><SelectItem key={value} value={value}>{t(value)}</SelectItem>)}</SelectContent></Select></Label>
      {paid?<div className="grid grid-cols-2 gap-3"><Label className="text-xs">{t('periods')}<Input className="mt-1 h-8" type="number" min={1} max={24} step={1} value={periods} onChange={event=>setPeriods(event.target.value)}/></Label><Label className="text-xs">{t('amount')}<Input className="mt-1 h-8" type="number" min="0.01" step="0.01" value={amount} onChange={event=>setAmount(event.target.value)}/></Label></div>:null}
      <Label className="text-xs">{t('note')}<Textarea className="mt-1 min-h-20 text-xs" rows={3} value={note} maxLength={2000} onChange={event=>setNote(event.target.value)}/></Label>
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onClose}>{t('cancel')}</Button>
        <Button size="sm" variant="secondary" disabled={action.pending||!valid} onClick={()=>submit(false)}>{t('save')}</Button>
        <Button size="sm" disabled={action.pending||!valid} onClick={()=>submit(true)}><Check className="size-3.5"/>{contactT('saveContactRow')}</Button>
      </div>
    </div>
  </DashboardInlineEntry>;
}
function ObservationPanel({row,onBusy,onClose}:{row:PoolRow;onBusy:(busy:boolean)=>void;onClose:()=>void}) {
  const t=useTranslations('school.renewals.poolV2');const legacy=useTranslations('school.renewals');const router=useRouter();
  const [type,setType]=useState<TeacherProfessionalSignalType>('churn_risk');const [note,setNote]=useState('');
  const action=useAction(async (input:Parameters<typeof createTeacherProfessionalSignalAction>[0])=>{
    onBusy(true);
    try {return await createTeacherProfessionalSignalAction(input);} finally {onBusy(false);}
  },{successMessage:legacy('opportunitySaved'),errorMessage:{default:legacy('actionFailed')},onSuccess:()=>{onClose();router.refresh();}});
  const submit=()=>{
    if(action.pending||!note.trim())return;
    action.run({studentId:row.studentId,sourceMembershipId:row.membershipId,sourceSessionId:null,signalType:type,recommendation:note,suggestedCourseId:null,targetTermId:null});
  };
  return <DashboardInlineEntry title={`${row.name} · ${t('observe')}`} closeLabel={t('close')} onClose={onClose} onSubmit={submit} pending={action.pending} autoFocus>
    <div className="min-w-72 space-y-3" inert={action.pending||undefined}>
      <Label className="text-xs">{t('signalType')}<Select value={type} onValueChange={value=>setType(value as TeacherProfessionalSignalType)}><SelectTrigger className="mt-1 h-8"><SelectValue/></SelectTrigger><SelectContent>{TEACHER_PROFESSIONAL_SIGNAL_TYPES.map(value=><SelectItem key={value} value={value}>{legacy(`signalType_${value}`)}</SelectItem>)}</SelectContent></Select></Label>
      <Label className="text-xs">{t('recommendation')}<Textarea className="mt-1 text-xs" rows={3} value={note} maxLength={2000} onChange={event=>setNote(event.target.value)}/></Label>
      <Button size="sm" disabled={action.pending||!note.trim()} onClick={submit}>{t('save')}</Button>
    </div>
  </DashboardInlineEntry>;
}
