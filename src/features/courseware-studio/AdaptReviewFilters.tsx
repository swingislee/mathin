"use client";

import { Filter, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePathname, useRouter } from "@/i18n/navigation";
import type { AdaptReviewFilterOptions } from "./adapt-review-data";

const ALL = "__all__";

export function AdaptReviewFilters({
  options,
  courseId,
  lectureId,
}: {
  options: AdaptReviewFilterOptions;
  courseId: string | null;
  lectureId: string | null;
}) {
  const t = useTranslations("coursewareStudio");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const update = (nextCourseId: string | null, nextLectureId: string | null) => {
    const query = new URLSearchParams(searchParams.toString());
    if (nextCourseId) query.set("course", nextCourseId); else query.delete("course");
    if (nextLectureId) query.set("lecture", nextLectureId); else query.delete("lecture");
    query.delete("page");
    router.replace(`${pathname}?${query.toString()}`);
  };

  return <section className="mt-4 flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-card p-4">
    <div className="flex items-center gap-2 self-center text-sm font-medium text-ink">
      <Filter className="size-4" />{t("adaptFilterTitle")}
    </div>
    <div className="min-w-64 flex-1">
      <p className="mb-1 text-xs text-muted">{t("adaptCourseFilter")}</p>
      <Select value={courseId ?? ALL} onValueChange={(value) => update(value === ALL ? null : value, null)}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("adaptAllCourses")}</SelectItem>
          {options.courses.map((course) => <SelectItem key={course.id} value={course.id}>
            {course.title}{course.productCode ? ` · ${course.productCode}` : ""}
          </SelectItem>)}
        </SelectContent>
      </Select>
    </div>
    <div className="min-w-56 flex-1">
      <p className="mb-1 text-xs text-muted">{t("adaptLectureFilter")}</p>
      <Select value={lectureId ?? ALL} disabled={!courseId} onValueChange={(value) => update(courseId, value === ALL ? null : value)}>
        <SelectTrigger><SelectValue placeholder={courseId ? t("adaptAllLectures") : t("adaptChooseCourseFirst")} /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("adaptAllLectures")}</SelectItem>
          {options.lectures.map((lecture) => <SelectItem key={lecture.id} value={lecture.id}>
            {t("adaptLectureOption", { no: lecture.no, name: lecture.name })}
          </SelectItem>)}
        </SelectContent>
      </Select>
    </div>
    {(courseId || lectureId) && <Button type="button" variant="ghost" size="sm" onClick={() => update(null, null)}>
      <RotateCcw className="size-4" />{t("adaptClearFilters")}
    </Button>}
  </section>;
}
