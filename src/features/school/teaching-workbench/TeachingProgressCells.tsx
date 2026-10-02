"use client";

import dynamic from "next/dynamic";
import { BookOpenCheck, ClipboardList, FilePenLine, Lightbulb, Megaphone, MessagesSquare, Users, Video } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { DashboardTableShell } from "../dashboard-page";
import {
  TEACHING_PROGRESS_ITEMS, TEACHING_PROGRESS_STATES, TEACHING_PROGRESS_BLOCK_TONES, TEACHING_PROGRESS_TONES,
  teachingMatrixMessages, teachingMatrixSessions, type TeachingProgressSession,
} from "./teaching-progress-matrix-contract";

const SessionDetail = dynamic(() => import("../ClassRosterSessionDetail").then(module => module.ClassRosterSessionDetail));
const icons = { solution: BookOpenCheck, lesson_plan: FilePenLine, rehearsal_video: Video, learning: Users,
  class_feedback: Megaphone, homework: ClipboardList, communication: MessagesSquare, reflection: Lightbulb };
const lessonDate = (at: string, locale: string, timeZone: string) => new Intl.DateTimeFormat(locale, {
  timeZone, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
}).format(new Date(at));

export function TeachingProgressLegend({ locale }: { locale: string }) {
  const m = teachingMatrixMessages(locale);
  return <div data-teaching-progress-legend className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-muted" aria-label={m.title}>
    <div className="flex flex-wrap gap-x-3 gap-y-1">{TEACHING_PROGRESS_ITEMS.map(kind => { const Icon = icons[kind];
      return <span key={kind} className="inline-flex items-center gap-1"><Icon size={14} aria-hidden />{m.items[kind]}</span>;
    })}</div>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">{TEACHING_PROGRESS_STATES.map(state => <span key={state} className="inline-flex items-center gap-1.5">
      <span aria-hidden className={cn("size-3 rounded-sm border", TEACHING_PROGRESS_BLOCK_TONES[state])} />{m.states[state]}
    </span>)}</div>
  </div>;
}

/** 只填充原班级表的名单单元格，不拥有班级行、左侧列、筛选或分页。 */
export function TeachingProgressCells({ sessions, classroomId, columns, locale, timeZone, selectedId, disabled, onSelect }: {
  sessions: TeachingProgressSession[]; classroomId: string; columns: readonly { key: string; lectureNo: number | null }[];
  locale: string; timeZone: string; selectedId?: string | null; disabled: boolean; onSelect: (session: TeachingProgressSession) => void;
}) {
  const m = teachingMatrixMessages(locale);
  return <div data-teaching-progress-cells className="w-0 min-w-full overflow-x-auto">
    {columns.length ? <div className="flex min-w-full">{columns.map(column => {
      const lessons = teachingMatrixSessions(sessions, classroomId, column.lectureNo);
      return <div key={column.key} className="min-w-32 flex-1 border-r border-line last:border-r-0">
        <p className="border-b border-line bg-paper/50 px-2 py-1 text-center text-[11px] text-muted">{column.lectureNo === null ? m.unspecified : m.lesson(column.lectureNo)}</p>
        {lessons.length ? lessons.map(session => <button key={session.id} type="button" data-teaching-session={session.id}
          aria-expanded={selectedId === session.id} disabled={disabled}
          aria-label={`${m.open} · ${session.title || m.untitled} · ${TEACHING_PROGRESS_ITEMS.map(kind => `${m.items[kind]}：${m.states[session.progress[kind].state]}`).join("；")}`}
          className={cn("block w-full px-2 py-2 text-left hover:bg-moon/20 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-crater", selectedId === session.id && "bg-moon/25")}
          onClick={() => onSelect(session)}>
          {(lessons.length > 1 || column.lectureNo === null) && <span className="mb-1 block max-w-32 truncate text-[10px] text-muted">{column.lectureNo === null ? session.title : session.scheduledAt && lessonDate(session.scheduledAt, locale, timeZone)}</span>}
          <span className="grid grid-cols-4 justify-items-center gap-1">{TEACHING_PROGRESS_ITEMS.map(kind => {
            const Icon = icons[kind], progress = session.progress[kind];
            return <Tooltip key={kind}><TooltipTrigger asChild><span className={cn("inline-flex size-6 items-center justify-center rounded-md border", TEACHING_PROGRESS_BLOCK_TONES[progress.state])}>
              <Icon size={15} strokeWidth={1.8} aria-hidden />
            </span></TooltipTrigger><TooltipContent>{m.items[kind]} · {m.states[progress.state]}<span className="ml-1 text-[11px]">{m.reasons[progress.reason]}</span>
              {progress.dueAt && <span className="mt-1 block text-[11px]">{m.due}：{lessonDate(progress.dueAt, locale, timeZone)}</span>}
              {progress.completedAt && <span className="block text-[11px]">{m.completed}：{lessonDate(progress.completedAt, locale, timeZone)}</span>}
            </TooltipContent></Tooltip>;
          })}</span>
        </button>) : <span className="block px-2 py-4 text-center text-muted">—</span>}
      </div>;
    })}</div> : <p className="px-2 py-3 text-xs text-muted">{m.noLessons}</p>}
  </div>;
}

export function TeachingProgressDetails({ session, locale, timeZone, now, onDirtyChange }: {
  session: TeachingProgressSession; locale: string; timeZone: string; now: number; onDirtyChange: (value: boolean) => void;
}) {
  const m = teachingMatrixMessages(locale);
  return <div data-class-session-editor data-session-id={session.id} className="min-w-0 space-y-4">
    <p className="text-xs text-muted">{session.title}{session.scheduledAt && ` · ${lessonDate(session.scheduledAt, locale, timeZone)}`}</p>
    <DashboardTableShell><Table mobileLayout="stacked"><TableHeader><TableRow><TableHead>{m.item}</TableHead><TableHead>{m.status}</TableHead><TableHead>{m.record}</TableHead></TableRow></TableHeader>
      <TableBody>{TEACHING_PROGRESS_ITEMS.map(kind => { const progress = session.progress[kind], Icon = icons[kind];
        return <TableRow key={kind}><TableCell mobileSpan="primary" mobileLabel={m.item}><span className="inline-flex items-center gap-2">
          <span className={cn("inline-flex size-6 items-center justify-center rounded-md border", TEACHING_PROGRESS_BLOCK_TONES[progress.state])}><Icon size={15} aria-hidden /></span>{m.items[kind]}
        </span></TableCell><TableCell mobileLabel={m.status} className={TEACHING_PROGRESS_TONES[progress.state]}>{m.states[progress.state]}</TableCell>
          <TableCell mobileLabel={m.record}>{m.reasons[progress.reason]}<span className="ml-3 text-[11px] text-muted">{m.sources[kind]}</span>
            {(progress.dueAt || progress.completedAt) && <span className="mt-1 block text-[11px] text-muted">{progress.dueAt && `${m.due}：${lessonDate(progress.dueAt, locale, timeZone)}`}{progress.dueAt && progress.completedAt && " · "}{progress.completedAt && `${m.completed}：${lessonDate(progress.completedAt, locale, timeZone)}`}</span>}
          </TableCell></TableRow>;
      })}</TableBody>
    </Table></DashboardTableShell>
    <SessionDetail key={session.id} sessionId={session.id} classroomId={session.classroomId} locale={locale} timeZone={timeZone} now={now} onDirtyChange={onDirtyChange} />
  </div>;
}
