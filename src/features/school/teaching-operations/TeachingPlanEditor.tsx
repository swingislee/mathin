"use client";

import { ArrowDown, ArrowUp, Ellipsis, LoaderCircle, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { archiveLectureAction, getLectureLifecycleImpactAction, restoreLectureAction, saveTeachingPlanAction } from "./actions";
import type { CourseFamilyDetail } from "./course-family-detail";

type EditableLecture = CourseFamilyDetail["teachingPlan"][number];
type LifecycleIntent = { lecture: EditableLecture; mode: "archive" | "restore" };
type Impact = { pageCount: number; releaseCount: number; classroomCount: number; sessionCount: number; objectCount: number };

function newLecture(name: string, objectives: string, no: number): EditableLecture {
  return { id: crypto.randomUUID(), no, name: name.trim(), objectives: objectives.trim(), status: "draft", archivedAt: null, hasRelease: false, pageCount: 0 };
}

function productHref(familyId: string, courseId: string, lectureId?: string) {
  const query = new URLSearchParams({ variant: courseId });
  if (lectureId) query.set("lecture", lectureId);
  return `/dashboard/courses/${familyId}?${query.toString()}`;
}

export function TeachingPlanEditor({
  familyId,
  selectedVariant,
  lectures: initialLectures,
  canEditCourseware,
  onClose,
}: {
  familyId: string;
  selectedVariant: CourseFamilyDetail["selectedVariant"];
  lectures: EditableLecture[];
  canEditCourseware: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("school.courses");
  const router = useRouter();
  const [lectures, setLectures] = useState(initialLectures);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newObjectives, setNewObjectives] = useState("");
  const [lifecycle, setLifecycle] = useState<LifecycleIntent | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const saveRun = useAction(saveTeachingPlanAction, {
    successMessage: t("teachingPlanSaved"),
    errorMessage: { default: t("actionFailed"), STALE_WRITE: t("staleTeachingPlan") },
    onSuccess: () => { router.refresh(); onClose(); },
  });
  const lifecycleRun = useAction(async (intent: LifecycleIntent) => intent.mode === "archive" ? archiveLectureAction(intent.lecture.id) : restoreLectureAction(intent.lecture.id), {
    successMessage: t("lectureLifecycleSaved"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => { router.refresh(); setLifecycle(null); },
  });

  const pending = saveRun.pending || lifecycleRun.pending;
  const updateLecture = (id: string, patch: Partial<Pick<EditableLecture, "name" | "objectives">>) => {
    setLectures((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row));
  };
  const moveLecture = (index: number, direction: -1 | 1) => {
    setLectures((rows) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= rows.length) return rows;
      const next = [...rows];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next.map((row, no) => ({ ...row, no: no + 1 }));
    });
  };
  const addLecture = () => {
    if (!newName.trim()) return;
    setLectures((rows) => [...rows, newLecture(newName, newObjectives, rows.length + 1)]);
    setNewName("");
    setNewObjectives("");
    setAddOpen(false);
  };
  const openLifecycle = async (intent: LifecycleIntent) => {
    setLifecycle(intent);
    setImpact(null);
    setImpactLoading(true);
    const result = await getLectureLifecycleImpactAction(intent.lecture.id);
    if (result.ok) setImpact(result.data);
    setImpactLoading(false);
  };
  const save = () => saveRun.run({
    courseId: selectedVariant.id,
    baseUpdatedAt: selectedVariant.updatedAt,
    lectures: lectures.map((lecture) => ({ id: lecture.id, name: lecture.name, objectives: lecture.objectives })),
  });

  return <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
    <DialogContent className="flex h-[min(92vh,56rem)] max-w-6xl flex-col overflow-hidden p-0">
      <DialogHeader className="border-b border-line px-6 py-5 pr-14">
        <DialogTitle>{t("editingTeachingPlan")}</DialogTitle>
        <DialogDescription>{t("editingTeachingPlanHint")}</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted">{selectedVariant.title} · {selectedVariant.productCode ?? "—"}</p><Dialog open={addOpen} onOpenChange={setAddOpen}><DialogTrigger asChild><Button type="button" size="sm" variant="secondary"><Plus className="size-4" />{t("addLecture")}</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>{t("addLecture")}</DialogTitle><DialogDescription>{t("newLectureHint")}</DialogDescription></DialogHeader><div className="grid gap-3"><Label className="grid gap-1 text-sm">{t("lectureName")}<Input value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={100} /></Label><Label className="grid gap-1 text-sm">{t("objectives")}<Textarea value={newObjectives} onChange={(event) => setNewObjectives(event.target.value)} maxLength={2000} rows={4} /></Label></div><DialogFooter><Button type="button" variant="secondary" onClick={() => setAddOpen(false)}>{t("cancel")}</Button><Button type="button" disabled={!newName.trim()} onClick={addLecture}>{t("addLecture")}</Button></DialogFooter></DialogContent></Dialog></div>
        <div className="space-y-3">
          {lectures.map((lecture, index) => <article key={lecture.id} className="rounded-2xl border border-line bg-paper p-3">
            <div className="grid gap-3 md:grid-cols-[3rem_minmax(11rem,1fr)_minmax(16rem,1.4fr)_auto] md:items-start">
              <div className="pt-2 font-mono text-sm text-muted">{String(index + 1).padStart(2, "0")}</div>
              <Label className="grid gap-1 text-xs font-normal text-muted">{t("lectureName")}<Input value={lecture.name} maxLength={100} disabled={pending} onChange={(event) => updateLecture(lecture.id, { name: event.target.value })} /></Label>
              <Label className="grid gap-1 text-xs font-normal text-muted">{t("objectives")}<Textarea value={lecture.objectives} maxLength={2000} rows={2} disabled={pending} onChange={(event) => updateLecture(lecture.id, { objectives: event.target.value })} /></Label>
              <div className="flex flex-wrap items-center justify-end gap-2 pt-5"><Badge variant={lecture.status === "archived" ? "outline" : "secondary"}>{t(lecture.status)}</Badge><Button type="button" size="sm" variant="ghost" className="px-2" disabled={pending || index === 0} aria-label={t("moveUp")} onClick={() => moveLecture(index, -1)}><ArrowUp className="size-4" /></Button><Button type="button" size="sm" variant="ghost" className="px-2" disabled={pending || index === lectures.length - 1} aria-label={t("moveDown")} onClick={() => moveLecture(index, 1)}><ArrowDown className="size-4" /></Button><Popover><PopoverTrigger asChild><Button type="button" size="sm" variant="ghost" className="px-2" aria-label={t("moreActions")}><Ellipsis className="size-4" /></Button></PopoverTrigger><PopoverContent className="w-52 p-2"><div className="grid gap-1"><Link href={productHref(familyId, selectedVariant.id, lecture.id)} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "justify-start")}>{t("preview")}</Link>{canEditCourseware && <Link href={`/dashboard/courseware/lectures/${lecture.id}?mode=edit`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "justify-start")}>{t("editLectureCourseware")}</Link>}<Button type="button" size="sm" variant="ghost" className="justify-start" disabled={pending} onClick={() => void openLifecycle({ lecture, mode: lecture.status === "archived" ? "restore" : "archive" })}>{lecture.status === "archived" ? t("restoreLecture") : t("archiveLecture")}</Button></div></PopoverContent></Popover></div>
            </div>
          </article>)}
        </div>
      </div>
      <div className="sticky bottom-0 flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-line bg-card px-6 py-4"><Button type="button" variant="secondary" disabled={pending} onClick={onClose}>{t("cancel")}</Button><Button type="button" disabled={pending || lectures.some((lecture) => !lecture.name.trim())} onClick={save}>{saveRun.pending && <LoaderCircle className="size-4 animate-spin" />}{t("saveChanges")}</Button></div>
    </DialogContent>
    <ConfirmDialog open={Boolean(lifecycle)} onOpenChange={(open) => { if (!open) setLifecycle(null); }} title={lifecycle?.mode === "archive" ? t("archiveLecture") : t("restoreLecture")} description={impactLoading ? t("loadingImpact") : lifecycle?.mode === "archive" ? t("archiveLectureImpact", impact ?? { pageCount: 0, releaseCount: 0, classroomCount: 0, sessionCount: 0, objectCount: 0 }) : t("restoreLectureHint")} confirmLabel={lifecycle?.mode === "archive" ? t("stopNewScheduling") : t("restoreLecture")} cancelLabel={t("cancel")} pending={lifecycleRun.pending} onConfirm={() => { if (lifecycle) lifecycleRun.run(lifecycle); }} />
  </Dialog>;
}
