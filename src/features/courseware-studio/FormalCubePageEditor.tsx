"use client";

import { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useRouter } from "@/i18n/navigation";
import { newId } from "@/lib/uuid";
import type { CompositionPagePersistence } from "@/features/teacher-microcourses/CoursewareCompositionWorkbench";
import type { CubeCoursewareTool } from "@/features/tools/courseware/cube-structures-content";
import type { CoursewareCompositionPage } from "@/features/courseware-doc/composition-page-schema";
import type { CoursewareTrack } from "./data";
import { createFormalCubePageAction, saveFormalCubePageAction } from "./formal-cube-page-actions";

const CubeDraftCoursewarePicker = dynamic(() => import("@/features/teacher-microcourses/CubeDraftCoursewarePicker").then((module) => module.CubeDraftCoursewarePicker), { loading: () => <Skeleton className="h-40 w-full" /> });
const CoursewareCompositionWorkbench = dynamic(() => import("@/features/teacher-microcourses/CoursewareCompositionWorkbench").then((module) => module.CoursewareCompositionWorkbench), { loading: () => <Skeleton className="size-full" /> });

export interface FormalCubePageEditorData {
  pageDocId: string; title: string; revisionNo: number; track: CoursewareTrack; doc: CoursewareCompositionPage;
}

export function FormalCubePageEditor({ page }: { page: FormalCubePageEditorData }) {
  const t = useTranslations("coursewareWorkspace");
  const persistence = useMemo<CompositionPagePersistence>(() => ({ save: async (input) => {
    const result = await saveFormalCubePageAction({ pageDocId: input.pageDocId, track: page.track,
      doc: input.doc, baseRevisionNo: input.baseRevisionNo, note: input.note });
    return result.ok ? { ok: true, data: { doc: input.doc, revisionNo: result.data.revisionNo } } : result;
  } }), [page.track]);
  const onPersisted = useCallback(() => {}, []);
  const [status, setStatus] = useState("");
  return <div className="flex size-full min-h-0 flex-col" data-formal-cube-page-editor>
    <p role="status" className="px-3 pt-2 text-xs leading-5 text-muted">{status || t("formalCubeTrackHint")}</p>
    <div className="min-h-0 flex-1">
      <CoursewareCompositionWorkbench persistence={persistence} page={{ ...page, bindingUrls: {} }} onPersisted={onPersisted} onStatus={setStatus} />
    </div>
  </div>;
}

export function CreateFormalCubePageButton({ lectureId, returnTo }: { lectureId: string; returnTo: string | null }) {
  const t = useTranslations("coursewareWorkspace");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pageDocId, setPageDocId] = useState("");
  const [title, setTitle] = useState("");
  const [tool, setTool] = useState<CubeCoursewareTool | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const create = async () => {
    if (!tool || tool.contentVersion !== "cube-structures-lesson-v2" || !title.trim() || pending) return;
    setPending(true);
    setMessage("");
    try {
      const result = await createFormalCubePageAction({ lectureId, pageDocId, title, tool });
      if (!result.ok) { setMessage(t("verticalSliceSaveFailed", { code: result.code })); return; }
      const query = new URLSearchParams({ workspace: "courseware", canvas: "adapted-4x3", track: "adapted-4x3", cubePage: result.data.pageDocId });
      if (returnTo) query.set("returnTo", returnTo);
      setOpen(false);
      router.push(`/dashboard/courseware/lectures/${lectureId}?${query.toString()}`);
      router.refresh();
    } catch { setMessage(t("verticalSliceSaveFailed", { code: "NETWORK" })); }
    finally { setPending(false); }
  };
  return <Dialog open={open} onOpenChange={(next) => {
    if (pending) return;
    if (next) { setPageDocId(newId()); setTitle(t("formalCubeDefaultTitle")); setTool(null); setMessage(""); }
    setOpen(next);
  }}>
    <DialogTrigger asChild><Button type="button" size="sm" variant="secondary"><Plus className="size-4" />{t("formalCubeCreate")}</Button></DialogTrigger>
    <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
      <DialogHeader><DialogTitle>{t("formalCubeCreate")}</DialogTitle><DialogDescription>{t("formalCubeCreateHint")}</DialogDescription></DialogHeader>
      <Label className="space-y-2">{t("formalCubeTitle")}<Input value={title} maxLength={100} disabled={pending} onChange={(event) => setTitle(event.target.value)} /></Label>
      {open && <fieldset disabled={pending} className="min-w-0"><CubeDraftCoursewarePicker onReady={setTool} /></fieldset>}
      {message && <p role="alert" className="text-sm text-rose">{message}</p>}
      <DialogFooter><Button type="button" variant="secondary" disabled={pending} onClick={() => setOpen(false)}>{t("formalCubeCancel")}</Button>
        <Button type="button" disabled={pending || !tool || !title.trim()} onClick={() => void create()}>{t(pending ? "formalCubeCreating" : "formalCubeCreate")}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
