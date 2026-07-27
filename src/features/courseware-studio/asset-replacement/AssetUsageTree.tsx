"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { SharedAssetUsage } from "../data";

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

export function selectableIds(usages: readonly SharedAssetUsage[]) {
  return usages.filter((usage) => usage.pinnedRevisionId === null).map((usage) => usage.bindingId);
}

/**
 * 使用树（doc 23 §13.3）：这份素材被哪些课程、哪些讲、哪些页引用，以及本次替换选中哪些。
 *
 * 从原来的单体编辑器里拆出来。拆分的判据不是行数，而是职责：这个组件只回答
 * "引用关系是什么、选了哪些"，不知道上传、不知道替换模式、不拥有页面布局。
 * 选择状态由 Controller 持有——它同时要喂给 ObjectBar 的"已选 N / M"和 Rail 的应用按钮。
 */
export function AssetUsageTree({
  usages,
  selected,
  onToggle,
  selectedCount,
  eligibleCount,
  trackLabel,
}: {
  usages: SharedAssetUsage[];
  selected: ReadonlySet<string>;
  onToggle: (ids: string[], checked: boolean) => void;
  selectedCount: number;
  eligibleCount: number;
  trackLabel: string;
}) {
  const t = useTranslations("coursewareStudio");
  const courses = useMemo(() => groupUsages(usages), [usages]);

  const checkedState = (ids: string[]) =>
    ids.length > 0 && ids.every((id) => selected.has(id)) ? true : ids.some((id) => selected.has(id)) ? "indeterminate" : false;

  return (
    <section className="rounded-2xl border border-line bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-ink">{t("assetUsageTree")}</h2>
          <p className="mt-1 text-sm text-muted">{t("assetUsageTreeHint", { track: trackLabel })}</p>
        </div>
        <Badge variant="secondary">{t("assetSelectableCount", { selected: selectedCount, total: eligibleCount })}</Badge>
      </div>
      <div className="mt-4 space-y-3">
        {courses.map((course) => {
          const courseUsages = course.lectures.flatMap((lecture) => lecture.usages);
          const courseIds = selectableIds(courseUsages);
          return (
            <div key={course.id} className="rounded-xl border border-line">
              <div className="flex items-center gap-2 border-b border-line bg-paper/50 px-3 py-2 text-sm font-medium text-ink">
                <Checkbox id={`asset-course-${course.id}`} checked={checkedState(courseIds)} disabled={courseIds.length === 0} onCheckedChange={(checked) => onToggle(courseIds, checked === true)} />
                <Label htmlFor={`asset-course-${course.id}`} className="cursor-pointer text-sm font-medium text-ink">
                  <span>{course.title}</span>
                </Label>
                <span className="ml-auto font-mono text-xs text-muted">{course.productCode || "—"}</span>
              </div>
              <div className="divide-y divide-line">
                {course.lectures.map((lecture) => {
                  const lectureIds = selectableIds(lecture.usages);
                  return (
                    <div key={lecture.id} className="px-3 py-2">
                      <div className="flex items-center gap-2 text-sm text-ink">
                        <Checkbox id={`asset-lecture-${lecture.id}`} checked={checkedState(lectureIds)} disabled={lectureIds.length === 0} onCheckedChange={(checked) => onToggle(lectureIds, checked === true)} />
                        <Label htmlFor={`asset-lecture-${lecture.id}`} className="cursor-pointer text-sm text-ink">{t("assetLectureLabel", { no: lecture.no, name: lecture.name })}</Label>
                      </div>
                      <ul className="mt-2 space-y-1 pl-7">
                        {lecture.usages.map((usage) => {
                          const independentlyPinned = usage.pinnedRevisionId !== null;
                          return (
                            <li key={usage.bindingId} className="flex items-center gap-2 text-xs text-muted">
                              <Checkbox id={`asset-binding-${usage.bindingId}`} checked={selected.has(usage.bindingId)} disabled={independentlyPinned} onCheckedChange={(checked) => onToggle([usage.bindingId], checked === true)} />
                              <Label htmlFor={`asset-binding-${usage.bindingId}`} className="cursor-pointer text-xs text-muted">{t("assetPageLabel", { no: usage.pageNo, title: usage.pageTitle || t("untitledPage") })}</Label>
                              {independentlyPinned ? <Badge variant="secondary">{t("assetPinned")}</Badge> : null}
                              {usage.frozenSessionCount > 0 ? <span className="ml-auto text-rose">{t("assetFrozenSessions", { count: usage.frozenSessionCount })}</span> : null}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
