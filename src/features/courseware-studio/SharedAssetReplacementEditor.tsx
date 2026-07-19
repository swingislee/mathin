"use client";
/* eslint-disable @next/next/no-img-element -- private signed URLs and local staged blobs are intentionally not routed through next/image. */

import { useEffect, useMemo, useState, useTransition } from "react";
import { Check, ImageUp, RotateCcw, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CoursewareSharedAssetDetail, SharedAssetUsage } from "./data";
import {
  applyCoursewareImageReplacementAction,
  rollbackCoursewareImageReplacementAction,
  stageCoursewareImageReplacementAction,
} from "./actions";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";

type Props = { detail: CoursewareSharedAssetDetail };
type StagedUpload = { uploadId: string; sha256: string; width: number; height: number; previewUrl: string; fileName: string };

type LectureGroup = { id: string; no: number; name: string; usages: SharedAssetUsage[] };
type CourseGroup = { id: string; title: string; productCode: string; lectures: LectureGroup[] };

function groupUsages(usages: SharedAssetUsage[]): CourseGroup[] {
  const courses = new Map<string, { id: string; title: string; productCode: string; lectures: Map<string, LectureGroup> }>();
  for (const usage of usages) {
    let course = courses.get(usage.courseId);
    if (!course) {
      course = { id: usage.courseId, title: usage.courseTitle, productCode: usage.productCode, lectures: new Map() };
      courses.set(usage.courseId, course);
    }
    let lecture = course.lectures.get(usage.lectureId);
    if (!lecture) {
      lecture = { id: usage.lectureId, no: usage.lectureNo, name: usage.lectureName, usages: [] };
      course.lectures.set(usage.lectureId, lecture);
    }
    lecture.usages.push(usage);
  }
  return [...courses.values()].map((course) => ({ ...course, lectures: [...course.lectures.values()] }));
}

function selectableIds(usages: SharedAssetUsage[]) {
  return usages.filter((usage) => usage.pinnedRevisionId === null).map((usage) => usage.bindingId);
}

/** 资源指针或使用树改变后，以 key 重置上传/勾选等仅属于旧资源状态的本地状态。 */
export function SharedAssetReplacementEditor({ detail }: Props) {
  const scope = `${detail.asset.id}:${detail.asset.publishedRevisionId}:${detail.usages.map((usage) => `${usage.bindingId}:${usage.pinnedRevisionId ?? ""}`).join(",")}`;
  return <SharedAssetReplacementEditorBody key={scope} detail={detail} />;
}

function SharedAssetReplacementEditorBody({ detail }: Props) {
  const t = useTranslations("coursewareStudio");
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(selectableIds(detail.usages)));
  const [file, setFile] = useState<File | null>(null);
  const [staged, setStaged] = useState<StagedUpload | null>(null);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [rollbackBatchId, setRollbackBatchId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const courses = useMemo(() => groupUsages(detail.usages), [detail.usages]);
  const eligible = useMemo(() => selectableIds(detail.usages), [detail.usages]);
  const selectedIds = useMemo(() => eligible.filter((id) => selected.has(id)), [eligible, selected]);
  const frozenSelectedCount = useMemo(
    () => detail.usages.filter((usage) => selected.has(usage.bindingId)).reduce((count, usage) => count + usage.frozenSessionCount, 0),
    [detail.usages, selected],
  );
  const predictedMode = selectedIds.length === eligible.length ? "publish_pointer" : "branch_rebind";

  useEffect(() => () => {
    if (staged) URL.revokeObjectURL(staged.previewUrl);
  }, [staged]);

  const toggle = (ids: string[], checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };
  const checkedState = (ids: string[]) => ids.every((id) => selected.has(id)) ? true : ids.some((id) => selected.has(id)) ? "indeterminate" : false;
  const stage = () => startTransition(async () => {
    if (!file) return;
    const result = await stageCoursewareImageReplacementAction({ file });
    if (!result.ok) {
      setMessage(t("assetStageFailed", { code: result.code }));
      return;
    }
    setStaged({ ...result.data, previewUrl: URL.createObjectURL(file), fileName: file.name });
    setMessage(t("assetStaged"));
  });
  const apply = () => startTransition(async () => {
    if (!staged || selectedIds.length === 0) return;
    const result = await applyCoursewareImageReplacementAction({
      sourceSharedAssetId: detail.asset.id,
      selectedBindingIds: selectedIds,
      uploadId: staged.uploadId,
      note,
    });
    if (!result.ok) {
      setMessage(t("assetReplaceFailed", { code: result.code }));
      return;
    }
    setMessage(t(result.data.mode === "publish_pointer" ? "assetPointerUpdated" : "assetBranchCreated", { count: result.data.affectedCount }));
    router.refresh();
  });
  const rollback = () => startTransition(async () => {
    if (!rollbackBatchId) return;
    const result = await rollbackCoursewareImageReplacementAction(rollbackBatchId);
    setRollbackBatchId(null);
    setMessage(result.ok ? t("assetRollbackSucceeded") : t("assetRollbackFailed", { code: result.code }));
    if (result.ok) router.refresh();
  });

  return (
    <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="space-y-4">
        <div className="rounded-2xl border border-line bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-ink">{t("assetUsageTree")}</h2>
              <p className="mt-1 text-sm text-muted">{t("assetUsageTreeHint")}</p>
            </div>
            <Badge variant="secondary">{t("assetSelectableCount", { selected: selectedIds.length, total: eligible.length })}</Badge>
          </div>
          <div className="mt-4 space-y-3">
            {courses.map((course) => {
              const courseUsages = course.lectures.flatMap((lecture) => lecture.usages);
              const courseIds = selectableIds(courseUsages);
              return <div key={course.id} className="rounded-xl border border-line">
                <div className="flex items-center gap-2 border-b border-line bg-paper/50 px-3 py-2 text-sm font-medium text-ink">
                  <Checkbox id={`asset-course-${course.id}`} checked={checkedState(courseIds)} disabled={courseIds.length === 0} onCheckedChange={(checked) => toggle(courseIds, checked === true)} />
                  <Label htmlFor={`asset-course-${course.id}`} className="cursor-pointer text-sm font-medium text-ink">
                    <span>{course.title}</span>
                  </Label>
                  <span className="ml-auto font-mono text-xs text-muted">{course.productCode || "—"}</span>
                </div>
                <div className="divide-y divide-line">
                  {course.lectures.map((lecture) => {
                    const lectureIds = selectableIds(lecture.usages);
                    return <div key={lecture.id} className="px-3 py-2">
                      <div className="flex items-center gap-2 text-sm text-ink">
                        <Checkbox id={`asset-lecture-${lecture.id}`} checked={checkedState(lectureIds)} disabled={lectureIds.length === 0} onCheckedChange={(checked) => toggle(lectureIds, checked === true)} />
                        <Label htmlFor={`asset-lecture-${lecture.id}`} className="cursor-pointer text-sm text-ink">{t("assetLectureLabel", { no: lecture.no, name: lecture.name })}</Label>
                      </div>
                      <ul className="mt-2 space-y-1 pl-7">
                        {lecture.usages.map((usage) => {
                          const independentlyPinned = usage.pinnedRevisionId !== null;
                          return <li key={usage.bindingId} className="flex items-center gap-2 text-xs text-muted">
                            <Checkbox id={`asset-binding-${usage.bindingId}`} checked={selected.has(usage.bindingId)} disabled={independentlyPinned} onCheckedChange={(checked) => toggle([usage.bindingId], checked === true)} />
                            <Label htmlFor={`asset-binding-${usage.bindingId}`} className="cursor-pointer text-xs text-muted">{t("assetPageLabel", { no: usage.pageNo, title: usage.pageTitle || t("untitledPage") })}</Label>
                            {independentlyPinned ? <Badge variant="secondary">{t("assetPinned")}</Badge> : null}
                            {usage.frozenSessionCount > 0 ? <span className="ml-auto text-rose">{t("assetFrozenSessions", { count: usage.frozenSessionCount })}</span> : null}
                          </li>;
                        })}
                      </ul>
                    </div>;
                  })}
                </div>
              </div>;
            })}
          </div>
        </div>

        {staged ? (
          <section className="rounded-2xl border border-moon bg-card p-4">
            <div className="flex items-center gap-2"><Check className="size-4 text-leaf-deep" /><h2 className="font-semibold text-ink">{t("assetConfirmTitle")}</h2></div>
            <p className="mt-1 text-sm text-muted">{t("assetConfirmHint")}</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <figure className="rounded-xl border border-line p-2"><img src={detail.asset.previewUrl ?? ""} alt={t("assetCurrentPreview")} className="aspect-video w-full rounded-lg bg-paper object-contain" /><figcaption className="mt-2 text-xs text-muted">{t("assetCurrentPreview")}</figcaption></figure>
              <figure className="rounded-xl border border-line p-2"><img src={staged.previewUrl} alt={t("assetNewPreview")} className="aspect-video w-full rounded-lg bg-paper object-contain" /><figcaption className="mt-2 text-xs text-muted">{staged.fileName} · {staged.width} × {staged.height}</figcaption></figure>
            </div>
            <div className="mt-4 rounded-xl bg-paper p-3 text-sm text-muted">
              <p>{t(predictedMode === "publish_pointer" ? "assetPointerPlan" : "assetBranchPlan", { count: selectedIds.length })}</p>
              <p className="mt-1">{t("assetImpactSummary", { selected: selectedIds.length, unselected: eligible.length - selectedIds.length, frozen: frozenSelectedCount })}</p>
              <p className="mt-1">{t("assetReleaseIsolation")}</p>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button disabled={pending || selectedIds.length === 0} onClick={apply}><ImageUp className="size-4" />{t("assetApplyReplacement")}</Button>
              <Button variant="secondary" disabled={pending} onClick={() => setStaged(null)}>{t("assetDiscardStaged")}</Button>
            </div>
          </section>
        ) : null}
      </section>

      <aside className="space-y-4">
        <section className="rounded-2xl border border-line bg-card p-4">
          <h2 className="font-semibold text-ink">{detail.asset.name || t("unnamedAsset")}</h2>
          <p className="mt-1 font-mono text-xs text-muted">{detail.asset.sha256}</p>
          <img src={detail.asset.previewUrl ?? ""} alt={detail.asset.name || t("unnamedAsset")} className="mt-3 aspect-video w-full rounded-xl border border-line bg-paper object-contain" />
          <p className="mt-3 text-xs text-muted">{detail.asset.mime} · {detail.asset.width} × {detail.asset.height} · r{detail.asset.publishedRevisionNo}</p>
        </section>
        <section className="rounded-2xl border border-line bg-card p-4">
          <h2 className="font-semibold text-ink">{t("assetUploadTitle")}</h2>
          <p className="mt-1 text-sm text-muted">{t("assetUploadHint")}</p>
          <div className="mt-3 space-y-2">
            <Label htmlFor="asset-replacement-file">{t("assetUploadFile")}</Label>
            <Input id="asset-replacement-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            <Label htmlFor="asset-replacement-note">{t("saveNote")}</Label>
            <Textarea id="asset-replacement-note" value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} placeholder={t("assetReplacementNotePlaceholder")} />
            <Button className="w-full" disabled={pending || !file || selectedIds.length === 0} onClick={stage}><Upload className="size-4" />{t("assetStageUpload")}</Button>
          </div>
          {message ? <p role="status" className="mt-3 text-sm text-muted">{message}</p> : null}
        </section>
        <section className="rounded-2xl border border-line bg-card p-4">
          <h2 className="font-semibold text-ink">{t("assetReplacementHistory")}</h2>
          {detail.batches.length === 0 ? <p className="mt-2 text-sm text-muted">{t("assetReplacementHistoryEmpty")}</p> : <div className="mt-3 space-y-2">
            {detail.batches.map((batch) => <div key={batch.id} className="rounded-xl border border-line p-3 text-xs text-muted">
              <p className="font-medium text-ink">{t(batch.mode === "publish_pointer" ? "assetHistoryPointer" : "assetHistoryBranch", { count: batch.selectedUsageCount })}</p>
              <p className="mt-1">{batch.note || "—"}</p>
              <p className="mt-1 font-mono">{batch.id.slice(0, 8)}…</p>
              {batch.status === "applied" ? <Button className="mt-2" variant="secondary" size="sm" disabled={pending} onClick={() => setRollbackBatchId(batch.id)}><RotateCcw className="size-3" />{t("assetRollback")}</Button> : <p className="mt-2 text-leaf-deep">{t("assetRolledBack")}</p>}
            </div>)}
          </div>}
        </section>
      </aside>

      <ConfirmDialog
        open={rollbackBatchId !== null}
        onOpenChange={(open) => { if (!open) setRollbackBatchId(null); }}
        title={t("assetRollbackConfirmTitle")}
        description={t("assetRollbackConfirmDescription")}
        confirmLabel={t("assetRollback")}
        cancelLabel={t("cancel")}
        onConfirm={rollback}
        pending={pending}
      />
    </div>
  );
}
