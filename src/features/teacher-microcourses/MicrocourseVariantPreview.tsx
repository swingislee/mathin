"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StagePreview } from "@/features/courseware-studio/StagePreview";
import type { TeacherMicrocourseEditor } from "./data";

export function MicrocourseVariantPreview({ editor }: { editor: TeacherMicrocourseEditor }) {
  const t = useTranslations("teacherMicrocourses");
  const [selectedPageId, setSelectedPageId] = useState(editor.pages[0]?.pageDocId ?? null);
  const page = useMemo(
    () => editor.pages.find((item) => item.pageDocId === selectedPageId) ?? editor.pages[0] ?? null,
    [editor.pages, selectedPageId],
  );
  const modeLabel = () => t("mode_composition");

  return <div className="grid min-h-[40rem] overflow-hidden bg-moon/10 xl:grid-cols-[16rem_minmax(0,1fr)]" data-testid="microcourse-variant-preview">
    <section className="min-h-0 overflow-hidden p-3 xl:border-r xl:border-line/80">
      <h2 className="mb-3 text-sm font-medium">{t("previewPages", { count: editor.pages.length })}</h2>
      <div className="h-[36rem] p-3">
        <ScrollArea className="h-full">
          <ol className="space-y-2 pr-2">
            {editor.pages.map((item) => <li key={item.pageDocId}>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setSelectedPageId(item.pageDocId)}
                className={`h-auto w-full justify-start px-3 py-2 text-left ${item.pageDocId === page?.pageDocId ? "bg-crater/10 text-ink" : ""}`}
              >
                <span className="w-5 shrink-0 text-xs text-muted">{item.pageNo}</span>
                <span className="min-w-0"><span className="block truncate text-sm">{item.title}</span><span className="block text-xs font-normal text-muted">{modeLabel()}</span></span>
              </Button>
            </li>)}
          </ol>
        </ScrollArea>
      </div>
    </section>
    {page ? <section className="min-w-0 overflow-hidden">
      <header className="px-4 pt-3">
        <div className="flex flex-wrap items-center gap-3"><Badge variant="secondary">{modeLabel()}</Badge><h2 className="text-sm font-medium">{page.title}</h2></div>
      </header>
      <div className="p-4">
        <div className="mx-auto max-w-5xl overflow-hidden border border-line bg-white">
          <StagePreview doc={page.doc} bindingUrls={page.bindingUrls} stageMode="natural" className="w-full" interactive />
        </div>
      </div>
    </section> : <section className="grid place-items-center"><p className="text-sm text-muted">{t("emptyPages")}</p></section>}
  </div>;
}
