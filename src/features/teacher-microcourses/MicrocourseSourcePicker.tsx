"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Check, LoaderCircle, RefreshCw, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StagePreview } from "@/features/courseware-studio/StagePreview";
import {
  createTeacherCompositionPagesFromLectureAction,
  searchTeacherMicrocourseSourceLecturesAction,
} from "./actions";
import type { TeacherMicrocourseSourceLecture } from "./data";

export function MicrocourseSourcePicker({
  microcourseId,
  afterPageDocId,
  initialSources,
  disabled,
  onAdded,
}: {
  microcourseId: string;
  afterPageDocId: string | null;
  initialSources: TeacherMicrocourseSourceLecture[];
  disabled?: boolean;
  onAdded: (lastPageId: string, pageCount: number) => void;
}) {
  const t = useTranslations("teacherMicrocourses");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sources, setSources] = useState(initialSources);
  const [catalogEmpty, setCatalogEmpty] = useState(initialSources.length === 0);
  const [searchVersion, setSearchVersion] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef(selectedId);
  const [searchFailed, setSearchFailed] = useState(false);
  const [insertFailed, setInsertFailed] = useState(false);
  const [searching, startSearch] = useTransition();
  const [adding, startAdd] = useTransition();
  const byId = useMemo(() => new Map(sources.map((source) => [source.lectureId, source])), [sources]);
  const selected = selectedId ? byId.get(selectedId) ?? null : null;

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    const timer = window.setTimeout(() => {
      startSearch(async () => {
        try {
          const rows = await searchTeacherMicrocourseSourceLecturesAction({ query, limit: 60 });
          if (live) {
            setSources((current) => {
              const pinned = current.filter((item) => item.lectureId === selectedIdRef.current);
              const incoming = new Set(rows.map((item) => item.lectureId));
              return [...pinned.filter((item) => !incoming.has(item.lectureId)), ...rows];
            });
            if (query.trim() === "") setCatalogEmpty(rows.length === 0);
            else if (rows.length > 0) setCatalogEmpty(false);
            setSearchFailed(false);
          }
        } catch {
          if (live) {
            setSources([]);
            setSearchFailed(true);
          }
        }
      });
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [open, query, searchVersion]);

  const add = () => {
    if (!selected) return;
    setInsertFailed(false);
    startAdd(async () => {
      const result = await createTeacherCompositionPagesFromLectureAction({
        microcourseId,
        afterPageDocId,
        sourceReleaseId: selected.releaseId,
        sourceLectureId: selected.lectureId,
      });
      if (!result.ok) {
        setInsertFailed(true);
        return;
      }
      onAdded(result.data.lastPageId, result.data.pageCount);
      setSelectedId(null);
      setOpen(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="secondary" disabled={disabled}>{t("addFromCourse")}</Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[90dvh] max-w-5xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t("sourcePickerTitle")}</DialogTitle>
          <DialogDescription>{t("sourcePickerDescription")}</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("sourceSearch")} className="pl-9" />
        </div>
        <ScrollArea className="min-h-0 flex-1 rounded-xl border border-line">
          <div className="grid min-h-[24rem] gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
            {searching && <p className="col-span-full flex items-center justify-center gap-2 py-10 text-sm text-muted"><LoaderCircle className="size-4 animate-spin" />{t("searching")}</p>}
            {!searching && sources.map((source) => {
              const checked = selectedId === source.lectureId;
              return (
                <Button
                  key={source.lectureId}
                  type="button"
                  variant="ghost"
                  aria-pressed={checked}
                  aria-label={t("selectSourceLecture", { title: source.lectureTitle })}
                  onClick={() => {
                    setSelectedId((current) => current === source.lectureId ? null : source.lectureId);
                    setInsertFailed(false);
                  }}
                  className={`h-auto min-w-0 flex-col items-stretch justify-start gap-0 overflow-hidden whitespace-normal rounded-xl border p-0 text-left transition ${checked ? "border-crater bg-moon/15 ring-2 ring-crater/20" : "border-line hover:border-crater/50 hover:bg-paper"}`}
                >
                  <div className="pointer-events-none aspect-[4/3] overflow-hidden bg-paper">
                    <StagePreview doc={source.previewDoc} bindingUrls={source.previewBindingUrls} interactive={false} className="h-full w-full" />
                  </div>
                  <div className="flex items-start gap-2 border-t border-line p-3 font-normal">
                    <span aria-hidden="true" className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded border ${checked ? "border-rose bg-rose text-white" : "border-crater bg-card"}`}>{checked && <Check className="size-3" />}</span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{source.lectureTitle}</p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted">{source.familyTitle} · {source.courseTitle}</p>
                      <p className="mt-1 text-xs text-muted">{t("sourceLecturePages", { count: source.pageCount })}</p>
                    </div>
                  </div>
                </Button>
              );
            })}
            {!searching && !searchFailed && sources.length === 0 && catalogEmpty && <div className="col-span-full grid place-items-center gap-2 px-6 py-10 text-center"><p className="text-sm font-medium text-ink">{t("sourceCatalogEmpty")}</p><p className="max-w-xl text-xs leading-5 text-muted">{t("sourceCatalogEmptyHint")}</p><Button type="button" size="sm" variant="secondary" onClick={() => setSearchVersion((value) => value + 1)}><RefreshCw className="size-3.5" />{t("retrySourceSearch")}</Button></div>}
            {!searching && !searchFailed && sources.length === 0 && !catalogEmpty && <p className="col-span-full py-10 text-center text-sm text-muted">{t("sourceEmpty")}</p>}
            {searchFailed && <div role="alert" className="col-span-full grid place-items-center gap-2 px-6 py-10 text-center"><p className="text-sm text-rose">{t("sourceFailed")}</p><Button type="button" size="sm" variant="secondary" onClick={() => { setSearchFailed(false); setSearchVersion((value) => value + 1); }}><RefreshCw className="size-3.5" />{t("retrySourceSearch")}</Button></div>}
          </div>
        </ScrollArea>
        <div aria-live="polite" className="min-h-5 text-sm text-muted">
          {selected ? t("selectedLecture", { title: selected.lectureTitle, count: selected.pageCount }) : t("selectLectureHint")}
          {insertFailed && <span role="alert" className="ml-2 text-rose">{t("sourceInsertFailed")}</span>}
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" disabled={adding} onClick={() => setOpen(false)}>{t("cancel")}</Button>
          <Button type="button" disabled={adding || !selected} onClick={add}>{adding && <LoaderCircle className="size-4 animate-spin" />}{t("insertLecture", { count: selected?.pageCount ?? 0 })}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
