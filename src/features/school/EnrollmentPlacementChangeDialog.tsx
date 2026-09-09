'use client';
import { useEffect,useState,useTransition } from 'react';
import { useLocale } from 'next-intl';
import { LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { newId } from '@/lib/uuid';
import { Button } from '@/components/ui/button';
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { changeEnrollmentPlacementAction,previewEnrollmentSessionTransferAction } from './enrollment-placement-change-actions';
import { placementChangeError,type SessionTransferOption,type SessionTransfer } from './enrollment-placement-change-contract';
import type { EnrollmentPlacementBoard,PlacementClassroom,PlacementStudent } from './enrollment-workflow-contract';

export function EnrollmentPlacementChangeDialog({student,target,withdraw=false,transfers=[],onClose,onSaved}:{student:PlacementStudent;target?:{classroom:PlacementClassroom;seat:number};withdraw?:boolean;transfers?:SessionTransfer[];onClose:()=>void;onSaved:(board:EnrollmentPlacementBoard)=>void}){
  const en=useLocale()==='en';
  const [mode,setMode]=useState<'permanent'|'temporary'>('permanent');
  const [options,setOptions]=useState<SessionTransferOption[]|null>(null);
  const [loadError,setLoadError]=useState<string|null>(null);
  const [selected,setSelected]=useState<string[]>([]);
  const [reason,setReason]=useState('');
  const [pending,start]=useTransition();
  const [requestId,setRequestId]=useState(()=>newId());
  const [retry,setRetry]=useState(0);
  const change=()=>setRequestId(newId());
  useEffect(()=>{
    if(mode!=='temporary'||!target||!student.membershipId)return;
    let active=true;
    previewEnrollmentSessionTransferAction({membershipId:student.membershipId,classroomId:target.classroom.id,seat:target.seat}).then(result=>{
      if(!active)return;
      if(result.ok)setOptions(result.data);else setLoadError(placementChangeError(result.code,en));
    });
    return()=>{active=false;};
  },[mode,target,student.membershipId,en,retry]);
  const time=(at:string|null)=>at?new Intl.DateTimeFormat(en?'en-GB':'zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Shanghai'}).format(new Date(at)):(en?'Time pending':'时间待定');
  const save=(cancel?:SessionTransfer)=>start(async()=>{
    const result=await changeEnrollmentPlacementAction({requestId,mode:cancel?'cancel_temporary':withdraw?'withdraw':mode,
      enrollmentId:student.enrollmentId,membershipId:student.membershipId,fromClassroomId:student.classroomId,toClassroomId:cancel?cancel.toClassroomId:target?.classroom.id??null,
      seat:target?.seat??null,expectedSeat:student.seat,reason,transferId:cancel?.id??null,
      sessions:!cancel&&!withdraw&&mode==='temporary'?(options??[]).filter(s=>selected.includes(s.sessionId)).map(({sessionId,version})=>({sessionId,version})):[]});
    if(!result.ok){toast.error(placementChangeError(result.code,en));return;}
    toast.success(en?'Saved':cancel?'已取消这次临时安排':withdraw?'已退课':mode==='temporary'?'已安排所选讲次的临时调班':'已完全调班');onSaved(result.data);
  });
  return <Dialog open onOpenChange={open=>{if(!open&&!pending)onClose();}}><DialogContent className="sm:max-w-xl"><DialogHeader>
    <DialogTitle>{withdraw?(en?'Withdraw enrollment':'确认退课'):target?(en?'Confirm class transfer':'确认调班'):(en?'Temporary transfers':'临时调班安排')}</DialogTitle>
    <DialogDescription>{student.name}{target?` → ${target.classroom.name} · ${target.seat}${en?' seat':' 号位'}`:''}</DialogDescription>
  </DialogHeader>
    {withdraw?<p className="text-sm leading-6">{en?'End this enrollment and release its seat. Attendance and course history remain available. Future temporary transfers will be cancelled. Refunds are handled in the payment workflow.':'结束本次报名并释放座位，保留已有考勤和课程记录，同时取消尚未上课的临时安排。退款在收付款流程中办理。'}</p>:target?<>
      <fieldset className="grid grid-cols-2 gap-2" disabled={pending}><legend className="sr-only">{en?'Transfer type':'调班类型'}</legend>{(['permanent','temporary'] as const).map(value=><label key={value} className="flex cursor-pointer items-center gap-2 rounded-md border border-line p-3 text-sm"><input type="radio" name="placement-transfer-mode" value={value} checked={mode===value} onChange={()=>{setMode(value);change();}}/>{value==='permanent'?(en?'Permanent transfer':'完全调班'):(en?'Temporary transfer':'临时调班')}</label>)}</fieldset>
      <p className="text-xs leading-5 text-muted">{mode==='permanent'?(en?'Move the enrollment to the target class for remaining lessons. Cancel pending temporary arrangements.':'后续课程转入目标班，取消尚未上课的临时安排。'):(en?'Attend only the selected lessons in the target class. Keep the original class for other lessons.':'仅所选讲次到目标班上课，原班对应讲次移出名单，其余讲次继续在原班。')}</p>
      {mode==='temporary'?<div className="max-h-64 overflow-y-auto rounded-md border border-line p-2">
        {loadError?<div role="alert" className="space-y-2 p-2 text-sm"><p>{loadError}</p><Button size="sm" variant="secondary" onClick={()=>{setLoadError(null);setOptions(null);setSelected([]);change();setRetry(v=>v+1);}}>{en?'Reload':'重新读取'}</Button></div>:options===null?<p role="status" className="flex gap-2 p-2 text-sm"><LoaderCircle className="size-4 animate-spin"/>{en?'Loading lessons…':'正在读取讲次…'}</p>:!options.length?<p className="p-2 text-sm text-muted">{en?'No unstarted lessons in this class.':'目标班暂无未上课的讲次。'}</p>:options.map(s=><label key={s.sessionId} className="flex items-start gap-2 border-b border-line p-2 text-sm last:border-0"><input type="checkbox" className="mt-1" disabled={pending||Boolean(s.blocked)} checked={selected.includes(s.sessionId)} onChange={e=>{setSelected(v=>e.target.checked?[...v,s.sessionId]:v.filter(id=>id!==s.sessionId));change();}}/><span className="min-w-0"><span>{s.lectureNo!==null?(en?`Lesson ${s.lectureNo} · `:`第 ${s.lectureNo} 讲 · `):''}{s.title}</span><span className="block text-xs text-muted">{time(s.scheduledAt)} · {en?'Original class: ':'原班：'}{time(s.sourceScheduledAt)}</span>{s.blocked?<span className="block text-xs text-rose">{placementChangeError(s.blocked,en)}</span>:null}</span></label>)}
      </div>:null}
    </>:<div className="max-h-72 space-y-2 overflow-y-auto">{transfers.map(t=><div key={t.id} className="flex items-center justify-between gap-2 rounded-md border border-line p-2 text-sm"><span>{t.classroomName} · {t.lectureNo!==null?(en?`Lesson ${t.lectureNo}`:`第 ${t.lectureNo} 讲`):t.title}<span className="block text-xs text-muted">{time(t.scheduledAt)}</span></span><Button variant="ghost" size="sm" disabled={pending} onClick={()=>save(t)}>{en?'Cancel arrangement':'取消安排'}</Button></div>)}</div>}
    {withdraw||target?<label className="space-y-1 text-sm"><span>{withdraw?(en?'Withdrawal reason':'退课原因'):(en?'Note (optional)':'备注（可选）')}</span><Textarea maxLength={2000} value={reason} disabled={pending} onChange={e=>{setReason(e.target.value);change();}}/></label>:null}
    <DialogFooter><Button variant="secondary" disabled={pending} onClick={onClose}>{en?'Close':'取消'}</Button>{withdraw||target?<Button disabled={pending||(withdraw?!reason.trim():mode==='temporary'&&!selected.length)} onClick={()=>save()}>{pending?<LoaderCircle className="size-4 animate-spin"/>:null}{withdraw?(en?'Confirm withdrawal':'确认退课'):(en?'Confirm transfer':'确认调班')}</Button>:null}</DialogFooter>
  </DialogContent></Dialog>;
}
