import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { loadLecturePreview, parseCoursewareTrack } from "@/features/courseware-studio/data";
import { LecturePreviewDialog } from "@/features/school/curriculum/LecturePreviewDialog";
import { LecturePreviewPanel } from "@/features/school/curriculum/LecturePreviewPanel";
import { TeachingPlan } from "@/features/school/teaching-operations/TeachingPlan";
import { DashboardSection } from "@/features/school/dashboard-page";
import { ObjectBar, ObjectTabs, ObjectWorkspace } from "@/features/school/object-workspace";
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
  return <Suspense fallback={<div className="h-[36rem] animate-pulse border-y border-line bg-paper/30" />}>
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

  return <ObjectWorkspace
    objectBar={<ObjectBar
      title={course.course.title}
      backHref={`/dashboard/courses/${courseFamilyId}?course=${courseId}`}
      backLabel={browserT("backToBrowser")}
      context={[
        { value: course.course.description || browserT("fullCourseDescription") },
        { value: browserT("courseCreatedBy", { name: course.course.createdByName }) },
        { value: `${releasedCount}/${course.lectures.length}` },
      ]}
      status={<><Badge variant="secondary">{browserT("currentDefault")}</Badge><Badge variant={course.course.defaultCommitId ? "secondary" : "outline"}>{course.course.defaultCommitId ? browserT("published") : browserT("noDefaultVersion")}</Badge></>}
      primaryAction={<TeacherMicrocourseAddLectureDialog familyId={courseFamilyId} course={course} />}
    />}
    navigation={<ObjectTabs
      ariaLabel={course.course.title}
      activeValue={activeTab}
      items={[
        { value: "content", label: t("microcourseContentTab"), href: baseHref },
        { value: "maintenance", label: browserT("maintenance"), href: `${baseHref}&tab=maintenance` },
        { value: "history", label: browserT("history"), href: `${baseHref}&tab=history` },
      ]}
    />}
  >
    {activeTab === "content" ? <DashboardSection title={browserT("courseContent")} description={course.lectures.length ? browserT("courseContentHint") : browserT("emptyCourseHint")}><TeachingPlan baseHref={baseHref} teachingPlan={teachingPlan} canManage={course.capabilities.canAddLecture} showHeader={false} /></DashboardSection> : null}
    {activeTab === "maintenance" ? <TeacherMicrocourseMaintenanceWorkspace familyId={courseFamilyId} course={course} memberManagement={memberManagement} staffOptions={staffOptions} section="branches" /> : null}
    {activeTab === "history" ? <TeacherMicrocourseMaintenanceWorkspace familyId={courseFamilyId} course={course} memberManagement={memberManagement} staffOptions={staffOptions} section="history" /> : null}
    {preview?.lecture.courseId === courseId && <LecturePreviewDialog title={t("lecturePreviewTitle", { no: preview.lecture.no, name: preview.lecture.name })} closeHref={baseHref}><LecturePreviewPanel preview={preview} baseHref={baseHref} workspaceHref={`/dashboard/courseware/lectures/${preview.lecture.id}?track=${preview.track}`} /></LecturePreviewDialog>}
  </ObjectWorkspace>;
}
