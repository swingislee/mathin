"use client";

import { RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { FilterBarFrame, FilterSelectTrigger } from "@/features/school/FilterBar";
import { usePathname, useRouter } from "@/i18n/navigation";
import type { AdaptReviewFilterOptions } from "./adapt-review-data";

const ALL = "__all__";

export function AdaptReviewFilters({
  embedded = false,
  options,
  courseId,
  lectureId,
}: {
  embedded?: boolean;
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

  return <FilterBarFrame className={embedded ? "contents" : undefined} aria-label={t("adaptFilterTitle")}>
    <div className="min-w-56 flex-1 sm:max-w-md">
      <Select value={courseId ?? ALL} onValueChange={(value) => update(value === ALL ? null : value, null)}>
        <FilterSelectTrigger className="w-full" aria-label={t("adaptCourseFilter")}><SelectValue /></FilterSelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("adaptAllCourses")}</SelectItem>
          {options.courses.map((course) => <SelectItem key={course.id} value={course.id}>
            {course.title}{course.productCode ? ` · ${course.productCode}` : ""}
          </SelectItem>)}
        </SelectContent>
      </Select>
    </div>
    <div className="min-w-48 flex-1 sm:max-w-sm">
      <Select value={lectureId ?? ALL} disabled={!courseId} onValueChange={(value) => update(courseId, value === ALL ? null : value)}>
        <FilterSelectTrigger className="w-full" aria-label={t("adaptLectureFilter")}><SelectValue placeholder={courseId ? t("adaptAllLectures") : t("adaptChooseCourseFirst")} /></FilterSelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("adaptAllLectures")}</SelectItem>
          {options.lectures.map((lecture) => <SelectItem key={lecture.id} value={lecture.id}>
            {t("adaptLectureOption", { no: lecture.no, name: lecture.name })}
          </SelectItem>)}
        </SelectContent>
      </Select>
    </div>
    {(courseId || lectureId) && <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => update(null, null)}>
      <RotateCcw className="size-4" />{t("adaptClearFilters")}
    </Button>}
  </FilterBarFrame>;
}
