import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { CoursewareWorkbenchBody } from "@/features/courseware-studio/CoursewareWorkbenchBody";
import {
  COURSEWARE_STUDIO_PERMS,
  loadCoursewareStudioPage,
  loadCoursewareWorkbenchContext,
  loadLecturePreview,
  parseCoursewareTrack,
} from "@/features/courseware-studio/data";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import { Link } from "@/i18n/navigation";
import { getMyPerms, requireAnyPerm } from "@/lib/auth";
import { cn } from "@/lib/utils";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function workbenchHref(
  lectureId: string,
  options: { mode?: "preview" | "edit"; page?: string | null; track: "native-16x9" | "adapted-4x3" },
) {
  const query = new URLSearchParams({ track: options.track });
  if (options.mode === "edit") query.set("mode", "edit");
  if (options.page) query.set("page", options.page);
  return `/dashboard/courseware/lectures/${lectureId}?${query.toString()}`;
}

function familyHref(familyId: string, courseId: string) {
  return `/dashboard/courses/${familyId}?variant=${courseId}&scope=research`;
}

export default async function CoursewareWorkbenchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; lectureId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("coursewareStudio");

  return <div className="mx-auto flex w-full max-w-[96rem] flex-col xl:h-full xl:min-h-0">
    <SchoolPageHeader title={t("workbenchTitle")} />
    <Suspense fallback={<div className="mt-6 h-[min(70svh,720px)] animate-pulse rounded-2xl border border-line bg-card" />}>
      <CoursewareWorkbenchContent locale={locale} params={params} searchParams={searchParams} />
    </Suspense>
  </div>;
}

async function CoursewareWorkbenchContent({
  locale,
  params,
  searchParams,
}: {
  locale: string;
  params: Promise<{ locale: string; lectureId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ lectureId }, query, user, t] = await Promise.all([
    params,
    searchParams,
    requireAnyPerm(locale, COURSEWARE_STUDIO_PERMS),
    getTranslations("coursewareStudio"),
  ]);
  const [context, perms] = await Promise.all([
    loadCoursewareWorkbenchContext(lectureId),
    getMyPerms(user.id),
  ]);
  if (!context) notFound();

  const track = parseCoursewareTrack(query.track);
  const requestedPageId = first(query.page);
  const requestedEdit = first(query.mode) === "edit";
  const canEdit = perms.has("courseware.page.edit");
  const canPublish = perms.has("courseware.release.publish");
  const mode = requestedEdit && canEdit ? "edit" : "preview";
  const editDenied = requestedEdit && !canEdit;
  const backToPlanHref = familyHref(context.family.id, context.course.id);
  const editHref = workbenchHref(lectureId, { mode: "edit", track, page: requestedPageId ?? context.firstPageDocId });

  const preview = mode === "preview"
    ? await loadLecturePreview(lectureId, track, requestedPageId)
    : null;
  let editor = null;
  if (mode === "edit" && context.firstPageDocId) {
    editor = await loadCoursewareStudioPage(lectureId, requestedPageId ?? context.firstPageDocId, track);
    if (!editor && requestedPageId !== context.firstPageDocId) {
      editor = await loadCoursewareStudioPage(lectureId, context.firstPageDocId, track);
    }
  }

  const currentPageId = preview?.page.pageDocId ?? editor?.page.id ?? context.firstPageDocId;
  const currentPreviewHref = workbenchHref(lectureId, { track, page: currentPageId });
  const currentEditHref = workbenchHref(lectureId, { mode: "edit", track, page: currentPageId });

  return <section className="mt-6 flex min-h-0 flex-1 flex-col">
    <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-line bg-card p-4 sm:p-5">
      <div>
        <nav className="flex flex-wrap items-center gap-1.5 text-xs text-muted" aria-label={t("workbenchBreadcrumb")}>
          <Link href={backToPlanHref} className="hover:text-ink">{context.family.title}</Link><span aria-hidden="true">/</span>
          <Link href={backToPlanHref} className="hover:text-ink">{context.course.title}</Link><span aria-hidden="true">/</span>
          <span className="text-ink">{t("lectureTitle", { no: context.lecture.no, name: context.lecture.name })}</span>
        </nav>
        <h1 className="mt-2 font-display text-2xl text-ink">{t("lectureTitle", { no: context.lecture.no, name: context.lecture.name })}</h1>
        <p className="mt-1 text-sm text-muted">{context.course.productCode ?? "—"} · {track === "adapted-4x3" ? t("trackAdapted") : t("trackNative")}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href={backToPlanHref} className={buttonVariants({ variant: "secondary", size: "sm" })}>{t("backToTeachingPlan")}</Link>
        <Link href={currentPreviewHref} aria-current={mode === "preview" ? "page" : undefined} className={buttonVariants({ variant: mode === "preview" ? "primary" : "secondary", size: "sm" })}>{t("previewMode")}</Link>
        {canEdit && <Link href={currentEditHref} aria-current={mode === "edit" ? "page" : undefined} className={buttonVariants({ variant: mode === "edit" ? "primary" : "secondary", size: "sm" })}>{t("enterEdit")}</Link>}
      </div>
    </div>

    {editDenied && <p className="mt-4 rounded-xl border border-line bg-moon/30 px-4 py-3 text-sm text-ink">{t("editDenied")}</p>}
    {!context.firstPageDocId && <p className="mt-4 rounded-2xl border border-dashed border-line bg-card p-6 text-sm text-muted">{t("workbenchNoPages")}</p>}
    {context.firstPageDocId && mode === "preview" && !preview && <div className="mt-4 rounded-2xl border border-dashed border-line bg-card p-6"><h2 className="font-medium text-ink">{t("workbenchNoRelease")}</h2><p className="mt-1 text-sm text-muted">{t("workbenchNoReleaseHint")}</p>{canEdit && <Link href={editHref} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "mt-4")}>{t("enterEdit")}</Link>}</div>}
    <CoursewareWorkbenchBody
      mode={mode}
      review={preview ? {
        doc: preview.page.doc,
        bindingUrls: preview.bindingUrls,
        stageMode: track === "adapted-4x3" ? "board43" : "natural",
        previousHref: preview.pageIndex > 1 ? workbenchHref(lectureId, { track, page: preview.pages[preview.pageIndex - 2]?.pageDocId }) : null,
        nextHref: preview.pageIndex < preview.pages.length ? workbenchHref(lectureId, { track, page: preview.pages[preview.pageIndex]?.pageDocId }) : null,
        previousLabel: t("prevPage"),
        nextLabel: t("nextPage"),
        shortcutHint: t("keyboardPagingHint"),
        pageNavigationLabel: t("pageNavigation"),
        pages: preview.pages.map((page) => ({
          pageNo: page.pageNo,
          title: page.title || t("untitledPage"),
          href: workbenchHref(lectureId, { track, page: page.pageDocId }),
          label: t("jumpToPage", { page: page.pageNo, title: page.title || t("untitledPage") }),
        })),
        currentPage: preview.page.pageNo,
      } : null}
      editor={editor ? {
        lecture: editor.lecture,
        track: editor.track,
        page: editor.page,
        pages: editor.pages,
        initialDoc: editor.activeRevision.doc,
        baseRevisionNo: editor.activeRevision.revisionNo,
        revisions: editor.revisions,
        releases: editor.releaseHistory,
        bindingUrls: editor.bindingUrls,
        imageAssetUsage: editor.imageAssetUsage,
        copyTargets: editor.copyTargets,
        canPublish,
        backToPlanHref,
        backToPlanLabel: t("backToTeachingPlan"),
      } : null}
    />
  </section>;
}
