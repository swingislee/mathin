"use client";

import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StagePreview } from "@/features/courseware-studio/StagePreview";
import type { CoursewareLecturePreview, CoursewareTrack } from "@/features/courseware-studio/data";
import { cn } from "@/lib/utils";

function hrefForPreview(baseHref: string, lectureId: string, page: number, track: CoursewareTrack) {
  const query = new URLSearchParams();
  query.set("lecture", lectureId);
  if (page > 1) query.set("page", String(page));
  query.set("track", track);
  return `${baseHref}&${query.toString()}`;
}

export function CourseLecturePreviewDialog({
  preview,
  baseHref,
  canEditCourseware,
}: {
  preview: CoursewareLecturePreview;
  baseHref: string;
  canEditCourseware: boolean;
}) {
  const t = useTranslations("school.courses");
  const router = useRouter();
  const currentTrack = preview.page.aspect === "4:3" ? "adapted-4x3" : "native-16x9";
  const previousHref = preview.pageIndex > 1 ? hrefForPreview(baseHref, preview.lecture.id, preview.pageIndex - 1, currentTrack) : null;
  const nextHref = preview.pageIndex < preview.pages.length ? hrefForPreview(baseHref, preview.lecture.id, preview.pageIndex + 1, currentTrack) : null;

  return <Dialog open onOpenChange={(open) => { if (!open) router.replace(baseHref); }}>
    <DialogContent className="flex h-[min(94vh,58rem)] max-w-6xl flex-col overflow-hidden p-0">
      <DialogHeader className="border-b border-line px-6 py-5 pr-14">
        <DialogTitle>{t("lecturePreviewTitle", { no: preview.lecture.no, name: preview.lecture.name })}</DialogTitle>
        <DialogDescription>{t("previewPageIndicator", { current: preview.pageIndex, total: preview.pages.length })}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-3">
        <div className="flex rounded-full border border-line bg-paper p-1" role="group" aria-label={t("coursewareTrack")}>
          <Button type="button" size="sm" variant={currentTrack === "native-16x9" ? "primary" : "ghost"} onClick={() => router.replace(hrefForPreview(baseHref, preview.lecture.id, preview.pageIndex, "native-16x9"))}>{t("trackNative")}</Button>
          <Button type="button" size="sm" variant={currentTrack === "adapted-4x3" ? "primary" : "ghost"} onClick={() => router.replace(hrefForPreview(baseHref, preview.lecture.id, preview.pageIndex, "adapted-4x3"))}>{t("trackAdapted")}</Button>
        </div>
        {canEditCourseware && <Link href={`/dashboard/courseware/lectures/${preview.lecture.id}?mode=edit`} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>{t("editLectureCourseware")}<ExternalLink className="size-4" /></Link>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-paper px-3 py-4 sm:px-6"><StagePreview doc={preview.page.doc} bindingUrls={preview.bindingUrls} stageMode={currentTrack === "adapted-4x3" ? "board43" : "natural"} interactive /></div>
      <div className="flex shrink-0 items-center justify-between border-t border-line bg-card px-6 py-4"><Button type="button" size="sm" variant="secondary" disabled={!previousHref} onClick={() => { if (previousHref) router.replace(previousHref); }}><ChevronLeft className="size-4" />{t("previousPage")}</Button><span className="text-sm text-muted">{preview.pageIndex} / {preview.pages.length}</span><Button type="button" size="sm" variant="secondary" disabled={!nextHref} onClick={() => { if (nextHref) router.replace(nextHref); }}>{t("nextPage")}<ChevronRight className="size-4" /></Button></div>
    </DialogContent>
  </Dialog>;
}
