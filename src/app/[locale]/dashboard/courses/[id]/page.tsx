import { Suspense } from "react";
import { BookOpen } from "lucide-react";
import { notFound, permanentRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { findCourseFamilyForLegacyVariant, getCourseFamilyDetail, isUuid } from "@/features/school/teaching-operations/course-family-detail";
import { ResponsibilityPanel } from "@/features/school/teaching-operations/ResponsibilityPanel";
import { StatusOverflowMenu } from "@/features/school/teaching-operations/StatusOverflowMenu";
import { TeachingPlan } from "@/features/school/teaching-operations/TeachingPlan";
import { TeachingPlanEditorLauncher } from "@/features/school/teaching-operations/TeachingPlanEditorLauncher";
import { transitionCourseFamilyStatusAction, transitionCourseVariantStatusAction } from "@/features/school/teaching-operations/actions";
import { UsagePanel } from "@/features/school/teaching-operations/UsagePanel";
import { VariantMatrix } from "@/features/school/teaching-operations/VariantMatrix";
import { VariantSelector } from "@/features/school/teaching-operations/VariantSelector";
import { resolveCourseCapabilities } from "@/features/school/teaching-operations/capabilities";
import type { SelectedCourseVariant } from "@/features/school/teaching-operations/course-family-detail";
import { ObjectBar } from "@/features/school/stage/ObjectBar";
import { ObjectWorkspace } from "@/features/school/stage/ObjectWorkspace";
import { listStaffOptions } from "@/features/school/classes";
import { Link } from "@/i18n/navigation";
import { getMyPerms, requirePerm } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function familyHref(familyId: string, variantId: string) {
  return `/dashboard/courses/${familyId}?variant=${variantId}`;
}

export default async function CourseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <div className="mx-auto w-full max-w-6xl">
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
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, rawSearchParams, user] = await Promise.all([params, searchParams, requirePerm(locale, "course.view")]);
  if (!isUuid(id)) notFound();
  const [t, permissions, staffOptions] = await Promise.all([
    getTranslations("school.courses"),
    getMyPerms(user.id),
    listStaffOptions(),
  ]);
  const requestedVariantId = first(rawSearchParams.variant);

  const supabase = await createClient();
  const { data: family, error: familyError } = await supabase.from("course_families").select("id").eq("id", id).maybeSingle();
  if (familyError) throw new Error(familyError.message);
  const familyId = family?.id ?? await findCourseFamilyForLegacyVariant(id);
  if (!familyId) notFound();

  let detail;
  try {
    detail = await getCourseFamilyDetail(familyId, family ? requestedVariantId : id);
  } catch (error) {
    if (error instanceof Error && error.message.includes("FORBIDDEN_SCOPE")) {
      return <section className="mt-6 rounded-2xl border border-line bg-card p-6"><h1 className="font-display text-2xl text-ink">{t("familyScopeUnavailableTitle")}</h1><p className="mt-2 text-sm text-muted">{t("familyScopeUnavailableHint")}</p><Link href="/dashboard/courses" className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "mt-5")}>{t("backToLibrary")}</Link></section>;
    }
    if (error instanceof Error && (error.message.includes("COURSE_FAMILY_NOT_FOUND") || error.message.includes("COURSE_VARIANT_NOT_IN_FAMILY"))) notFound();
    throw error;
  }

  if (!family) {
    if (!detail.selectedVariant) notFound();
    permanentRedirect(familyHref(detail.family.id, detail.selectedVariant.id));
  }

  const canManage = permissions.has("course.manage");
  const canAssign = permissions.has("course.assignment.manage");
  const identity = [detail.family.publisher, detail.family.stage, detail.family.subject, detail.family.edition].filter(Boolean).join(" · ");
  const familyStatusBadge = <>
    <Badge variant={detail.family.status === "enabled" ? "secondary" : "outline"}>{t(detail.family.status)}</Badge>
    {detail.family.purpose === "test" && <Badge variant="outline">{t("test")}</Badge>}
  </>;

  if (!detail.selectedVariant) {
    return <ObjectWorkspace
      objectBar={<ObjectBar
        title={detail.family.title}
        backHref="/dashboard/courses"
        backLabel={t("backToLibrary")}
        context={identity}
        status={familyStatusBadge}
        overflowSlot={canManage ? <StatusOverflowMenu id={detail.family.id} status={detail.family.status} action={transitionCourseFamilyStatusAction} ariaLabel={t("moreActions")} /> : undefined}
      />}
    >
      {detail.family.description && <p className="max-w-3xl text-sm leading-6 text-muted">{detail.family.description}</p>}
      <div className="mt-5">
        <VariantMatrix familyId={detail.family.id} variants={detail.variants} canManage={canManage} />
      </div>
      <div className="mt-6">
        <ResponsibilityPanel
          scopeType="family"
          scopeId={detail.family.id}
          assignments={detail.familyAssignments}
          staffOptions={staffOptions}
          canManage={canAssign}
          title={t("familyResponsibility")}
        />
      </div>
    </ObjectWorkspace>;
  }

  const selectedVariant: SelectedCourseVariant = detail.selectedVariant;
  const canCreateClass = permissions.has("class.create");
  const canEditCourseware = permissions.has("courseware.page.edit");

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
      backHref={`/dashboard/courses/${detail.family.id}`}
      backLabel={t("backToOverview")}
      context={`${selectedVariant.productCode ?? "—"}`}
      status={<Badge variant={selectedVariant.status === "enabled" ? "secondary" : "outline"}>{t(selectedVariant.status)}</Badge>}
      primaryAction={primaryAction}
      overflowSlot={capabilities.canTransitionVariant ? <StatusOverflowMenu id={selectedVariant.id} status={selectedVariant.status} action={transitionCourseVariantStatusAction} ariaLabel={t("moreActions")} /> : undefined}
    />}
  >
    <div className="rounded-2xl border border-line bg-card p-5 sm:p-6">
      <div className="grid gap-6 lg:grid-cols-[12rem_minmax(0,1fr)]">
        <div className="flex aspect-[4/3] w-full max-w-xs items-center justify-center rounded-2xl border border-crater/30 bg-moon/40 text-crater"><BookOpen className="size-14" strokeWidth={1.35} aria-hidden="true" /></div>
        <div className="min-w-0">
          <p className="text-sm text-muted">{identity}</p>
          <VariantSelector familyId={detail.family.id} variants={detail.variants} current={selectedVariant} />
          <div className="mt-5 rounded-xl border border-line bg-paper p-4"><dl className="grid gap-3 sm:grid-cols-3"><div><dt className="text-xs text-muted">{t("lectures")}</dt><dd className="mt-1 font-medium">{detail.readiness.lectureCount}</dd></div><div><dt className="text-xs text-muted">{t("publishedLectures")}</dt><dd className="mt-1 font-medium">{detail.readiness.releasedLectureCount}</dd></div><div><dt className="text-xs text-muted">{t("incompleteLectures")}</dt><dd className="mt-1 font-medium">{Math.max(0, detail.readiness.lectureCount - detail.readiness.releasedLectureCount)}</dd></div></dl></div>
        </div>
      </div>
    </div>
    <TeachingPlan teachingPlan={detail.teachingPlan} canManage={canManage} />
    <div className="mt-6 grid gap-4 lg:grid-cols-2">
      {capabilities.canViewUsingClasses && <UsagePanel usage={detail.usage} />}
      <ResponsibilityPanel
        scopeType="variant"
        scopeId={selectedVariant.id}
        assignments={detail.variantAssignments}
        staffOptions={staffOptions}
        canManage={canAssign}
        title={t("variantResponsibility")}
      />
    </div>
  </ObjectWorkspace>;
}
