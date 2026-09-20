"use client";

import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { DashboardRowDisclosure } from "./dashboard-page/DashboardRowDisclosure";
import { FollowupRecordRow } from "./dashboard-page/FollowupRecordRow";
import { CLASS_SESSION_OBSERVATION_BATCH_SIZE, classSessionMessages, classSessionObservationsSchema, type ClassRosterSession } from "./class-roster-session-contract";
import { readDashboardDetail } from "./dashboard-page/readDashboardDetail";
import { TeachingCoverage, TeachingPerformance } from "./teaching-workbench/TeachingObservationCells";
import type { TeachingObservations } from "./teaching-workbench/teaching-learning-summary";

const ClassRosterSessionDetail = dynamic(() => import("./ClassRosterSessionDetail").then(module => module.ClassRosterSessionDetail));

/** 复用教学记录的两层展开：班级名册主行 → 课次行 → 该课连续登记。 */
export function ClassRosterSessionRow({ classroomId, classroomName, sessions, locale, timeZone, now, requestedId, expanded, canChange, onExpandedChange, onDirtyChange, rowProps, children, recordKey, activeKey, onActivate }: {
  classroomId: string; classroomName: string; sessions: ClassRosterSession[]; locale: string; timeZone: string; now: number; requestedId?: string;
  expanded: boolean; canChange: () => boolean; onExpandedChange: (value: boolean) => void; onDirtyChange: (value: boolean) => void;
  rowProps?: ComponentProps<typeof TableRow> & { [key: `data-${string}`]: unknown };
  children: (disclosure: ReactNode) => ReactNode;
  recordKey: string; activeKey: string | null; onActivate: (key: string) => void;
}) {
  const m = classSessionMessages(locale);
  const t = useTranslations("school.teachingWorkbench");
  const detailId = useId();
  const [expandedSession, setExpandedSession] = useState<string | null>(() => sessions.find(row => row.id === requestedId)?.id ?? null);
  const [reviewCounts, setReviewCounts] = useState<Record<string, number>>({});
  const [observations, setObservations] = useState<Record<string, TeachingObservations | null>>({});
  const observationCache = useRef<typeof observations>({});
  const [attempt, setAttempt] = useState(0);
  const sessionIds = sessions.map(session => session.id).join(",");
  useEffect(() => {
    if (!expanded) return;
    const ids = sessionIds.split(",").filter(id => id && !Object.hasOwn(observationCache.current, id));
    if (!ids.length) return;
    const controller = new AbortController();
    void (async () => {
      // 一次只读展开班级的摘要；成功结果留在当前页面，逐课登记仍按需加载。
      for (let offset = 0; offset < ids.length; offset += CLASS_SESSION_OBSERVATION_BATCH_SIZE) {
        const batch = ids.slice(offset, offset + CLASS_SESSION_OBSERVATION_BATCH_SIZE);
        let values: Record<string, TeachingObservations | null>;
        try {
          const result = await readDashboardDetail<unknown>(`/${locale}/dashboard/classes/session-observations`, { classroomId, sessionIds: batch }, controller.signal);
          const parsed = new Map(classSessionObservationsSchema.parse(result).map(row => [row.sessionId, row.observations]));
          values = Object.fromEntries(batch.map(id => [id, parsed.get(id) ?? null]));
        } catch {
          values = Object.fromEntries(batch.map(id => [id, null]));
        }
        if (controller.signal.aborted) return;
        observationCache.current = { ...observationCache.current, ...values };
        setObservations(observationCache.current);
      }
    })();
    return () => controller.abort();
  }, [expanded, classroomId, locale, sessionIds, attempt]);
  const retryObservation = (id: string) => {
    const next = { ...observationCache.current };
    delete next[id]; observationCache.current = next; setObservations(next); setAttempt(value => value + 1);
  };
  const date = (value: string | null) => value ? new Intl.DateTimeFormat(locale, { timeZone, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)) : m.noDate;
  const sessionKey = (id: string) => `${recordKey}/session:${id}`;
  const changeClass = (open: boolean) => {
    if (!canChange()) return;
    onExpandedChange(open);
    onActivate(recordKey);
    if (!open) setExpandedSession(null);
  };
  const changeSession = (id: string, open: boolean) => {
    if (!canChange()) return;
    setExpandedSession(open ? id : null); onActivate(sessionKey(id));
  };
  return <FollowupRecordRow rowKey={recordKey} rowProps={rowProps} ignoreClickSelector="[data-placement-student]"
    active={activeKey === recordKey || expanded && Boolean(activeKey?.startsWith(`${recordKey}/`))} onActivate={() => onActivate(recordKey)} expanded={expanded}
    onExpandedChange={changeClass} detailsId={detailId} title={classroomName} colSpan={5} hideTitle
    summary={children(<DashboardRowDisclosure expanded={expanded} controls={detailId}
      label={t(expanded ? "overview.collapseClass" : "overview.expandClass", { name: classroomName })} onToggle={() => changeClass(!expanded)} />)}>
    {() => sessions.length ? <Table data-class-session-list={classroomId} aria-label={t("overview.classLessons", { name: classroomName })} className="table-fixed text-xs" containerClassName="overflow-visible">
      <colgroup><col /><col className="w-24" /><col className="w-56" /><col className="w-32" /></colgroup>
      <TableHeader className="sr-only"><TableRow><TableHead>{m.session}</TableHead><TableHead>{t("observations.sessionState")}</TableHead><TableHead>{t("observations.performance")}</TableHead><TableHead>{t("observations.coverageTitle")}</TableHead></TableRow></TableHeader>
      <TableBody>
        {[...sessions].reverse().map(session => {
          const id = `${detailId}-${session.id}`;
          const isOpen = expandedSession === session.id;
          const observation = observations[session.id];
          const reviewCount = reviewCounts[session.id] ?? session.reviewCount;
          return <FollowupRecordRow key={session.id} rowKey={sessionKey(session.id)} rowProps={{ "data-class-session-row": session.id, className: "cursor-pointer [&>td]:px-2 [&>td]:py-1.5" }}
            active={activeKey === sessionKey(session.id)} expanded={isOpen} onActivate={() => onActivate(sessionKey(session.id))} loadingLabel={m.loading}
            onExpandedChange={open => changeSession(session.id, open)} detailsId={id} title={`${session.title || m.untitled} · ${date(session.scheduledAt)}`} colSpan={4} hideTitle
            summary={<>
              <TableCell><div className="flex min-w-0 items-center gap-1"><DashboardRowDisclosure expanded={isOpen} controls={id} label={m.open} onToggle={() => changeSession(session.id, !isOpen)} />
                <div className="min-w-0"><p className="truncate leading-5">{session.title || m.untitled}</p><p className="text-[11px] text-muted">{date(session.scheduledAt)}</p></div>
              </div></TableCell>
              <TableCell className="text-muted"><p>{t(session.endedAt ? "records.ended" : session.startedAt ? "records.started" : "records.notStarted")}</p><p className="mt-0.5 text-[11px]">{m.attendance} {session.attendanceCount}</p></TableCell>
              <TableCell>{observation ? <TeachingPerformance value={observation} inline /> : observation === null
                ? <div className="flex items-center gap-1 text-[11px] text-muted"><span>{m.observationsFailed}</span><Button variant="ghost" size="sm" className="h-7 px-1 text-[11px]" onClick={() => retryObservation(session.id)}>{m.retry}</Button></div>
                : <span role="status" className="text-[11px] text-muted">{m.observationsLoading}</span>}</TableCell>
              <TableCell className="text-muted">{observation ? <TeachingCoverage value={observation} reviewCount={reviewCount} /> : <span>{m.reviews} {reviewCount}</span>}</TableCell>
            </>}>
            {() => <div data-class-session-editor data-session-id={session.id}>
              <ClassRosterSessionDetail sessionId={session.id} classroomId={classroomId} locale={locale} timeZone={timeZone} now={now} onDirtyChange={onDirtyChange}
                onReviewCountChange={count => setReviewCounts(current => ({ ...current, [session.id]: count }))} />
            </div>}
          </FollowupRecordRow>;
        })}
      </TableBody>
    </Table> : <p className="py-2 text-xs text-muted">{m.noSessions}</p>}
  </FollowupRecordRow>;
}
