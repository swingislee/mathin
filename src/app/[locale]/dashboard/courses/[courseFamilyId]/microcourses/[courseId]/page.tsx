import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { loadLecturePreview, parseCoursewareTrack } from "@/features/courseware-studio/data";
import { LecturePreviewDialog } from "@/features/school/curriculum/LecturePreviewDialog";
import { LecturePreviewPanel } from "@/features/school/curriculum/LecturePreviewPanel";
import { TeachingPlan } from "@/features/school/teaching-operations/TeachingPlan";
import { listStaffOptions } from "@/features/school/classes";
import { TeacherMicrocourseAddLectureDialog, TeacherMicrocourseMaintenanceWorkspace } from "@/features/school/teaching-operations/TeacherMicrocourseMaintenanceWorkspace";
import { getTeacherMicrocourseBranchMembers, getTeacherMicrocourseCatalogCourse } from "@/features/school/teaching-operations/teacher-microcourse-maintenance";
import { Link } from "@/i18n/navigation";
import { requirePerm } from "@/lib/auth";
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
  await requirePerm(locale, "course.view");
  const [course, t, browserT] = await Promise.all([
    getTeacherMicrocourseCatalogCourse(courseId).catch(() => notFound()),
    getTranslations("school.courses"),
    getTranslations("school.teacherMicrocourseBrowser"),
  ]);
  if (course.course.familyId !== courseFamilyId) notFound();
  const [memberManagement, staffOptions] = await Promise.all([
    getTeacherMicrocourseBranchMembers(courseId),
    listStaffOptions(),
  ]);
  const lectureId = first(query.lecture);
  const lecture = course.lectures.find((item) => item.id === lectureId);
  const track = parseCoursewareTrack(query.track);
  const preview = lecture?.currentReleaseId ? await loadLecturePreview(lecture.id, track, parsePage(first(query.page))) : null;
  const baseHref = `/dashboard/courses/${courseFamilyId}/microcourses/${courseId}?course=${courseId}`;
  const activeTab = first(query.tab) === "maintenance" || first(query.tab) === "history" ? first(query.tab)! : "content";
  const releasedCount = course.lectures.filter((item) => item.currentReleaseId !== null).length;
  const teachingPlan = course.lectures.map((item) => ({
    id: item.id,
    no: item.no,
    name: item.name,
    objectives: item.objectives,
    status: item.status,
    archivedAt: null,
    hasRelease: item.currentReleaseId !== null,
    pageCount: item.pageCount,
  }));

  return <div className="w-full min-w-0 space-y-5">
    <Card><CardHeader className="gap-4 @3xl/page:flex-row @3xl/page:items-start @3xl/page:justify-between"><div><div className="flex flex-wrap gap-2"><Badge variant="secondary">{browserT("currentDefault")}</Badge><Badge variant={course.course.defaultCommitId ? "secondary" : "outline"}>{course.course.defaultCommitId ? browserT("published") : browserT("noDefaultVersion")}</Badge><Badge variant={course.lectures.length > 0 && course.lectures.length === releasedCount ? "secondary" : "outline"}>{releasedCount}/{course.lectures.length}</Badge></div><CardTitle className="mt-3 font-display text-2xl">{course.course.title}</CardTitle><CardDescription>{course.course.description || browserT("fullCourseDescription")}</CardDescription><p className="mt-2 text-xs text-muted">{browserT("courseCreatedBy", { name: course.course.createdByName })}</p></div><div className="flex flex-wrap gap-2"><TeacherMicrocourseAddLectureDialog familyId={courseFamilyId} course={course} /><Link href={`/dashboard/courses/${courseFamilyId}?course=${courseId}`} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>{browserT("backToBrowser")}</Link></div></CardHeader></Card>
    <Tabs defaultValue={activeTab}>
      <TabsList><TabsTrigger value="content">{t("microcourseContentTab")}</TabsTrigger><TabsTrigger value="maintenance">{browserT("maintenance")}</TabsTrigger><TabsTrigger value="history">{browserT("history")}</TabsTrigger></TabsList>
      <TabsContent value="content"><Card><CardHeader><CardTitle>{browserT("courseContent")}</CardTitle><CardDescription>{course.lectures.length ? browserT("courseContentHint") : browserT("emptyCourseHint")}</CardDescription></CardHeader><CardContent><TeachingPlan baseHref={baseHref} teachingPlan={teachingPlan} canManage={course.capabilities.canAddLecture} /></CardContent></Card></TabsContent>
      <TabsContent value="maintenance"><TeacherMicrocourseMaintenanceWorkspace familyId={courseFamilyId} course={course} memberManagement={memberManagement} staffOptions={staffOptions} section="branches" /></TabsContent>
      <TabsContent value="history"><TeacherMicrocourseMaintenanceWorkspace familyId={courseFamilyId} course={course} memberManagement={memberManagement} staffOptions={staffOptions} section="history" /></TabsContent>
    </Tabs>
    {preview?.lecture.courseId === courseId && <LecturePreviewDialog title={t("lecturePreviewTitle", { no: preview.lecture.no, name: preview.lecture.name })} closeHref={baseHref}><LecturePreviewPanel preview={preview} baseHref={baseHref} workspaceHref={`/dashboard/courseware/lectures/${preview.lecture.id}?track=${preview.track}`} /></LecturePreviewDialog>}
  </div>;
}
