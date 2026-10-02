"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { BookOpenCheck, CircleHelp, ClipboardList, FilePenLine, Lightbulb, Megaphone, MessagesSquare, Users, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { DashboardTableShell } from "../dashboard-page";
import rosterLayout from "../class-roster-layout.module.css";
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

export function TeachingProgressHelp({ locale }: { locale: string }) {
  const [open, setOpen] = useState(false);
  const label = locale.startsWith("en") ? "Progress icons and colors" : "进度图标与颜色说明";
  return <TooltipProvider delayDuration={250}><Tooltip open={open} onOpenChange={setOpen}><TooltipTrigger asChild>
    <Button variant="ghost" size="sm" className="size-7 p-0" data-teaching-progress-help aria-label={label}
      onClick={event => { event.preventDefault(); setOpen(value => !value); }}><CircleHelp size={14} /></Button>
  </TooltipTrigger><TooltipContent side="bottom" align="end" className="max-w-[min(24rem,calc(100vw-2rem))] border border-line bg-card p-3 text-ink shadow-md">
    <TeachingProgressLegend locale={locale} />
  </TooltipContent></Tooltip></TooltipProvider>;
}

export function TeachingProgressHeader({ columns, locale }: { columns: readonly { key: string; lectureNo: number | null }[]; locale: string }) {
  const m = teachingMatrixMessages(locale);
  return <div data-teaching-progress-viewport data-teaching-progress-header className={rosterLayout.progressViewport}>
    <div className="flex min-w-full">{columns.length ? columns.map(column =>
      <span key={column.key} className="flex h-8 min-w-20 flex-1 items-center justify-center border-r border-line px-1 text-[11px] font-normal last:border-r-0">
        {column.lectureNo === null ? m.unspecified : m.lesson(column.lectureNo)}
      </span>) : <span className="flex h-8 items-center px-2 text-[11px] font-normal">{m.title}</span>}
    </div>
  </div>;
}

/** 只填充原班级表的名单单元格，不拥有班级行、左侧列、筛选或分页。 */
export function TeachingProgressCells({ sessions, classroomId, columns, locale, timeZone, selectedId, disabled, onSelect }: {
  sessions: TeachingProgressSession[]; classroomId: string; columns: readonly { key: string; lectureNo: number | null }[];
  locale: string; timeZone: string; selectedId?: string | null; disabled: boolean; onSelect: (session: TeachingProgressSession) => void;
}) {
  const m = teachingMatrixMessages(locale);
  return <div data-teaching-progress-cells data-teaching-progress-viewport className={rosterLayout.progressViewport}>
    {columns.length ? <div className="flex min-w-full">{columns.map(column => {
      const lessons = teachingMatrixSessions(sessions, classroomId, column.lectureNo);
      return <div key={column.key} className="min-w-20 flex-1 border-r border-line last:border-r-0">
        {lessons.length ? lessons.map(session => <button key={session.id} type="button" data-teaching-session={session.id}
          aria-expanded={selectedId === session.id} disabled={disabled}
          aria-label={`${m.open} · ${session.title || m.untitled} · ${TEACHING_PROGRESS_ITEMS.map(kind => `${m.items[kind]}：${m.states[session.progress[kind].state]}`).join("；")}`}
          className={cn("flex h-9 w-full items-center justify-center px-1 text-left hover:bg-moon/20 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-crater", selectedId === session.id && "bg-moon/25")}
          onClick={() => onSelect(session)}>
          <span className="grid grid-cols-4 justify-items-center gap-0.5">{TEACHING_PROGRESS_ITEMS.map(kind => {
            const Icon = icons[kind], progress = session.progress[kind];
            return <Tooltip key={kind}><TooltipTrigger asChild><span className={cn("inline-flex size-4 items-center justify-center rounded-[3px] border", TEACHING_PROGRESS_BLOCK_TONES[progress.state])}>
              <Icon size={12} strokeWidth={1.8} aria-hidden />
            </span></TooltipTrigger><TooltipContent><span className="mb-1 block text-[11px]">{column.lectureNo === null ? session.title || m.unspecified : m.lesson(column.lectureNo)}{session.scheduledAt && ` · ${lessonDate(session.scheduledAt, locale, timeZone)}`}</span>{m.items[kind]} · {m.states[progress.state]}<span className="ml-1 text-[11px]">{m.reasons[progress.reason]}</span>
              {progress.dueAt && <span className="mt-1 block text-[11px]">{m.due}：{lessonDate(progress.dueAt, locale, timeZone)}</span>}
              {progress.completedAt && <span className="block text-[11px]">{m.completed}：{lessonDate(progress.completedAt, locale, timeZone)}</span>}
            </TooltipContent></Tooltip>;
          })}</span>
        </button>) : <span className="flex h-9 items-center justify-center px-1 text-muted">—</span>}
      </div>;
    })}</div> : <p className="flex h-9 items-center px-2 text-xs text-muted">{m.noLessons}</p>}
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
