'use client';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import {SourceUseButton} from './SourceUseButton';
import {BusinessRecordRevisionButton} from './BusinessRecordRevisionButton';
import {prepareSourceEnrollmentAction} from './enrollment-workflow-actions';
import type {HistoricalEnrollment} from './student-business-history-contract';
import type {EnrollmentPlacementBoard,EnrollmentWorkflowOptions} from './enrollment-workflow-contract';

export function SourceEnrollmentPlacementDialog({record,name,options,locale,onClose,onSaved}:{record:HistoricalEnrollment;name:string;options:EnrollmentWorkflowOptions;locale:string;onClose:()=>void;onSaved:(board:EnrollmentPlacementBoard)=>void}) {
  const en=locale==='en';
  const [studentId,setStudentId]=useState(record.student_id),[classroomId,setClassroomId]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function save() {
    if(!studentId||!classroomId)return;
    setBusy(true);setError('');
    try {
      const result=await prepareSourceEnrollmentAction({enrollmentId:record.id,studentId,classroomId});
      if(result.ok)onSaved(result.data);
      else setError(result.code==='ALREADY_ENROLLED_FOR_COURSE'?(en?'This student already has an enrollment for this course. Continue from that enrollment.':'这位学生已有该课程的报名，请从已有报名继续分班。'):result.code==='CLASS_FULL'?(en?'This class is full. Choose another class.':'该班已满，请选择其他班级。'):(en?'Unable to place this enrollment. Reload the record and check the student and class.':'暂时无法分班，请重新读取记录并核对学生与班级。'));
    } catch {setError(en?'Unable to save. Please try again.':'暂时无法保存，请重试。');} finally {setBusy(false);}
  }
  return <Dialog open onOpenChange={value=>{if(!value&&!busy)onClose();}}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
    <DialogHeader><DialogTitle>{en?'Continue placement':'继续分班'} · {name}</DialogTitle><DialogDescription>{en?'Confirm the student and select the class for this enrollment.':'确认学生并选择这次报名对应的班级。'}</DialogDescription></DialogHeader>
    <dl className="grid grid-cols-2 gap-3 text-xs">{[(en?'Term':'学期'),record.period_label,(en?'Class':'班型'),record.class_label,(en?'Teacher':'老师'),record.teacher_label,(en?'Schedule':'上课时间'),record.schedule_label].reduce<{label:string;value:string}[]>((items,value,index,all)=>index%2?items:[...items,{label:value,value:all[index+1]}],[]).map(item=><div key={item.label}><dt className="text-muted">{item.label}</dt><dd className="mt-1">{item.value||'—'}</dd></div>)}</dl>
    {record.note?<details className="text-xs"><summary className="cursor-pointer text-muted">{en?'Notes':'备注'}</summary><p className="mt-2 whitespace-pre-wrap leading-6">{record.note}</p></details>:null}
    <div className="flex items-center justify-between gap-3"><span className="text-sm">{studentId?(en?'Student confirmed':'已确认学生'):(en?'Confirm the student':'确认学生')}</span><SourceUseButton recordId={record.source_record_id} locale={locale} studentId={studentId??undefined} linked={Boolean(studentId)} context="enrollment" label={en?'Check student':'核对学生'} onLinked={setStudentId}/></div>
    <Select value={classroomId||undefined} onValueChange={setClassroomId} disabled={busy}><SelectTrigger className="w-full" aria-label={en?'Class':'班级'}><SelectValue placeholder={en?'Choose a class':'选择班级'}/></SelectTrigger><SelectContent>{options.classrooms.map(room=><SelectItem key={room.id} value={room.id}>{room.name} · {options.terms.find(term=>term.id===room.termId)?.name??''} · {room.teacherNames||'—'}</SelectItem>)}</SelectContent></Select>
    {error?<p role="alert" className="text-sm text-rose">{error}</p>:null}
    <DialogFooter><BusinessRecordRevisionButton kind="enrollment" recordId={record.id} subject={name}/><Button variant="ghost" disabled={busy} onClick={onClose}>{en?'Close':'关闭'}</Button><Button disabled={busy||!studentId||!classroomId} onClick={()=>void save()}>{en?'Confirm placement':'确认分班'}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
