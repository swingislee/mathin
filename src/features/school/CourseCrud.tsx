"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { ArrowDown, ArrowUp, LoaderCircle, Plus, Save, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRouter } from "@/i18n/navigation";
import { createCourseAction, createLectureAction, deleteLectureAction, reorderLecturesAction, updateCourseAction, updateLectureAction, type CourseWriteInput } from "./actions";
import { inputClass } from "./controls";
import type { CourseDetail, CourseLecture } from "./courses";

const COURSE_TERMS = [
  { value: 1, labelKey: "summer" },
  { value: 2, labelKey: "autumn" },
  { value: 3, labelKey: "winter" },
  { value: 4, labelKey: "spring" },
] as const;

const EMPTY: CourseWriteInput = { title: "", productCode: "", grade: 1, term: 1, classType: "A", status: "enabled" };

export function CourseCreateDialog() {
  const t = useTranslations("school.courses");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const submit = () => startTransition(async () => {
    try { const id = await createCourseAction(form); setOpen(false); setForm(EMPTY); router.push(`/dashboard/courses/${id}`); }
    catch { setFailed(true); }
  });
  return <>
    <Button size="sm" onClick={() => setOpen(true)} className="gap-1.5"><Plus size={15}/>{t("newCourse")}</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>{t("newCourse")}</DialogTitle></DialogHeader>
      <CourseFields form={form} setForm={setForm} />
      {failed && <p className="text-xs text-rose">{t("actionFailed")}</p>}
      <DialogFooter><Button variant="secondary" size="sm" onClick={() => setOpen(false)}>{t("cancel")}</Button><Button size="sm" disabled={pending || !form.title.trim()} onClick={submit}>{pending && <LoaderCircle size={15} className="animate-spin"/>}{t("create")}</Button></DialogFooter>
    </DialogContent></Dialog>
  </>;
}

export function CourseCrudPanel({ course, canEditTemplate }: { course: CourseDetail; canEditTemplate: boolean }) {
  const t = useTranslations("school.courses");
  const router = useRouter();
  const [form, setForm] = useState<CourseWriteInput>({ title: course.title, productCode: course.productCode ?? "", grade: course.grade, term: course.term, classType: course.classType, status: course.status });
  const [name, setName] = useState("");
  const [objectives, setObjectives] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (job: () => Promise<void>) => startTransition(async () => { try { setError(null); await job(); router.refresh(); } catch { setError(t("actionFailed")); } });
  const move = (index: number, delta: number) => {
    const ids = course.lectures.map((x) => x.id); const target=index+delta; [ids[index],ids[target]]=[ids[target],ids[index]];
    run(() => reorderLecturesAction(course.id, ids));
  };
  return <div className="mt-6 space-y-6">
    <section className="rounded-xl border border-line bg-card p-5"><div className="flex items-center justify-between"><h2 className="font-medium">{t("courseInfo")}</h2><Button size="sm" disabled={pending || !form.title.trim()} onClick={() => run(() => updateCourseAction(course.id, form))} className="gap-1.5"><Save size={15}/>{t("save")}</Button></div><div className="mt-4"><CourseFields form={form} setForm={setForm}/></div></section>
    <section className="rounded-xl border border-line bg-card p-5"><h2 className="font-medium">{t("lectures")}</h2>
      <div className="mt-4 space-y-3">{course.lectures.map((lecture,index)=><LectureEditor key={lecture.id} lecture={lecture} courseId={course.id} index={index} count={course.lectures.length} canEditTemplate={canEditTemplate} pending={pending} move={move} run={run}/>)}</div>
      <div className="mt-5 grid gap-3 rounded-lg bg-line/40 p-3 sm:grid-cols-[1fr_2fr_auto]"><Input value={name} onChange={e=>setName(e.target.value)} placeholder={t("lectureName")}/><Input value={objectives} onChange={e=>setObjectives(e.target.value)} placeholder={t("objectives")}/><Button size="sm" disabled={pending||!name.trim()} onClick={()=>run(async()=>{await createLectureAction(course.id,name,objectives);setName("");setObjectives("");})} className="gap-1.5"><Plus size={15}/>{t("addLecture")}</Button></div>
      {error && <p className="mt-3 text-xs text-rose">{error}</p>}
    </section>
  </div>;
}

function LectureEditor({lecture,courseId,index,count,canEditTemplate,pending,move,run}:{lecture:CourseLecture;courseId:string;index:number;count:number;canEditTemplate:boolean;pending:boolean;move:(i:number,d:number)=>void;run:(job:()=>Promise<void>)=>void}){
  const t=useTranslations("school.courses"); const router=useRouter(); const [name,setName]=useState(lecture.name); const [objectives,setObjectives]=useState(lecture.objectives); const [message,setMessage]=useState<string|null>(null);
  const remove=()=>run(async()=>{const result=await deleteLectureAction(lecture.id);if(result==="in_use"){setMessage(t("lectureInUse"));return;}if(result!=="ok")throw new Error();});
  return <div className="grid gap-2 rounded-lg border border-line p-3 lg:grid-cols-[42px_1fr_2fr_auto] lg:items-center"><span className="font-mono text-xs text-muted">{index+1}</span><Input value={name} onChange={e=>setName(e.target.value)} className={inputClass}/><Input value={objectives} onChange={e=>setObjectives(e.target.value)} className={inputClass}/><div className="flex items-center justify-end gap-1"><Button variant="secondary" size="sm" className="h-8 w-8 p-0" disabled={pending||index===0} onClick={()=>move(index,-1)} aria-label={t("moveUp")}><ArrowUp size={15}/></Button><Button variant="secondary" size="sm" className="h-8 w-8 p-0" disabled={pending||index===count-1} onClick={()=>move(index,1)} aria-label={t("moveDown")}><ArrowDown size={15}/></Button><Button variant="secondary" size="sm" className="h-8 w-8 p-0" disabled={pending||!name.trim()} onClick={()=>run(()=>updateLectureAction(lecture.id,name,objectives))} aria-label={t("save")}><Save size={15}/></Button>{canEditTemplate&&<Button variant="secondary" size="sm" onClick={()=>router.push(`/dashboard/courses/${courseId}/lectures/${lecture.id}`)}>{t("templatePagesCount",{count:lecture.templatePageCount})}</Button>}<Button variant="secondary" size="sm" disabled={pending} onClick={remove} aria-label={t("deleteLecture")} className="h-8 w-8 p-0 text-rose"><Trash2 size={15}/></Button></div>{message&&<p className="text-xs text-rose lg:col-start-2 lg:col-span-3">{message}</p>}</div>;
}

function CourseFields({form,setForm}:{form:CourseWriteInput;setForm:React.Dispatch<React.SetStateAction<CourseWriteInput>>}){
  const t=useTranslations("school.courses"); const set=<K extends keyof CourseWriteInput>(k:K,v:CourseWriteInput[K])=>setForm(x=>({...x,[k]:v}));
  return <div className="grid gap-3 sm:grid-cols-2">
    <Label className="grid gap-1 text-xs font-normal text-muted">{t("courseTitle")}<Input value={form.title} onChange={e=>set("title",e.target.value)} className={inputClass}/></Label>
    <Label className="grid gap-1 text-xs font-normal text-muted">{t("productCode")}<Input value={form.productCode} onChange={e=>set("productCode",e.target.value)} className={inputClass}/></Label>
    <Label className="grid gap-1 text-xs font-normal text-muted">{t("gradeLabel")}
      <Select value={String(form.grade)} onValueChange={v=>set("grade",Number(v))}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>{Array.from({length:9},(_,i)=>i+1).map(x=><SelectItem key={x} value={String(x)}>{t("grade",{grade:x})}</SelectItem>)}</SelectContent>
      </Select>
    </Label>
    <Label className="grid gap-1 text-xs font-normal text-muted">{t("term")}
      <Select value={String(form.term)} onValueChange={v=>set("term",Number(v))}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>{COURSE_TERMS.map(x=><SelectItem key={x.value} value={String(x.value)}>{t(x.labelKey)}</SelectItem>)}</SelectContent>
      </Select>
    </Label>
    <Label className="grid gap-1 text-xs font-normal text-muted">{t("classType")}<Input value={form.classType} onChange={e=>set("classType",e.target.value)} className={inputClass}/></Label>
    <Label className="grid gap-1 text-xs font-normal text-muted">{t("status")}
      <Select value={form.status} onValueChange={v=>set("status",v as "enabled"|"disabled")}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="enabled">{t("enabled")}</SelectItem><SelectItem value="disabled">{t("disabled")}</SelectItem></SelectContent>
      </Select>
    </Label>
  </div>;
}
