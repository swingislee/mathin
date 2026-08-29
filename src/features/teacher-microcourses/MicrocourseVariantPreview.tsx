"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { isGamePageDoc } from "@/features/courseware-doc/game-page-schema";
import { isCoursewareCompositionPage } from "@/features/courseware-doc/composition-page-schema";
import { StagePreview } from "@/features/courseware-studio/StagePreview";
import type { TeacherMicrocourseEditor } from "./data";

export function MicrocourseVariantPreview({ editor }: { editor: TeacherMicrocourseEditor }) {
  const t = useTranslations("teacherMicrocourses");
  const [selectedPageId, setSelectedPageId] = useState(editor.pages[0]?.pageDocId ?? null);
  const page = useMemo(
    () => editor.pages.find((item) => item.pageDocId === selectedPageId) ?? editor.pages[0] ?? null,
    [editor.pages, selectedPageId],
  );
  const modeLabel = (value: (typeof editor.pages)[number]) => (
    isCoursewareCompositionPage(value.doc)
      ? t("mode_composition")
      : isGamePageDoc(value.doc) ? t("mode_game") : t(`mode_${value.doc.mode}`)
  );

  return <div className="grid min-h-[40rem] gap-4 xl:grid-cols-[16rem_minmax(0,1fr)]" data-testid="microcourse-variant-preview">
    <Card className="min-h-0 overflow-hidden">
      <CardHeader className="pb-3"><CardTitle className="text-base">{t("previewPages", { count: editor.pages.length })}</CardTitle></CardHeader>
      <CardContent className="h-[36rem] p-3 pt-0">
        <ScrollArea className="h-full">
          <ol className="space-y-2 pr-2">
            {editor.pages.map((item) => <li key={item.pageDocId}>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setSelectedPageId(item.pageDocId)}
                className={`h-auto w-full justify-start rounded-xl border px-3 py-2 text-left ${item.pageDocId === page?.pageDocId ? "border-crater bg-moon/30 text-ink" : "border-line"}`}
              >
                <span className="w-5 shrink-0 text-xs text-muted">{item.pageNo}</span>
                <span className="min-w-0"><span className="block truncate text-sm">{item.title}</span><span className="block text-xs font-normal text-muted">{modeLabel(item)}</span></span>
              </Button>
            </li>)}
          </ol>
        </ScrollArea>
      </CardContent>
    </Card>
    {page ? <Card className="min-w-0 overflow-hidden">
      <CardHeader className="border-b border-line pb-3">
        <div className="flex flex-wrap items-center gap-3"><Badge variant="secondary">{modeLabel(page)}</Badge><CardTitle className="text-base">{page.title}</CardTitle></div>
      </CardHeader>
      <CardContent className="p-4">
        <div className="mx-auto max-w-5xl overflow-hidden rounded-xl border border-line bg-white shadow-sm">
          <StagePreview doc={page.doc} bindingUrls={page.bindingUrls} stageMode="natural" className="w-full" interactive />
        </div>
      </CardContent>
    </Card> : <Card className="grid place-items-center"><p className="text-sm text-muted">{t("emptyPages")}</p></Card>}
  </div>;
}
