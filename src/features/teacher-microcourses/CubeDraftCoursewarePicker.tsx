"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CubeCoursewarePreview } from "@/features/tools/components";
import { createCubeDraftStore, type CubeSavedDraft, type CubeSavedDraftSummary } from "@/features/tools/spatial-lab/cube-structures-draft-store";
import { createCubeCoursewareTool, type CubeCoursewarePayload, type CubeCoursewareSource, type CubeCoursewareTool } from "@/features/tools/courseware/cube-structures-content";

export function CubeFrozenCoursewarePreview({ payload }: { payload: CubeCoursewarePayload }) {
  const t = useTranslations("teacherMicrocourses");
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button type="button" size="sm" variant="secondary">{t("cubePreviewFrozen")}</Button></DialogTrigger>
    <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
      <DialogHeader><DialogTitle>{payload.title}</DialogTitle><DialogDescription>{t("cubeClassroomOriginHint")}</DialogDescription></DialogHeader>
      {open && <div className="aspect-[4/3] max-h-[65vh] overflow-hidden rounded-xl border border-line"><CubeCoursewarePreview payload={payload} preview /></div>}
    </DialogContent>
  </Dialog>;
}

export function CubeDraftCoursewarePicker({ onReady }: { onReady: (tool: CubeCoursewareTool | null) => void }) {
  const locale = useLocale() === "en" ? "en" : "zh";
  const t = useTranslations("teacherMicrocourses");
  const store = useMemo(() => createCubeDraftStore({ locale }), [locale]);
  const [drafts, setDrafts] = useState<readonly CubeSavedDraftSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<CubeSavedDraft | null>(null);
  const [source, setSource] = useState<CubeCoursewareSource>("current");
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    store.overview().then((result) => { if (active) setDrafts(result.drafts); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [store, reload]);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    store.read(selectedId).then((result) => {
      if (active) { setDraft(result); setSource(result.snapshot.session.lesson ? "recording" : "current"); }
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [store, selectedId, reload]);

  const prepared = useMemo(() => {
    if (!draft || draft.id !== selectedId || error) return null;
    try { return { tool: createCubeCoursewareTool(draft, source), invalid: false }; }
    catch { return { tool: null, invalid: true }; }
  }, [draft, selectedId, source, error]);
  useEffect(() => { onReady(prepared?.tool ?? null); }, [prepared, onReady]);

  return <div className="space-y-3 border-t border-line pt-3">
    <p className="text-sm text-muted">{t("cubeFrozenHint")}</p>
    {error ? <div role="alert" className="space-y-2 text-sm text-rose">
      <p>{t("cubeDraftLoadFailed")}</p>
      <Button type="button" variant="secondary" size="sm" onClick={() => { onReady(null); setError(false); setDraft(null); setDrafts(null); setReload((value) => value + 1); }}>{t("cubeReload")}</Button>
    </div> : drafts === null ? <p role="status" className="text-sm text-muted">{t("cubeDraftLoading")}</p> : drafts.length === 0
      ? <p className="text-sm text-muted">{t("cubeDraftEmpty")}</p>
      : <label className="grid gap-1 text-sm text-ink">{t("cubeDraftChoose")}
        <select className="h-10 min-w-0 rounded-lg border border-line bg-paper px-3" value={selectedId}
          onChange={(event) => { onReady(null); setSelectedId(event.target.value); setDraft(null); setError(false); }}>
          <option value="">{t("cubeDraftChoose")}</option>
          {drafts.map((item) => <option key={item.id} value={item.id}>{item.name} · v{item.revision}</option>)}
        </select>
      </label>}
    {selectedId && !draft && !error && <p role="status" className="text-sm text-muted">{t("cubeDraftLoading")}</p>}
    {draft && !error && <>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" aria-pressed={source === "current"} onClick={() => setSource("current")}>{t("cubeUseCurrent")}</Button>
        <Button type="button" size="sm" variant="secondary" aria-pressed={source === "recording"} disabled={!draft.snapshot.session.lesson} onClick={() => setSource("recording")}>{t("cubeUseRecording")}</Button>
      </div>
      {prepared?.invalid ? <p role="alert" className="text-sm text-rose">{t("cubeContentTooLarge")}</p> : prepared?.tool && <>
        <div className="aspect-[4/3] max-h-[42vh] overflow-hidden rounded-xl border border-line">
          <CubeCoursewarePreview key={`${draft.id}:${draft.revision}:${source}`} payload={prepared.tool.payload} preview />
        </div>
        <p className="text-xs text-muted">{t("cubeClassroomOriginHint")}</p>
      </>}
    </>}
  </div>;
}
