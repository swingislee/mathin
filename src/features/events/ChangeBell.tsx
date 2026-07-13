"use client";

import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Link } from "@/i18n/navigation";
import { markChangeFeedRead, type ChangeEvent } from "./actions";

export function ChangeBell({initialEvents}:{initialEvents:ChangeEvent[]}){
  const t=useTranslations("changes");
  const [events,setEvents]=useState(initialEvents);
  const unread=events.filter(event=>event.unread).length;
  const openChange=(open:boolean)=>{
    if(!open||unread===0)return;
    setEvents(current=>current.map(event=>({...event,unread:false})));
    void markChangeFeedRead().catch(()=>setEvents(initialEvents));
  };
  return <Popover onOpenChange={openChange}>
    <PopoverTrigger asChild><button type="button" aria-label={t("label",{count:unread})} className="relative rounded-full border bg-card p-2.5 transition hover:-translate-y-0.5"><Bell size={18}/>{unread>0&&<span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-rose px-1 text-[10px] leading-5 text-white">{Math.min(unread,99)}</span>}</button></PopoverTrigger>
    <PopoverContent align="end" className="w-[min(92vw,360px)] p-0">
      <div className="border-b border-line px-4 py-3 font-medium">{t("title")}</div>
      {events.length===0?<p className="p-5 text-sm text-muted">{t("empty")}</p>:<ol className="max-h-96 divide-y divide-line overflow-y-auto">{events.map(event=><li key={event.id}>{event.link?<Link href={event.link} className="block px-4 py-3 transition hover:bg-moon/20"><Event event={event}/></Link>:<div className="px-4 py-3"><Event event={event}/></div>}</li>)}</ol>}
    </PopoverContent>
  </Popover>;

  function Event({event}:{event:ChangeEvent}){
    const key=event.type.replaceAll(".","_");
    return <><p className="text-sm">{t.has(`types.${key}`)?t(`types.${key}`):event.type}</p><time className="mt-1 block text-xs text-muted">{new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(new Date(event.occurredAt))}</time></>;
  }
}
