"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoaderCircle, Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAction } from "@/components/action-form";
import { Dialog,DialogContent,DialogFooter,DialogHeader,DialogTitle } from "@/components/ui/dialog";
import { useRouter } from "@/i18n/navigation";
import { updateClassroomAction } from "./actions/classes";
import type { ClassroomDetail } from "./classes";
import { fromSelectValue,inputClass,toSelectValue } from "./controls";
export function ClassroomEditor({classroom}:{classroom:ClassroomDetail}){const t=useTranslations("school.classes");const router=useRouter();const [open,setOpen]=useState(false);const [name,setName]=useState(classroom.name);const [grade,setGrade]=useState(classroom.grade?.toString()??"");const [capacity,setCapacity]=useState(classroom.capacity?.toString()??"");const [room,setRoom]=useState(classroom.room);
  const{run:saveRun,pending}=useAction(updateClassroomAction,{successMessage:t("classSaved"),errorMessage:{default:t("actionFailed")},onSuccess:()=>{setOpen(false);router.refresh();}});
  const save=()=>saveRun(classroom.id,{name,grade:grade?Number(grade):null,capacity:capacity?Number(capacity):null,room});
  return <><Button size="sm" variant="secondary" onClick={()=>setOpen(true)} className="gap-1.5"><Pencil size={15}/>{t("editClass")}</Button><Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>{t("editClass")}</DialogTitle></DialogHeader><div className="grid gap-3"><Label className="grid gap-1 text-xs font-normal text-muted">{t("name")}<Input value={name} onChange={e=>setName(e.target.value)} className={inputClass}/></Label><Label className="grid gap-1 text-xs font-normal text-muted">{t("gradeLabel")}<Select value={toSelectValue(grade)} onValueChange={v=>setGrade(fromSelectValue(v))}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>—</SelectItem>{Array.from({length:12},(_,i)=>i+1).map(x=><SelectItem key={x} value={String(x)}>{t("grade",{grade:x})}</SelectItem>)}</SelectContent></Select></Label><Label className="grid gap-1 text-xs font-normal text-muted">{t("capacity")}<Input type="number" min={1} value={capacity} onChange={e=>setCapacity(e.target.value)} className={inputClass}/></Label><Label className="grid gap-1 text-xs font-normal text-muted">{t("room")}<Input value={room} onChange={e=>setRoom(e.target.value)} className={inputClass}/></Label></div><DialogFooter><Button size="sm" variant="secondary" onClick={()=>setOpen(false)}>{t("cancel")}</Button><Button size="sm" disabled={pending||!name.trim()} onClick={save}>{pending&&<LoaderCircle size={15} className="animate-spin"/>}{t("save")}</Button></DialogFooter></DialogContent></Dialog></>}
