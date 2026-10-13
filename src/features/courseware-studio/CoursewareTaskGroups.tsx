"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { DashboardRowDisclosure } from "@/features/school/dashboard-page/DashboardRowDisclosure";
import { withReturnTo } from "@/features/school/object-workspace/return-target";
import { Link } from "@/i18n/navigation";
import type { CoursewareTaskItem } from "./data";
import type { CoursewareTaskFamily } from "./task-groups";

export function CoursewareTaskGroups({ groups, locale, baseHref, canEditCourseware, expandAll }: {
  groups: CoursewareTaskFamily[];
  locale: string;
  baseHref: string;
  canEditCourseware: boolean;
  expandAll: boolean;
}) {
  return <div className="divide-y divide-line">{groups.map(group => <FamilyGroup
    key={group.id} group={group} locale={locale} baseHref={baseHref}
    canEditCourseware={canEditCourseware} initiallyOpen={expandAll || groups.length === 1}
  />)}</div>;
}

function FamilyGroup({ group, locale, baseHref, canEditCourseware, initiallyOpen }: {
  group: CoursewareTaskFamily;
  locale: string;
  baseHref: string;
  canEditCourseware: boolean;
  initiallyOpen: boolean;
}) {
  const t = useTranslations("coursewareStudio");
  const tCourses = useTranslations("school.courses");
  const [open, setOpen] = useState(initiallyOpen);
  const controls = `courseware-family-${group.id}`;
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  return <section className="py-3 first:pt-0">
    <div className="flex flex-wrap items-center gap-2 py-2">
      <DashboardRowDisclosure expanded={open} label={group.title} controls={controls} onToggle={() => setOpen(!open)} />
      <h2 className="text-lg font-medium text-ink"><button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={controls}>{group.title}</button></h2>
      <span className="text-xs text-muted">{t("taskLectureCount", { count: group.lectureCount })}</span>
      <Link href={withReturnTo(`/dashboard/courses/${group.id}`, baseHref)} className="ml-auto text-xs text-muted hover:text-ink hover:underline">{t("taskCourseOverview")}</Link>
    </div>
    <div id={controls} hidden={!open} className="pl-7">
      {group.versions.map(version => <section key={version.id} className="py-2">
        <div className="mb-2 flex items-center gap-2 text-sm text-muted">
          <span>{version.title ?? tCourses("catalogVersion")}</span>
          {version.isCurrent && <Badge variant="outline">{t("taskCurrentVersion")}</Badge>}
        </div>
        {version.courses.map(course => <section key={course.id} className="mb-4 last:mb-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line py-2">
            <h3 className="font-medium text-ink"><Link href={withReturnTo(`/dashboard/courses/${group.id}?variant=${course.id}`, baseHref)} className="hover:underline">{course.title}</Link></h3>
            {course.productCode && <span className="text-xs text-muted">{course.productCode}</span>}
            <Link href={withReturnTo(`/dashboard/courses/${group.id}?variant=${course.id}`, baseHref)} className="ml-auto text-xs text-muted hover:text-ink hover:underline">{t("taskAllLectures")}</Link>
          </div>
          <ol className="divide-y divide-line">{course.lectures.map(lecture => <li key={lecture.id} className="grid gap-2 py-3 @3xl/page:grid-cols-[minmax(12rem,1fr)_minmax(25rem,1.3fr)] @3xl/page:gap-5">
            <div className="flex min-w-0 items-baseline gap-3">
              <span className="font-mono text-xs tabular-nums text-muted">{String(lecture.no).padStart(2, "0")}</span>
              <span className="text-sm font-medium text-ink">{lecture.name}</span>
            </div>
            <div className="grid gap-2">{lecture.tracks.map(item => <TrackActions key={item.track} item={item} baseHref={baseHref} canEditCourseware={canEditCourseware} dateTime={dateTime} />)}</div>
          </li>)}</ol>
        </section>)}
      </section>)}
    </div>
  </section>;
}

function TrackActions({ item, baseHref, canEditCourseware, dateTime }: {
  item: CoursewareTaskItem;
  baseHref: string;
  canEditCourseware: boolean;
  dateTime: Intl.DateTimeFormat;
}) {
  const t = useTranslations("coursewareStudio");
  const tCourses = useTranslations("school.courses");
  const editedAt = item.lastEditedAt ? dateTime.format(new Date(item.lastEditedAt)) : t("notYetEdited");
  const editLabel = item.lastEditorName ? t("editedByAt", { name: item.lastEditorName, time: editedAt }) : editedAt;
  const lectureHref = `/dashboard/courseware/lectures/${item.lectureId}`;
  return <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
    <span className="w-10 text-muted">{item.track === "adapted-4x3" ? "4:3" : "16:9"}</span>
    <span className="tabular-nums text-muted">{t("pagesCount", { count: item.pageCount })}</span>
    {item.hasDraft && <Badge variant="secondary">{t("draftState")}</Badge>}
    {item.releaseNo === null ? <Badge variant="outline">{t("notReleased")}</Badge> : <Badge variant="outline">{t("releaseNo", { no: item.releaseNo })}</Badge>}
    <div className="ml-auto flex flex-wrap items-center gap-1">
      {canEditCourseware && <Link href={withReturnTo(`${lectureHref}?workspace=courseware&canvas=${item.track}&track=${item.track}`, baseHref)} title={editLabel} className={buttonVariants({ variant: "secondary", size: "sm" })}>{t("taskEditDraft")}</Link>}
      {item.releaseNo !== null && <Link href={`${baseHref}&lecture=${item.lectureId}&track=${item.track}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>{tCourses("preview")}</Link>}
      <Link href={withReturnTo(`${lectureHref}?track=${item.track}`, baseHref)} className={buttonVariants({ variant: "ghost", size: "sm" })}>{t("taskLectureWorkflow")}</Link>
    </div>
    {item.lastEditedAt && <span className="w-full text-right text-[11px] text-muted">{editLabel}</span>}
  </div>;
}
