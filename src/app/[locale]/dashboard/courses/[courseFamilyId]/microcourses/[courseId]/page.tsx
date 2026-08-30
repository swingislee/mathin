import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { loadLecturePreview, parseCoursewareTrack } from "@/features/courseware-studio/data";
import { listStaffOptions } from "@/features/school/classes";
import { LecturePreviewDialog } from "@/features/school/curriculum/LecturePreviewDialog";
import { LecturePreviewPanel } from "@/features/school/curriculum/LecturePreviewPanel";
import { CourseVariantReadiness } from "@/features/school/teaching-operations/CourseAsidePanels";
import { ResponsibilityPanel } from "@/features/school/teaching-operations/ResponsibilityPanel";
import { TeachingPlan } from "@/features/school/teaching-operations/TeachingPlan";
import { UsagePanel } from "@/features/school/teaching-operations/UsagePanel";
import { getCourseFamilyDetail, isUuid } from "@/features/school/teaching-operations/course-family-detail";
import { Link } from "@/i18n/navigation";
import { getMyPerms, requirePerm } from "@/lib/auth";
import { cn } from "@/lib/utils";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parsePage(value: string | undefined) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export default async function TeacherMicrocourseDetailPage({ params, searchParams }: {
  params: Promise<{ locale: string; courseFamilyId: string; courseId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <Suspense fallback={<div className="h-[36rem] animate-pulse rounded-2xl border border-line bg-card" />}>
    <TeacherMicrocourseDetailContent params={params} searchParams={searchParams} />
  </Suspense>;
}

async function TeacherMicrocourseDetailContent({ params, searchParams }: {
  params: Promise<{ locale: string; courseFamilyId: string; courseId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale, courseFamilyId, courseId }, query] = await Promise.all([params, searchParams]);
  const user = await requirePerm(locale, "course.view");
  if (!isUuid(courseFamilyId) || !isUuid(courseId)) notFound();
  const [detail, permissions, staffOptions, t, browserT] = await Promise.all([
    getCourseFamilyDetail(courseFamilyId, courseId),
    getMyPerms(user.id),
    listStaffOptions(),
    getTranslations("school.courses"),
    getTranslations("school.teacherMicrocourseBrowser"),
  ]);
  if (detail.family.slug !== "teacher-microcourses" || detail.selectedVariant?.id !== courseId) notFound();
  const lectureId = first(query.lecture);
  const lecture = detail.teachingPlan.find((item) => item.id === lectureId);
  const track = parseCoursewareTrack(query.track);
  const preview = lecture?.hasRelease ? await loadLecturePreview(lecture.id, track, parsePage(first(query.page))) : null;
  const baseHref = `/dashboard/courses/${courseFamilyId}/microcourses/${courseId}?course=${courseId}`;
  const activeTab = first(query.tab) === "maintenance" || first(query.tab) === "history" ? first(query.tab)! : "content";
  const canManage = permissions.has("course.manage");

  return <div className="w-full min-w-0 space-y-5">
    <Card><CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap gap-2"><Badge variant="secondary">{browserT("currentDefault")}</Badge><Badge variant={detail.readiness.lectureCount > 0 && detail.readiness.lectureCount === detail.readiness.releasedLectureCount ? "secondary" : "outline"}>{detail.readiness.releasedLectureCount}/{detail.readiness.lectureCount}</Badge></div><CardTitle className="mt-3 font-display text-2xl">{detail.selectedVariant.title}</CardTitle><CardDescription>{browserT("fullCourseDescription")}</CardDescription></div><Link href={`/dashboard/courses/${courseFamilyId}?course=${courseId}`} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>{browserT("backToBrowser")}</Link></CardHeader></Card>
    <Tabs defaultValue={activeTab}>
      <TabsList><TabsTrigger value="content">{t("microcourseContentTab")}</TabsTrigger><TabsTrigger value="maintenance">{browserT("maintenance")}</TabsTrigger><TabsTrigger value="history">{browserT("history")}</TabsTrigger></TabsList>
      <TabsContent value="content"><Card><CardContent><TeachingPlan baseHref={baseHref} teachingPlan={detail.teachingPlan} canManage={canManage} /></CardContent></Card></TabsContent>
      <TabsContent value="maintenance"><div className="grid gap-4 @5xl/page:grid-cols-3"><CourseVariantReadiness readiness={detail.readiness} /><ResponsibilityPanel scopeType="variant" scopeId={courseId} assignments={detail.variantAssignments} staffOptions={staffOptions} canManage={permissions.has("course.assignment.manage")} title={t("variantResponsibility")} />{permissions.has("class.view.all") && <UsagePanel usage={detail.usage} returnTo={baseHref} />}</div></TabsContent>
      <TabsContent value="history"><Card><CardHeader><CardTitle>{browserT("maintenanceHistory")}</CardTitle><CardDescription>{browserT("historyCollapsedHint")}</CardDescription></CardHeader></Card></TabsContent>
    </Tabs>
    {preview?.lecture.courseId === courseId && <LecturePreviewDialog title={t("lecturePreviewTitle", { no: preview.lecture.no, name: preview.lecture.name })} closeHref={baseHref}><LecturePreviewPanel preview={preview} baseHref={baseHref} workspaceHref={`/dashboard/courseware/lectures/${preview.lecture.id}?track=${preview.track}`} /></LecturePreviewDialog>}
  </div>;
}
