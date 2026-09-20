"use client";

import { useId, useState } from "react";
import dynamic from "next/dynamic";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableCell, TableRow } from "@/components/ui/table";
import { classSessionMessages, defaultClassSession, type ClassRosterSession } from "./class-roster-session-contract";

const ClassRosterSessionDetail = dynamic(() => import("./ClassRosterSessionDetail").then(module => module.ClassRosterSessionDetail));

export function ClassRosterSessionRow({ classroomId, sessions, locale, timeZone, now, requestedId, expanded, canChange, onExpandedChange, onDirtyChange }: {
  classroomId: string; sessions: ClassRosterSession[]; locale: string; timeZone: string; now: number; requestedId?: string;
  expanded: boolean; canChange: () => boolean; onExpandedChange: (value: boolean) => void; onDirtyChange: (value: boolean) => void;
}) {
  const m = classSessionMessages(locale);
  const detailId = useId();
  const [selectedId, setSelectedId] = useState(() => defaultClassSession(sessions, now, timeZone, requestedId)?.id);
  const [reviewCounts, setReviewCounts] = useState<Record<string, number>>({});
  const session = sessions.find(row => row.id === selectedId) ?? defaultClassSession(sessions, now, timeZone, requestedId);
  const index = sessions.findIndex(row => row.id === session?.id);
  const date = (value: string | null) => value ? new Intl.DateTimeFormat(locale, { timeZone, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)) : m.noDate;
  const choose = (id: string) => { if (canChange()) setSelectedId(id); };
  if (!session) return <TableRow data-class-session-strip={classroomId} className="hover:bg-transparent"><TableCell colSpan={5} className="px-2 py-1 text-[11px] text-muted">{m.noSessions}</TableCell></TableRow>;
  return <>
    <TableRow data-class-session-strip={classroomId} className={expanded ? "bg-moon/20 hover:bg-moon/20" : "hover:bg-transparent"}>
      <TableCell colSpan={5} className="px-2 py-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <span className="text-muted">{m.session}</span>
          <div className="flex min-w-0 items-center gap-0.5">
            <Button size="sm" variant="ghost" className="size-6 p-0" aria-label={m.previous} disabled={index <= 0} onClick={() => choose(sessions[index - 1].id)}><ChevronLeft className="size-3" /></Button>
            <Select value={session.id} onValueChange={choose}><SelectTrigger aria-label={m.choose} className="h-7 w-auto min-w-44 max-w-96 gap-2 border-0 bg-transparent px-1 text-xs shadow-none"><SelectValue /></SelectTrigger>
              <SelectContent>{sessions.map(row => <SelectItem key={row.id} value={row.id}>{date(row.scheduledAt)} · {row.title || m.untitled}</SelectItem>)}</SelectContent>
            </Select>
            <Button size="sm" variant="ghost" className="size-6 p-0" aria-label={m.next} disabled={index >= sessions.length - 1} onClick={() => choose(sessions[index + 1].id)}><ChevronRight className="size-3" /></Button>
          </div>
          <span className="text-muted">{m.attendance} {session.attendanceCount} · {m.reviews} {reviewCounts[session.id] ?? session.reviewCount}</span>
          <Button size="sm" variant="ghost" className="ml-auto h-7 gap-1 px-2 text-xs" aria-expanded={expanded} aria-controls={detailId} onClick={() => { if (canChange()) onExpandedChange(!expanded); }}>
            {expanded ? m.close : m.open}{expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </Button>
        </div>
      </TableCell>
    </TableRow>
    {expanded && <TableRow className="hover:bg-transparent" data-class-session-editor><TableCell colSpan={5} className="p-0 whitespace-normal">
      <div id={detailId} className="border-l-2 border-crater px-3 py-3" data-session-id={session.id}>
        <ClassRosterSessionDetail key={session.id} sessionId={session.id} classroomId={classroomId} locale={locale} timeZone={timeZone} now={now} onDirtyChange={onDirtyChange}
          onReviewCountChange={count => setReviewCounts(current => ({ ...current, [session.id]: count }))} />
      </div>
    </TableCell></TableRow>}
  </>;
}
