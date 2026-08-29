import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { loadLecturePreview, parseCoursewareTrack } from "@/features/courseware-studio/data";
import { getCourseFamilyDetail, isUuid } from "@/features/school/teaching-operations/course-family-detail";
import { CourseFamilyRisks, CourseFamilySummary, CourseVariantReadiness } from "@/features/school/teaching-operations/CourseAsidePanels";
import { ResponsibilityPanel } from "@/features/school/teaching-operations/ResponsibilityPanel";
import { StatusOverflowMenu } from "@/features/school/teaching-operations/StatusOverflowMenu";
import { TeachingPlan } from "@/features/school/teaching-operations/TeachingPlan";
import { TeachingPlanEditorLauncher } from "@/features/school/teaching-operations/TeachingPlanEditorLauncher";
import { TeacherMicrocourseLibrary } from "@/features/school/teaching-operations/TeacherMicrocourseLibrary";
import { transitionCourseFamilyStatusAction, transitionCourseVariantStatusAction } from "@/features/school/teaching-operations/actions";
import { UsagePanel } from "@/features/school/teaching-operations/UsagePanel";
import { VariantMatrix } from "@/features/school/teaching-operations/VariantMatrix";
import { VariantSelector } from "@/features/school/teaching-operations/VariantSelector";
import { resolveCourseCapabilities } from "@/features/school/teaching-operations/capabilities";
import type { SelectedCourseVariant } from "@/features/school/teaching-operations/course-family-detail";
import {
  filterTeacherMicrocourseLibrary,
  listTeacherMicrocourseLibrary,
  parseTeacherMicrocourseLibraryFilters,
  teacherMicrocourseLibrarySearchParams,
  type TeacherMicrocourseLibraryEntry,
} from "@/features/school/teaching-operations/teacher-microcourse-library";
import { LecturePreviewDialog } from "@/features/school/curriculum/LecturePreviewDialog";
import { LecturePreviewPanel } from "@/features/school/curriculum/LecturePreviewPanel";
import {
  DashboardAside,
  DashboardCard,
  DashboardContentGrid,
  DashboardMainColumn,
  DashboardReadingColumn,
} from "@/features/school/dashboard-page";
import {
  ObjectBar,
  ObjectContextSwitcher,
  ObjectWorkspace,
  parseReturnTo,
  preserveReturnTo,
  type ObjectContextItem,
} from "@/features/school/object-workspace";
import { listStaffOptions } from "@/features/school/classes";
import { Link } from "@/i18n/navigation";
import { getActiveEnvironment, getMyPerms, requirePerm } from "@/lib/auth";
import { cn } from "@/lib/utils";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parsePage(value: string | undefined) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function familyHref(familyId: string, variantId: string) {
  return `/dashboard/courses/${familyId}?variant=${variantId}`;
}

export default async function CourseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; courseFamilyId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <div className="w-full min-w-0">
    <Suspense fallback={<div className="mt-6 h-96 animate-pulse rounded-2xl border border-line bg-card" />}>
      <CourseFamilyProductPage locale={locale} params={params} searchParams={searchParams} />
    </Suspense>
  </div>;
}

async function CourseFamilyProductPage({
  locale,
  params,
  searchParams,
}: {
  locale: string;
  params: Promise<{ locale: string; courseFamilyId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ courseFamilyId }, rawSearchParams, user] = await Promise.all([params, searchParams, requirePerm(locale, "course.view")]);
  if (!isUuid(courseFamilyId)) notFound();
  const [t, permissions, staffOptions, environment] = await Promise.all([
    getTranslations("school.courses"),
    getMyPerms(user.id),
    listStaffOptions(),
    getActiveEnvironment(user.id),
  ]);
  // doc24 §6：课程产品可以从产品库进入，也可以从课件队列、研发任务和班级的课程链接进入。
  // 版本层不需要——它的父页面就是同一个对象的总览（§6 明确保留这条稳定父子关系）。
  const returnTo = environment ? parseReturnTo({ returnTo: rawSearchParams.returnTo, environment }) : null;
  const requestedVariantId = first(rawSearchParams.variant);

  // doc22 §5.16：这条路由只接受 Course Family ID。P4H 时期的「传 Variant ID 也认，
  // 查出所属 family 后 308」兼容已删除——旧 ID 让 URL 同时表达两种资源。
  //
  // 连带删掉的还有一次直接查 course_families 的预检：它当初唯一的作用就是分辨"这是
  // family 还是 legacy variant"。RPC 自己就会对不存在的 family 抛 COURSE_FAMILY_NOT_FOUND，
  // 下面已经接成 notFound()；多那一次读反而会踩 RLS 的可见性启发式。
  let detail;
  try {
    detail = await getCourseFamilyDetail(courseFamilyId, requestedVariantId);
  } catch (error) {
    if (error instanceof Error && error.message.includes("FORBIDDEN_SCOPE")) {
      return <DashboardCard title={t("familyScopeUnavailableTitle")} description={t("familyScopeUnavailableHint")}>
        <Link href="/dashboard/courses" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>{t("backToLibrary")}</Link>
      </DashboardCard>;
    }
    if (error instanceof Error && (error.message.includes("COURSE_FAMILY_NOT_FOUND") || error.message.includes("COURSE_VARIANT_NOT_IN_FAMILY"))) notFound();
    throw error;
  }

  const canManage = permissions.has("course.manage");
  const canAssign = permissions.has("course.assignment.manage");
  const identity: ObjectContextItem[] = [detail.family.publisher, detail.family.stage, detail.family.subject, detail.family.edition]
    .filter(Boolean)
    .map((value) => ({ value }));
  const familyStatusBadge = <>
    <Badge variant={detail.family.status === "enabled" ? "secondary" : "outline"}>{t(detail.family.status)}</Badge>
    {detail.family.purpose === "test" && <Badge variant="outline">{t("test")}</Badge>}
  </>;

  if (detail.family.slug === "teacher-microcourses") {
    const filters = parseTeacherMicrocourseLibraryFilters(rawSearchParams);
    const catalogItems = await listTeacherMicrocourseLibrary(detail.family.id);
    const variantsById = new Map(detail.variants.map((variant) => [variant.id, variant]));
    const entries = catalogItems.flatMap((item): TeacherMicrocourseLibraryEntry[] => {
      const variant = variantsById.get(item.courseId);
      return variant ? [{ ...item, ...variant }] : [];
    });
    const filteredEntries = filterTeacherMicrocourseLibrary(entries, filters);
    const selectedId = requestedVariantId && filteredEntries.some((entry) => entry.id === requestedVariantId)
      ? requestedVariantId
      : filteredEntries[0]?.id;

    if (selectedId && detail.selectedVariant?.id !== selectedId) {
      detail = await getCourseFamilyDetail(detail.family.id, selectedId);
    }
    const selectedEntry = entries.find((entry) => entry.id === selectedId) ?? null;
    const lectureId = first(rawSearchParams.lecture);
    const requestedLecture = detail.teachingPlan.find((lecture) => lecture.id === lectureId);
    const previewTrack = parseCoursewareTrack(rawSearchParams.track);
    const preview = requestedLecture?.hasRelease
      ? await loadLecturePreview(requestedLecture.id, previewTrack, parsePage(first(rawSearchParams.page)))
      : null;
    const validPreview = preview?.lecture.courseId === selectedId ? preview : null;
    const selectedParams = teacherMicrocourseLibrarySearchParams(filters);
    if (selectedId) selectedParams.set("variant", selectedId);
    if (returnTo) selectedParams.set("returnTo", returnTo);
    const selectedBaseHref = `/dashboard/courses/${detail.family.id}${selectedParams.size ? `?${selectedParams.toString()}` : ""}`;
    const lecturePreview = validPreview ? <LecturePreviewDialog
      title={t("lecturePreviewTitle", { no: validPreview.lecture.no, name: validPreview.lecture.name })}
      closeHref={selectedBaseHref}
    >
      <LecturePreviewPanel
        preview={validPreview}
        baseHref={selectedBaseHref}
        workspaceHref={`/dashboard/courseware/lectures/${validPreview.lecture.id}?track=${validPreview.track}`}
      />
    </LecturePreviewDialog> : undefined;

    return <TeacherMicrocourseLibrary
      detail={detail}
      entries={entries}
      filteredEntries={filteredEntries}
      selectedEntry={selectedEntry}
      filters={filters}
      locale={locale}
      returnTo={returnTo}
      canManage={canManage}
      canAssign={canAssign}
      canCreateClass={permissions.has("class.create")}
      canViewUsage={permissions.has("class.view.all")}
      staffOptions={staffOptions}
      lecturePreview={lecturePreview}
    />;
  }

  if (!detail.selectedVariant) {
    // doc23 §8.1 Family 蓝图：主栏是"这个产品由哪些版本组成"，侧栏是"它整体齐不齐、归谁管"。
    // 原来责任面板排在版本矩阵之下，属于滚到底才看得见的决策前提。
    return <ObjectWorkspace
      objectBar={<ObjectBar
        title={detail.family.title}
        backHref={returnTo ?? "/dashboard/courses"}
        backLabel={t("backToLibrary")}
        context={identity}
        status={familyStatusBadge}
        overflowSlot={canManage ? <StatusOverflowMenu id={detail.family.id} status={detail.family.status} action={transitionCourseFamilyStatusAction} ariaLabel={t("moreActions")} /> : undefined}
      />}
    >
      <DashboardContentGrid>
        <DashboardMainColumn className="flex flex-col gap-5">
          <DashboardCard title={t("familyDescription")}>
            <DashboardReadingColumn>
              <p className="text-sm leading-6 text-muted">{detail.family.description || t("familyDescriptionEmpty")}</p>
            </DashboardReadingColumn>
          </DashboardCard>
          <VariantMatrix familyId={detail.family.id} variants={detail.variants} catalogVersions={detail.catalogVersions} canManage={canManage} />
        </DashboardMainColumn>

        <DashboardAside>
          <CourseFamilySummary variants={detail.variants} />
          <ResponsibilityPanel
            scopeType="family"
            scopeId={detail.family.id}
            assignments={detail.familyAssignments}
            staffOptions={staffOptions}
            canManage={canAssign}
            title={t("familyResponsibility")}
          />
          <CourseFamilyRisks familyId={detail.family.id} variants={detail.variants} />
        </DashboardAside>
      </DashboardContentGrid>
    </ObjectWorkspace>;
  }

  const selectedVariant: SelectedCourseVariant = detail.selectedVariant;
  const canCreateClass = permissions.has("class.create");
  const canEditCourseware = permissions.has("courseware.page.edit");
  const baseHref = familyHref(detail.family.id, selectedVariant.id);
  const lectureId = first(rawSearchParams.lecture);
  const requestedLecture = detail.teachingPlan.find((lecture) => lecture.id === lectureId);
  const previewTrack = parseCoursewareTrack(rawSearchParams.track);
  const preview = requestedLecture?.hasRelease
    ? await loadLecturePreview(requestedLecture.id, previewTrack, parsePage(first(rawSearchParams.page)))
    : null;
  const validPreview = preview?.lecture.courseId === selectedVariant.id ? preview : null;

  const variantTrashed = Boolean(detail.variants.find((variant) => variant.id === selectedVariant.id)?.trashedAt);
  const capabilities = resolveCourseCapabilities({
    canViewCourse: true,
    canManageCourse: canManage,
    canEditCoursewarePage: canEditCourseware,
    canPublishCoursewareRelease: permissions.has("courseware.release.publish"),
    canViewAllClasses: permissions.has("class.view.all"),
    canCreateClass,
    courseStatus: selectedVariant.status,
    courseTrashed: variantTrashed,
  });

  const primaryAction = capabilities.canEditTeachingPlan && detail.teachingPlan.length === 0
    ? <TeachingPlanEditorLauncher familyId={detail.family.id} selectedVariant={selectedVariant} lectures={detail.teachingPlan} canEditCourseware={canEditCourseware} label={t("editTeachingPlan")} />
    : capabilities.canCreateClass && selectedVariant.status === "enabled"
      ? <Link href={`/dashboard/classes/new?courseId=${selectedVariant.id}`} className={buttonVariants({ size: "sm" })}>{t("useVariantForClass")}</Link>
      : undefined;

  return <ObjectWorkspace
    objectBar={<ObjectBar
      title={selectedVariant.title}
      backHref={preserveReturnTo(`/dashboard/courses/${detail.family.id}`, returnTo)}
      backLabel={t("backToOverview")}
      // 只留产品码。年级 / 季节 / 班型这三维就在下面的 ObjectContextSwitcher 里高亮着，
      // 在身份行再说一遍是同一屏两份同样的信息（§15），移动端还要多占一整行 sticky 高度。
      // 换代后同一枚产品编码在新旧两个年度版本里各有一门课，只显示编码分辨不出是哪一门。
      context={[
        ...(selectedVariant.catalogVersionSlug === "default" ? [] : [{ value: selectedVariant.catalogVersionTitle }]),
        { value: selectedVariant.productCode ?? "—" },
      ]}
      status={<>
        <Badge variant={selectedVariant.status === "enabled" ? "secondary" : "outline"}>{t(selectedVariant.status)}</Badge>
        {selectedVariant.supersededByCourseId && <Badge variant="outline">{t("superseded")}</Badge>}
      </>}
      primaryAction={primaryAction}
      overflowSlot={capabilities.canTransitionVariant ? <StatusOverflowMenu id={selectedVariant.id} status={selectedVariant.status} action={transitionCourseVariantStatusAction} ariaLabel={t("moreActions")} /> : undefined}
    />}
    navigation={<ObjectContextSwitcher label={t("variantContextLabel")}>
      <VariantSelector familyId={detail.family.id} variants={detail.variants} catalogVersions={detail.catalogVersions} current={selectedVariant} />
    </ObjectContextSwitcher>}
  >
    {/* doc23 §8.2 Variant 蓝图：主栏只有教学计划——这一页的工作就是它；
        就绪度、在用班级、责任分配都是做这件事时要参考的稳定信息，进侧栏。 */}
    <DashboardContentGrid>
      <DashboardMainColumn>
        <TeachingPlan baseHref={baseHref} teachingPlan={detail.teachingPlan} canManage={canManage} />
      </DashboardMainColumn>

      <DashboardAside>
        <CourseVariantReadiness readiness={detail.readiness} />
        {capabilities.canViewUsingClasses && <UsagePanel usage={detail.usage} returnTo={baseHref} />}
        <ResponsibilityPanel
          scopeType="variant"
          scopeId={selectedVariant.id}
          assignments={detail.variantAssignments}
          staffOptions={staffOptions}
          canManage={canAssign}
          title={t("variantResponsibility")}
        />
      </DashboardAside>
    </DashboardContentGrid>
    {validPreview && (
      <LecturePreviewDialog title={t("lecturePreviewTitle", { no: validPreview.lecture.no, name: validPreview.lecture.name })} closeHref={baseHref}>
        <LecturePreviewPanel preview={validPreview} baseHref={baseHref} workspaceHref={`/dashboard/courseware/lectures/${validPreview.lecture.id}?track=${validPreview.track}`} />
      </LecturePreviewDialog>
    )}
  </ObjectWorkspace>;
}
