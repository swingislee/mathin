'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useRouter } from '@/i18n/navigation';
import { confirmSourceUseAction, getSourceUseContextAction } from './actions/source-use';
import { sourceFollowupHref, sourceUseMessages, type SourceUseContext } from './source-use-contract';

export function SourceUseButton({recordId,locale,studentId,linked=false,review=false,context:usageContext='followup',onLinked,label}:{recordId:string;locale:string;studentId?:string;linked?:boolean;review?:boolean;context?:'followup'|'assessment'|'enrollment'|'renewal';onLinked?:(studentId:string)=>void;label?:string}) {
  const m=sourceUseMessages(locale),router=useRouter();
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[context,setContext]=useState<SourceUseContext|null>(null);
  const [selected,setSelected]=useState(studentId??''),[query,setQuery]=useState(''),[error,setError]=useState('');
  const failure=(code:string)=>code==='VERSION_CONFLICT'?m.conflict:code==='SOURCE_IN_USE'||code==='SOURCE_ALREADY_LINKED'?m.inUse:code==='SOURCE_SHARED_RECORD'?m.shared:m.failed;
  function proceed(id:string) {if(onLinked)onLinked(id);else if(usageContext==='followup')router.push(sourceFollowupHref(id,recordId));else router.refresh();}
  async function load(search='',navigate=true) {
    setBusy(true);setError('');
    try {
      const result=await getSourceUseContextAction({locale,recordId,studentId,query:search});
      if(!result.ok){setError(failure(result.code));return;}
      if(navigate&&!review&&result.data.studentId){setOpen(false);proceed(result.data.studentId);return;}
      setContext(result.data);
      if(!result.data.students.some(student=>student.id===selected))setSelected(studentId??'');
    } catch {setError(m.failed);} finally {setBusy(false);}
  }
  function begin() {
    if(linked&&studentId&&!review){proceed(studentId);return;}
    setOpen(true);setContext(null);setSelected(studentId??'');setQuery('');void load();
  }
  async function confirm() {
    if(!context||!selected||!context.canConfirm)return;
    setBusy(true);setError('');
    try {
      const result=await confirmSourceUseAction({locale,recordId,studentId:selected,version:context.version,context:usageContext});
      if(!result.ok){setError(failure(result.code));return;}
      setOpen(false);proceed(selected);router.refresh();
    } catch {setError(m.failed);} finally {setBusy(false);}
  }
  return <>
    <Button variant="secondary" size="sm" onClick={begin}>{label??m.use}</Button>
    <Dialog open={open} onOpenChange={value=>{if(!busy)setOpen(value);}}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{m.question}</DialogTitle><DialogDescription>{usageContext==='followup'?m.questionHint:locale==='en'?'Check the source and confirm the student for this record.':'结合原始资料确认该业务记录对应的学生。'}</DialogDescription></DialogHeader>
        {busy&&!context?<p role="status" className="text-sm text-muted">{m.loading}</p>:null}
        {context?<div className="space-y-4">
          <div><p className="text-sm font-medium">{context.name} · {context.title}</p><p className="mt-1 break-words text-xs text-muted">{context.source}</p></div>
          <details className="text-sm"><summary className="cursor-pointer text-muted">{m.original}</summary>
            <dl className="mt-3 max-h-64 space-y-3 overflow-y-auto">{context.cells.map((cell,index)=><div key={index}><dt className="text-xs text-muted">{cell.name}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{cell.text}</dd></div>)}</dl>
          </details>
          {!studentId||review?<form className="flex gap-2" onSubmit={event=>{event.preventDefault();void load(query,false);}}>
            <Input value={query} onChange={event=>setQuery(event.target.value)} placeholder={m.search} aria-label={m.search} maxLength={100}/>
            <Button variant="secondary" type="submit" disabled={busy||query.trim().length<2}>{m.searchAction}</Button>
          </form>:null}
          <Select value={selected||undefined} onValueChange={setSelected} disabled={busy||!context.canConfirm}>
            <SelectTrigger aria-label={m.choose} className="w-full"><SelectValue placeholder={m.choose}/></SelectTrigger>
            <SelectContent>{context.students.map(student=><SelectItem key={student.id} value={student.id}>{student.name} · {student.grade===null?m.unknown:locale==='en'?`Grade ${student.grade}`:`${student.grade} 年级`} · {student.phone||m.unknown}</SelectItem>)}</SelectContent>
          </Select>
          {!context.students.length?<p className="text-sm text-muted">{m.noStudents}</p>:null}
          {!context.canConfirm?<p className="text-sm text-muted">{m.unavailable}</p>:null}
        </div>:null}
        {error?<p role="alert" className="text-sm text-rose">{error}</p>:null}
        <DialogFooter><Button variant="ghost" disabled={busy} onClick={()=>setOpen(false)}>{m.later}</Button>
          <Button disabled={busy||!context?.canConfirm||!selected||!context.students.some(student=>student.id===selected)} onClick={()=>void confirm()}>{m.confirm}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
