"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { CoursewarePreviewWorkspace } from "@/features/courseware-preview/CoursewarePreviewWorkspace";
import { StagePreview } from "@/features/courseware-studio/StagePreview";
import type { TeacherMicrocourseEditor } from "./data";

export function MicrocourseVariantPreview({ editor }: { editor: TeacherMicrocourseEditor }) {
  const t = useTranslations("teacherMicrocourses");
  const previewT = useTranslations("coursewareStudio");
  const [selectedPageId, setSelectedPageId] = useState(editor.pages[0]?.pageDocId ?? null);
  const selectedIndex = Math.max(0, editor.pages.findIndex((page) => page.pageDocId === selectedPageId));
  const page = editor.pages[selectedIndex] ?? null;
  const items = useMemo(() => editor.pages.map((item) => ({
    id: item.pageDocId,
    title: item.title,
    titleContent: (
      <span className="min-w-0">
        <span className="block truncate text-xs text-ink">{item.title}</span>
        <span className="block truncate text-[11px] text-muted">{t("mode_composition")}</span>
      </span>
    ),
  })), [editor.pages, t]);

  return (
    <div className="h-[calc(100dvh-9rem)] min-h-[32rem]" data-testid="microcourse-variant-preview">
      <CoursewarePreviewWorkspace
        className="min-h-0"
        layoutId="teacher-microcourse-variant-preview"
        railWidth="standard"
        items={items}
        selectedIndex={selectedIndex}
        onSelectedIndexChange={(index) => setSelectedPageId(editor.pages[index]?.pageDocId ?? null)}
        directoryLabel={t("previewPages", { count: editor.pages.length })}
        previewLabel={previewT("preview")}
        previousLabel={previewT("prevPage")}
        nextLabel={previewT("nextPage")}
        selectedPageLabel={page
          ? previewT("pageIndicator", { current: selectedIndex + 1, total: editor.pages.length })
          : t("emptyPages")}
        preview={page
          ? <StagePreview doc={page.doc} bindingUrls={page.bindingUrls} stageMode="natural" className="size-full" interactive />
          : <div className="grid size-full place-items-center px-6 text-center text-sm text-muted">{t("emptyPages")}</div>}
      />
    </div>
  );
}
