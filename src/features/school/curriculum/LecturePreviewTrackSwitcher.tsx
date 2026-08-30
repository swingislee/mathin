"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import type { CoursewareTrack } from "@/features/courseware-studio/data";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

function previewHref(baseHref: string, lectureId: string, page: number, track: CoursewareTrack) {
  const query = new URLSearchParams();
  query.set("lecture", lectureId);
  if (page > 1) query.set("page", String(page));
  query.set("track", track);
  return `${baseHref}&${query.toString()}`;
}

/** Track links follow page changes written through the native History API. */
export function LecturePreviewTrackSwitcher({
  baseHref,
  lectureId,
  currentTrack,
  initialPage,
}: {
  baseHref: string;
  lectureId: string;
  currentTrack: CoursewareTrack;
  initialPage: number;
}) {
  const t = useTranslations("school.courses");
  const searchParams = useSearchParams();
  const requestedPage = Number(searchParams.get("page"));
  const currentPage = Number.isInteger(requestedPage) && requestedPage > 0
    ? requestedPage
    : initialPage;

  return (
    <div className="flex rounded-full border border-line bg-paper p-1" role="group" aria-label={t("coursewareTrack")}>
      <Link
        href={previewHref(baseHref, lectureId, currentPage, "native-16x9")}
        className={cn(buttonVariants({ size: "sm", variant: currentTrack === "native-16x9" ? "primary" : "ghost" }), "rounded-full")}
      >
        {t("trackNative")}
      </Link>
      <Link
        href={previewHref(baseHref, lectureId, currentPage, "adapted-4x3")}
        className={cn(buttonVariants({ size: "sm", variant: currentTrack === "adapted-4x3" ? "primary" : "ghost" }), "rounded-full")}
      >
        {t("trackAdapted")}
      </Link>
    </div>
  );
}
