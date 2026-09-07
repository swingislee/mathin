"use client";

import { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useRouter } from "@/i18n/navigation";
import type { CompositionPagePersistence } from "@/features/teacher-microcourses/CoursewareCompositionWorkbench";
import type { CoursewareCompositionPage } from "@/features/courseware-doc/composition-page-schema";
import type { CoursewareTrack } from "./data";
import { saveFormalCubePageAction } from "./formal-cube-page-actions";
import { createBlankCoursewarePageAction, saveFormalManualPageAction } from "./formal-manual-page-actions";
import { createCoursewarePageH5Action, uploadCoursewarePageImageAction } from "./actions";

const CoursewareCompositionWorkbench = dynamic(() => import("@/features/teacher-microcourses/CoursewareCompositionWorkbench").then((module) => module.CoursewareCompositionWorkbench), { loading: () => <Skeleton className="size-full" /> });

export interface FormalCubePageEditorData {
  pageDocId: string; title: string; revisionNo: number; track: CoursewareTrack; doc: CoursewareCompositionPage;
  manual?: boolean; bindingUrls?: Record<string, string>;
}

export function FormalCubePageEditor({ page }: { page: FormalCubePageEditorData }) {
  const t = useTranslations("coursewareWorkspace");
  const persistence = useMemo<CompositionPagePersistence>(() => ({ save: async (input) => {
    const save = page.manual ? saveFormalManualPageAction : saveFormalCubePageAction;
    const result = await save({ pageDocId: input.pageDocId, track: page.track,
      doc: input.doc, baseRevisionNo: input.baseRevisionNo, note: input.note });
    return result.ok ? { ok: true, data: { doc: input.doc, revisionNo: result.data.revisionNo } } : result;
  }, ...(page.manual ? {
    uploadImage: (file: File) => uploadCoursewarePageImageAction({ pageDocId: page.pageDocId, track: page.track, file }),
    createH5: (html: string) => createCoursewarePageH5Action({ pageDocId: page.pageDocId, track: page.track, html }),
  } : {}) }), [page.track, page.pageDocId, page.manual]);
  const onPersisted = useCallback(() => {}, []);
  const [status, setStatus] = useState("");
  return <div className="flex size-full min-h-0 flex-col" data-formal-cube-page-editor>
    <p role="status" className="px-3 pt-2 text-xs leading-5 text-muted">{status || t("formalPageTrackHint")}</p>
    <div className="min-h-0 flex-1">
      <CoursewareCompositionWorkbench persistence={persistence} page={{ ...page, bindingUrls: page.bindingUrls ?? {} }} onPersisted={onPersisted} onStatus={setStatus} />
    </div>
  </div>;
}

export function CreateBlankCoursewarePageButton({ lectureId, returnTo }: { lectureId: string; returnTo: string | null }) {
  const t = useTranslations("coursewareWorkspace");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const create = async () => {
    if (pending) return;
    setPending(true);
    setMessage("");
    try {
      const result = await createBlankCoursewarePageAction({ lectureId, afterPageDocId: null, title: t("blankPageTitle") });
      if (!result.ok) { setMessage(t("verticalSliceSaveFailed", { code: result.code })); return; }
      const query = new URLSearchParams({ workspace: "courseware", canvas: "adapted-4x3", track: "adapted-4x3", compositionPage: result.data.pageDocId });
      if (returnTo) query.set("returnTo", returnTo);
      router.push(`/dashboard/courseware/lectures/${lectureId}?${query.toString()}`);
      router.refresh();
    } catch { setMessage(t("verticalSliceSaveFailed", { code: "NETWORK" })); }
    finally { setPending(false); }
  };
  return <div className="flex min-w-0 flex-col gap-1">
    <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => void create()}>
      <Plus className="size-4" />{t(pending ? "creatingBlankPage" : "createBlankPage")}
    </Button>
    {message && <p role="alert" className="text-xs text-rose">{message}</p>}
  </div>;
}
