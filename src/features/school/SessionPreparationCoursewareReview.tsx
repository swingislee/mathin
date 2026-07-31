"use client";

import {
  BookOpen,
  Film,
  Gamepad2,
  Image as ImageIcon,
  PenLine,
  PencilLine,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import {
  CoursewarePreviewWorkspace,
  type CoursewarePreviewListItem,
} from "@/features/courseware-preview/CoursewarePreviewWorkspace";
import { StagePreview } from "@/features/courseware-studio/StagePreview";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { CoursewareTemplatePage } from "./courseware-overlay";
import type { PreparationReviewCoursewareDoc } from "./session-preparation-review-courseware";

type PrepStep = "study" | "design" | "rehearsal";

const PAGE_ICONS = {
  image: ImageIcon,
  video: Film,
  game: Gamepad2,
  board: PenLine,
  doc: BookOpen,
} as const;

function pageTargetId(page: CoursewareTemplatePage): string {
  return page.type === "doc" ? page.docId : page.id;
}

function editHref(sessionId: string, prepStep: PrepStep, page: CoursewareTemplatePage): string {
  return `/dashboard/sessions/${sessionId}?stage=pre&prepStep=${prepStep}&prepPage=${pageTargetId(page)}`;
}

export function SessionPreparationCoursewareReview({
  sessionId,
  pages,
  docs,
  overlayAssetUrls,
  prepStep,
}: {
  sessionId: string;
  pages: CoursewareTemplatePage[];
  docs: PreparationReviewCoursewareDoc[];
  overlayAssetUrls: Record<string, string>;
  prepStep: PrepStep;
}) {
  const t = useTranslations("school.session");
  const overlayT = useTranslations("school.overlay");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const safeSelectedIndex = Math.min(selectedIndex, Math.max(0, pages.length - 1));
  const selectedPage = pages[safeSelectedIndex] ?? null;
  const selectedDoc = selectedPage?.type === "doc"
    ? docs.find((item) => item.pageDocId === selectedPage.docId) ?? null
    : null;
  const selectedAssetUrl = selectedPage
    && (selectedPage.type === "image" || selectedPage.type === "video")
    ? overlayAssetUrls[selectedPage.path]
    : null;

  const items: CoursewarePreviewListItem[] = pages.map((page) => {
    const Icon = PAGE_ICONS[page.type];
    return {
      id: pageTargetId(page),
      title: page.title,
      leading: (
        <span className="grid size-7 shrink-0 place-items-center text-muted">
          <Icon size={15} aria-hidden />
        </span>
      ),
    };
  });

  const preview = !selectedPage ? (
    <p className="grid size-full place-items-center text-sm text-muted">{t("prepReviewCoursewareEmpty")}</p>
  ) : selectedPage.type === "doc" ? (
    selectedDoc ? (
      <StagePreview
        doc={selectedDoc.doc}
        bindingUrls={selectedDoc.bindingUrls}
        stageMode="board43"
        interactive={false}
        className="size-full"
      />
    ) : (
      <p className="grid size-full place-items-center text-sm text-muted">{overlayT("previewLoading")}</p>
    )
  ) : selectedPage.type === "image" ? (
    selectedAssetUrl ? (
      // eslint-disable-next-line @next/next/no-img-element -- short-lived private review URL
      <img src={selectedAssetUrl} alt={selectedPage.title} className="size-full object-contain" />
    ) : (
      <p className="grid size-full place-items-center text-sm text-muted">{overlayT("previewLoading")}</p>
    )
  ) : selectedPage.type === "video" ? (
    selectedAssetUrl ? (
      <video src={selectedAssetUrl} controls playsInline className="size-full object-contain" />
    ) : (
      <p className="grid size-full place-items-center text-sm text-muted">{overlayT("previewLoading")}</p>
    )
  ) : (
    <div className="grid size-full place-items-center bg-paper-lines p-8 text-center">
      <div>
        <p className="font-display text-xl text-ink">{selectedPage.title}</p>
        <p className="mt-2 text-sm text-muted">
          {selectedPage.type === "game" ? overlayT("previewGame") : overlayT("previewBoard")}
        </p>
      </div>
    </div>
  );

  return (
    <section
      className="flex h-[calc(100vh-6rem)] max-h-[42rem] min-h-[36rem] min-w-0 flex-col"
      data-preparation-review-courseware
    >
      <div className="mb-2 flex min-h-8 items-center justify-between gap-3">
        <p className="text-xs font-medium text-muted">{t("prepReviewCoursewareTitle")}</p>
        {selectedPage ? (
          <Link
            href={editHref(sessionId, prepStep, selectedPage)}
            className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "h-7 gap-1.5 px-2 text-xs")}
          >
            <PencilLine size={13} aria-hidden />
            {t("prepReviewEditCurrentPage")}
          </Link>
        ) : null}
      </div>
      <CoursewarePreviewWorkspace
        className="min-h-0 flex-1 xl:grid-cols-1 xl:grid-rows-[minmax(10rem,32%)_minmax(0,1fr)]"
        railWidth="standard"
        items={items}
        selectedIndex={safeSelectedIndex}
        onSelectedIndexChange={setSelectedIndex}
        directoryLabel={t("prepReviewCoursewareDirectory")}
        previewLabel={t("prepReviewCoursewarePreview")}
        previousLabel={t("coursewarePreviousPage")}
        nextLabel={t("coursewareNextPage")}
        keyboardHint={t("coursewareKeyboardHint")}
        selectedPageLabel={selectedPage
          ? `${safeSelectedIndex + 1} / ${pages.length} · ${selectedPage.title}`
          : t("prepReviewCoursewareEmpty")}
        preview={preview}
      />
    </section>
  );
}
