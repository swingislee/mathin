"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSearchParams } from "next/navigation";
import { Link, usePathname } from "@/i18n/navigation";
import { DashboardTableShell } from "./dashboard-page";
import { FollowupRecordRow, FollowupTableBody } from "./dashboard-page/FollowupRecordRow";
import { DashboardRowDisclosure } from "./dashboard-page/DashboardRowDisclosure";
import { withReturnTo } from "./object-workspace/return-target";
import { classroomWorkSessions, classroomWorkSessionHref, type ClassroomSessionBucket, type ClassroomWorkSession } from "./classroom-workbench-contract";
import type { ClassroomListItem } from "./teaching-operations/classroom-queries";

export function PersonalClassroomTable({ classrooms, sessions, locale, timeZone }: {
  classrooms: ClassroomListItem[]; sessions: ClassroomWorkSession[]; locale: string; timeZone: string;
}) {
  const t = useTranslations("school.classes");
  const en = locale === "en";
  const pathname = usePathname();
  const query = useSearchParams();
  const returnTo = `${pathname}${query.size ? `?${query}` : ""}`;
  const initialClass = classrooms.some(row => row.id === query.get("workClass")) ? query.get("workClass") : null;
  const [expanded, setExpanded] = useState<string | null>(initialClass);
  const [active, setActive] = useState<string | null>(initialClass);
  const [buckets, setBuckets] = useState<Record<string, ClassroomSessionBucket>>(() => initialClass ? { [initialClass]: query.get("workBucket") === "ended" ? "ended" : "upcoming" } : {});
  const sessionReturnTo = (classroomId: string, bucket: ClassroomSessionBucket) => {
    const next = new URLSearchParams(query); next.set("workClass", classroomId); next.set("workBucket", bucket);
    return `${pathname}?${next}`;
  };
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone });
  const open = (id: string, bucket: ClassroomSessionBucket) => { setBuckets(current => ({ ...current, [id]: bucket })); setExpanded(id); setActive(id); };
  return <DashboardTableShell data-followup-workbench data-personal-classroom-table>
    <Table className="min-w-[860px] text-xs" containerClassName="max-h-[75vh] overflow-auto">
      <TableHeader><TableRow>
        <TableHead className="sticky left-0 z-20 min-w-52 bg-card">{t("title")}</TableHead>
        <TableHead>{t("teachingTeam")}</TableHead><TableHead>{t("size")}</TableHead>
        <TableHead>{t("nextSession")}</TableHead><TableHead>{en ? "Lesson workspace" : "课次工作"}</TableHead>
      </TableRow></TableHeader>
      <FollowupTableBody onNavigate={key => { setActive(key); return true; }}>
        {classrooms.map(classroom => {
          const upcoming = classroomWorkSessions(sessions, classroom.id, "upcoming");
          const ended = classroomWorkSessions(sessions, classroom.id, "ended");
          const bucket = buckets[classroom.id] ?? (upcoming.length ? "upcoming" : "ended");
          const visible = bucket === "upcoming" ? upcoming : ended;
          const detailsId = `class-work-${classroom.id}`;
          return <FollowupRecordRow key={classroom.id} rowKey={classroom.id} active={active === classroom.id} expanded={expanded === classroom.id}
            onActivate={() => setActive(classroom.id)} onExpandedChange={value => setExpanded(value ? classroom.id : null)}
            title={`${classroom.name} · ${bucket === "ended" ? en ? "After-class records" : "课后记录" : en ? "Preparation" : "备课"}`} detailsId={detailsId} colSpan={5}
            summary={<>
              <TableCell className="sticky left-0 z-10 min-w-52 bg-inherit"><div className="flex items-center gap-1">
                <DashboardRowDisclosure expanded={expanded === classroom.id} label={classroom.name} controls={detailsId} onToggle={() => setExpanded(expanded === classroom.id ? null : classroom.id)} />
                <div><Link href={withReturnTo(`/dashboard/classes/${classroom.id}`, returnTo)} className="font-medium hover:underline">{classroom.name}</Link>
                  <p className="mt-1 text-muted">{[classroom.courseFamilyTitle, classroom.courseTitle, classroom.courseProductCode].filter(Boolean).join(" · ") || t("freeClass")}</p>
                  <Badge variant="outline" className="mt-1">{t(classroom.operationalStatus === "active" ? "operationalActive" : classroom.operationalStatus)}</Badge></div>
              </div></TableCell>
              <TableCell>{classroom.primaryTeacherName ?? t("noPrimaryTeacher")}{classroom.learningSupportNames.length > 0 && <p className="mt-1 text-muted">{t("learningSupport")}：{classroom.learningSupportNames.join("、")}</p>}</TableCell>
              <TableCell className="tabular-nums">{classroom.enrolledCount}{classroom.capacity ? ` / ${classroom.capacity}` : ""}</TableCell>
              <TableCell className="whitespace-nowrap text-muted">{classroom.nextSessionAt ? date.format(new Date(classroom.nextSessionAt)) : t("notApplicable")}</TableCell>
              <TableCell><div className="flex gap-2">{(["ended", "upcoming"] as const).map(value => <Button key={value} size="sm"
                variant={expanded === classroom.id && bucket === value ? "secondary" : "ghost"} aria-expanded={expanded === classroom.id && bucket === value}
                aria-controls={detailsId} onClick={() => open(classroom.id, value)}>
                {value === "ended" ? en ? "Completed" : "已上课" : en ? "Upcoming" : "待上课"} {value === "ended" ? ended.length : upcoming.length}
              </Button>)}</div></TableCell>
            </>}>
            <div className="divide-y divide-line">
              {!visible.length && <p className="py-3 text-muted">{en ? "No lessons in this group." : "暂无对应课次。"}</p>}
              {visible.map(session => <div key={session.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="min-w-40 text-muted">{session.scheduledAt ? date.format(new Date(session.scheduledAt)) : t("notApplicable")}</span>
                <span className="min-w-32 flex-1 font-medium">{session.title || (en ? "Untitled lesson" : "未命名课次")}</span>
                <Link className={buttonVariants({ size: "sm", variant: "secondary" })} href={withReturnTo(classroomWorkSessionHref(session), sessionReturnTo(classroom.id, bucket))}>
                  {session.endedAt ? en ? "After-class records" : "课后记录" : session.startedAt ? en ? "Live lesson" : "课堂进行中" : en ? "Prepare lesson" : "备课"}
                </Link>
              </div>)}
            </div>
          </FollowupRecordRow>;
        })}
      </FollowupTableBody>
    </Table>
  </DashboardTableShell>;
}
