import { Suspense } from "react";
import { BookOpen } from "lucide-react";
import { notFound, permanentRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { CourseLecturePreviewDialog } from "@/features/school/teaching-operations/CourseLecturePreviewDialog";
import { findCourseFamilyForLegacyVariant, getCourseFamilyDetail, isUuid } from "@/features/school/teaching-operations/course-family-detail";
import { resolveCourseScope } from "@/features/school/teaching-operations/course-queries";
import { TeachingPlan } from "@/features/school/teaching-operations/TeachingPlan";
import { TeachingPlanEditorLauncher } from "@/features/school/teaching-operations/TeachingPlanEditorLauncher";
import { VariantSelector } from "@/features/school/teaching-operations/VariantSelector";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import { loadLecturePreview, parseCoursewareTrack } from "@/features/courseware-studio/data";
import { Link } from "@/i18n/navigation";
import { getMyPerms, requirePerm } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function familyHref(familyId: string, variantId: string, scope: string) {
  return `/dashboard/courses/${familyId}?variant=${variantId}&scope=${scope}`;
}

function parsePage(value: string | undefined) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
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
  const t = await getTranslations("school.courses");
  return <div className="mx-auto w-full max-w-6xl">
    <SchoolPageHeader title={t("title")} />
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
  const [t, permissions] = await Promise.all([getTranslations("school.courses"), getMyPerms(user.id)]);
  const scope = resolveCourseScope(rawSearchParams.scope, permissions);
  const requestedVariantId = first(rawSearchParams.variant);

  const supabase = await createClient();
  const { data: family, error: familyError } = await supabase.from("course_families").select("id").eq("id", id).maybeSingle();
  if (familyError) throw new Error(familyError.message);
  const familyId = family?.id ?? await findCourseFamilyForLegacyVariant(id);
  if (!familyId) notFound();

  let detail;
  try {
    detail = await getCourseFamilyDetail(familyId, family ? requestedVariantId : id, scope);
  } catch (error) {
    if (error instanceof Error && error.message.includes("FORBIDDEN_SCOPE")) {
      return <section className="mt-6 rounded-2xl border border-line bg-card p-6"><h1 className="font-display text-2xl text-ink">{t("familyScopeUnavailableTitle")}</h1><p className="mt-2 text-sm text-muted">{t("familyScopeUnavailableHint")}</p><Link href={`/dashboard/courses?scope=${scope}`} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "mt-5")}>{t("backToLibrary")}</Link></section>;
    }
    if (error instanceof Error && (error.message.includes("COURSE_FAMILY_NOT_FOUND") || error.message.includes("COURSE_VARIANT_NOT_IN_FAMILY"))) notFound();
    throw error;
  }

  if (!family) permanentRedirect(familyHref(detail.family.id, detail.selectedVariant.id, scope));

  const canManage = permissions.has("course.manage");
  const canCreateClass = permissions.has("class.create");
  const canEditCourseware = permissions.has("courseware.page.edit");
  const lectureId = first(rawSearchParams.lecture);
  const requestedLecture = detail.teachingPlan.find((lecture) => lecture.id === lectureId);
  const baseHref = familyHref(detail.family.id, detail.selectedVariant.id, scope);
  const track = parseCoursewareTrack(rawSearchParams.track);
  const preview = requestedLecture?.hasRelease
    ? await loadLecturePreview(requestedLecture.id, track, parsePage(first(rawSearchParams.page)))
    : null;
  const validPreview = preview?.lecture.courseId === detail.selectedVariant.id ? preview : null;

  return <>
    <section className="mt-6 rounded-2xl border border-line bg-card p-5 sm:p-6">
      <div className="grid gap-6 lg:grid-cols-[12rem_minmax(0,1fr)]">
        <div className="flex aspect-[4/3] w-full max-w-xs items-center justify-center rounded-2xl border border-crater/30 bg-moon/40 text-crater"><BookOpen className="size-14" strokeWidth={1.35} aria-hidden="true" /></div>
        <div className="min-w-0"><div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="font-display text-3xl text-ink">{detail.family.title}</h1><p className="mt-2 text-sm text-muted">{[detail.family.publisher, detail.family.stage, detail.family.subject, detail.family.edition].filter(Boolean).join(" · ")}</p></div><div className="flex gap-2"><Badge variant={detail.family.status === "enabled" ? "secondary" : "outline"}>{t(detail.family.status)}</Badge>{detail.family.purpose === "test" && <Badge variant="outline">{t("test")}</Badge>}</div></div>
          {detail.family.description && <p className="mt-4 max-w-3xl text-sm leading-6 text-muted">{detail.family.description}</p>}
          <VariantSelector detail={detail} scope={scope} />
          <div className="mt-5 rounded-xl border border-line bg-paper p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs text-muted">{t("currentVariant")}</p><p className="mt-1 font-medium text-ink">{detail.selectedVariant.title} · {detail.selectedVariant.productCode ?? "—"}</p></div><Badge variant={detail.selectedVariant.status === "enabled" ? "secondary" : "outline"}>{t(detail.selectedVariant.status)}</Badge></div><dl className="mt-4 grid gap-3 sm:grid-cols-3"><div><dt className="text-xs text-muted">{t("lectures")}</dt><dd className="mt-1 font-medium">{detail.readiness.lectureCount}</dd></div><div><dt className="text-xs text-muted">{t("publishedLectures")}</dt><dd className="mt-1 font-medium">{detail.readiness.releasedLectureCount}</dd></div><div><dt className="text-xs text-muted">{t("incompleteLectures")}</dt><dd className="mt-1 font-medium">{Math.max(0, detail.readiness.lectureCount - detail.readiness.releasedLectureCount)}</dd></div></dl></div>
          <div className="mt-5 flex flex-wrap gap-2"><a href="#teaching-plan" className={buttonVariants({ variant: "secondary", size: "sm" })}>{t("previewTeachingPlan")}</a>{canCreateClass && <Link href={`/dashboard/classes/new?courseId=${detail.selectedVariant.id}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>{t("useVariantForClass")}</Link>}{canManage && <TeachingPlanEditorLauncher familyId={detail.family.id} scope={scope} selectedVariant={detail.selectedVariant} lectures={detail.teachingPlan} canEditCourseware={canEditCourseware} label={t("editTeachingPlan")} />}</div>
        </div>
      </div>
    </section>
    {requestedLecture && !validPreview && <section className="mt-5 rounded-2xl border border-dashed border-line bg-card p-5"><h2 className="font-medium text-ink">{t("coursewareNotReleased")}</h2><p className="mt-1 text-sm text-muted">{t("coursewareNotReleasedHint")}</p><Link href={baseHref} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "mt-4")}>{t("closePreview")}</Link></section>}
    <TeachingPlan detail={detail} scope={scope} canManage={canManage} />
    {validPreview && <CourseLecturePreviewDialog preview={validPreview} baseHref={baseHref} canEditCourseware={canEditCourseware} />}
  </>;
}
