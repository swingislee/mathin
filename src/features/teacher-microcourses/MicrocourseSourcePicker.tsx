"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Check, LoaderCircle, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CoursePicker } from "@/features/school/teaching-operations/CoursePicker";
import type { ClassBuildCourseDetail } from "@/features/school/teaching-operations/course-picker-types";
import {
  createTeacherCompositionPagesFromLectureAction,
  listTeacherMicrocourseSourceLecturesAction,
} from "./actions";
import type { TeacherMicrocourseSourceLecture } from "./data";

export function MicrocourseSourcePicker({
  microcourseId,
  afterPageDocId,
  disabled,
  onAdded,
}: {
  microcourseId: string;
  afterPageDocId: string | null;
  disabled?: boolean;
  onAdded: (lastPageId: string, pageCount: number) => void;
}) {
  const t = useTranslations("teacherMicrocourses");
  const [open, setOpen] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<ClassBuildCourseDetail | null>(null);
  const [sources, setSources] = useState<TeacherMicrocourseSourceLecture[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [insertFailed, setInsertFailed] = useState(false);
  const [loading, startLoad] = useTransition();
  const [adding, startAdd] = useTransition();
  const byId = useMemo(() => new Map(sources.map((source) => [source.lectureId, source])), [sources]);
  const selected = selectedId ? byId.get(selectedId) ?? null : null;

  useEffect(() => {
    if (!open || !selectedCourse) return;
    let active = true;
    startLoad(async () => {
      try {
        const rows = await listTeacherMicrocourseSourceLecturesAction({ courseId: selectedCourse.id, limit: 100 });
        if (!active) return;
        setSources(rows);
        setSelectedId((current) => rows.some((row) => row.lectureId === current) ? current : null);
        setLoadFailed(false);
      } catch {
        if (!active) return;
        setSources([]);
        setSelectedId(null);
        setLoadFailed(true);
      }
    });
    return () => { active = false; };
  }, [loadVersion, open, selectedCourse]);

  const chooseCourse = (course: ClassBuildCourseDetail) => {
    setSelectedCourse(course);
    setSources([]);
    setSelectedId(null);
    setLoadFailed(false);
    setInsertFailed(false);
  };

  const clearCourse = () => {
    setSelectedCourse(null);
    setSources([]);
    setSelectedId(null);
    setLoadFailed(false);
    setInsertFailed(false);
  };

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
      <DialogContent className="flex max-h-[90dvh] max-w-3xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t("sourcePickerTitle")}</DialogTitle>
          <DialogDescription>{t("sourcePickerDescription")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <p className="text-sm font-medium text-ink">{t("sourceCourseLabel")}</p>
          <CoursePicker
            purpose="production"
            selected={selectedCourse}
            onSelect={chooseCourse}
            onClear={clearCourse}
            fixedCourseKind="curriculum"
            showSelectedDetail={false}
            accessContext="microcourse-source"
            disabled={adding}
          />
        </div>

        <div className="min-h-0 flex-1 space-y-2">
          <p className="text-sm font-medium text-ink">{t("sourceLectureLabel")}</p>
          <ScrollArea className="h-[min(24rem,48dvh)] rounded-xl border border-line">
            <div className="space-y-1 p-2">
              {!selectedCourse && <p className="px-4 py-10 text-center text-sm text-muted">{t("selectCourseHint")}</p>}
              {selectedCourse && loading && <p className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted"><LoaderCircle className="size-4 animate-spin" />{t("loadingLectures")}</p>}
              {selectedCourse && !loading && !loadFailed && sources.map((source) => {
                const checked = selectedId === source.lectureId;
                return <Button
                  key={source.lectureId}
                  type="button"
                  variant="ghost"
                  aria-pressed={checked}
                  aria-label={t("selectSourceLecture", { title: source.lectureTitle })}
                  onClick={() => {
                    setSelectedId((current) => current === source.lectureId ? null : source.lectureId);
                    setInsertFailed(false);
                  }}
                  className={`h-auto w-full justify-start gap-3 rounded-lg border px-3 py-2 text-left ${checked ? "border-crater bg-moon/20 ring-2 ring-crater/20" : "border-transparent hover:border-line hover:bg-paper"}`}
                >
                  <span aria-hidden="true" className={`grid size-5 shrink-0 place-items-center rounded border ${checked ? "border-rose bg-rose text-white" : "border-crater bg-card"}`}>{checked && <Check className="size-3.5" />}</span>
                  <span className="w-8 shrink-0 font-mono text-xs text-muted">{source.lectureNo}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink">{source.lectureTitle}</span><span className="block text-xs font-normal text-muted">{t("sourceLecturePages", { count: source.pageCount })}</span></span>
                </Button>;
              })}
              {selectedCourse && !loading && !loadFailed && sources.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted">{t("sourceEmpty")}</p>}
              {selectedCourse && loadFailed && <div role="alert" className="grid place-items-center gap-2 px-4 py-10 text-center"><p className="text-sm text-rose">{t("sourceFailed")}</p><Button type="button" size="sm" variant="secondary" onClick={() => { setLoadFailed(false); setLoadVersion((value) => value + 1); }}><RefreshCw className="size-3.5" />{t("retrySourceSearch")}</Button></div>}
            </div>
          </ScrollArea>
        </div>

        <div aria-live="polite" className="min-h-5 text-sm text-muted">
          {selected ? t("selectedLecture", { title: selected.lectureTitle, count: selected.pageCount }) : selectedCourse ? t("selectLectureHint") : t("selectCourseHint")}
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
