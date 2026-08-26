"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, LoaderCircle, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StagePreview } from "@/features/courseware-studio/StagePreview";
import { createTeacherCompositionPageAction, searchTeacherMicrocourseSourcePagesAction } from "./actions";
import type { TeacherMicrocourseSourcePage } from "./data";

export function MicrocourseSourcePicker({
  microcourseId,
  afterPageDocId,
  initialSources,
  disabled,
  onAdded,
}: {
  microcourseId: string;
  afterPageDocId: string | null;
  initialSources: TeacherMicrocourseSourcePage[];
  disabled?: boolean;
  onAdded: (lastPageId: string) => void;
}) {
  const t = useTranslations("teacherMicrocourses");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sources, setSources] = useState(initialSources);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedIdsRef = useRef(selectedIds);
  const [failed, setFailed] = useState(false);
  const [searching, startSearch] = useTransition();
  const [adding, startAdd] = useTransition();
  const byId = useMemo(() => new Map(sources.map((source) => [source.revisionId, source])), [sources]);

  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    const timer = window.setTimeout(() => {
      startSearch(async () => {
        try {
          const rows = await searchTeacherMicrocourseSourcePagesAction({ query, limit: 60 });
          if (live) {
            setSources((current) => {
              const pinned = current.filter((item) => selectedIdsRef.current.includes(item.revisionId));
              const incoming = new Set(rows.map((item) => item.revisionId));
              return [...pinned.filter((item) => !incoming.has(item.revisionId)), ...rows];
            });
            setFailed(false);
          }
        } catch {
          if (live) { setSources([]); setFailed(true); }
        }
      });
    }, 250);
    return () => { live = false; window.clearTimeout(timer); };
  }, [open, query]);

  const toggle = (id: string) => setSelectedIds((current) => current.includes(id)
    ? current.filter((item) => item !== id)
    : [...current, id]);
  const move = (id: string, direction: -1 | 1) => setSelectedIds((current) => {
    const index = current.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= current.length) return current;
    const next = [...current];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });

  const add = () => startAdd(async () => {
    let after = afterPageDocId;
    for (const revisionId of selectedIds) {
      const source = byId.get(revisionId);
      if (!source) continue;
      const result = await createTeacherCompositionPageAction({
        microcourseId,
        afterPageDocId: after,
        title: source.pageTitle,
        source: {
          kind: "published-page",
          releaseId: source.releaseId,
          pageDocId: source.pageDocId,
          revisionId: source.revisionId,
        },
      });
      if (!result.ok) {
        setFailed(true);
        return;
      }
      after = result.data.pageId;
    }
    if (after) onAdded(after);
    setSelectedIds([]);
    setOpen(false);
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button type="button" size="sm" variant="secondary" disabled={disabled}>{t("addFromCourse")}</Button></DialogTrigger>
      <DialogContent className="flex max-h-[90dvh] max-w-6xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t("sourcePickerTitle")}</DialogTitle>
          <DialogDescription>{t("sourcePickerDescription")}</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("sourceSearch")} className="pl-9" />
        </div>
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <ScrollArea className="h-[58dvh] rounded-xl border border-line">
            <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3">
              {searching && <p className="col-span-full flex items-center justify-center gap-2 py-10 text-sm text-muted"><LoaderCircle className="size-4 animate-spin" />{t("searching")}</p>}
              {!searching && sources.map((source) => {
                const checked = selectedIds.includes(source.revisionId);
                return <div key={source.revisionId} className={`overflow-hidden rounded-xl border text-left transition ${checked ? "border-crater ring-2 ring-crater/20" : "border-line hover:border-crater/50"}`}>
                  <div className="pointer-events-none aspect-[4/3] overflow-hidden bg-paper"><StagePreview doc={source.doc} bindingUrls={source.bindingUrls} interactive={false} className="h-full w-full" /></div>
                  <Label className="flex cursor-pointer items-start gap-2 border-t border-line p-3 font-normal">
                    <Checkbox checked={checked} onCheckedChange={() => toggle(source.revisionId)} aria-label={t("selectSourcePage", { title: source.pageTitle })} />
                    <div className="min-w-0"><p className="truncate text-sm font-medium text-ink">{source.pageTitle}</p><p className="mt-0.5 line-clamp-2 text-xs text-muted">{source.familyTitle} · {source.courseTitle} · {source.lectureTitle} · P{source.pageNo}</p></div>
                  </Label>
                </div>;
              })}
              {!searching && !failed && sources.length === 0 && <p className="col-span-full py-10 text-center text-sm text-muted">{t("sourceEmpty")}</p>}
              {failed && <p role="alert" className="col-span-full py-10 text-center text-sm text-rose">{t("sourceFailed")}</p>}
            </div>
          </ScrollArea>
          <aside className="min-h-0 rounded-xl border border-line bg-paper/60 p-3">
            <h3 className="text-sm font-medium text-ink">{t("selectedOrder", { count: selectedIds.length })}</h3>
            <ol className="mt-3 space-y-2">
              {selectedIds.map((id, index) => {
                const source = byId.get(id);
                return <li key={id} className="flex items-center gap-2 rounded-lg border border-line bg-card p-2 text-xs">
                  <span className="w-5 shrink-0 text-center text-muted">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{source?.pageTitle ?? id}</span>
                  <Button type="button" variant="ghost" size="sm" className="px-2" disabled={index === 0} onClick={() => move(id, -1)} aria-label={t("moveUp")}><ArrowUp className="size-3.5" /></Button>
                  <Button type="button" variant="ghost" size="sm" className="px-2" disabled={index === selectedIds.length - 1} onClick={() => move(id, 1)} aria-label={t("moveDown")}><ArrowDown className="size-3.5" /></Button>
                </li>;
              })}
            </ol>
          </aside>
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>{t("cancel")}</Button>
          <Button type="button" disabled={adding || selectedIds.length === 0} onClick={add}>{adding && <LoaderCircle className="size-4 animate-spin" />}{t("insertSelected", { count: selectedIds.length })}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
