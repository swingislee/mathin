"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { toSelectValue } from "@/features/school/controls";
import {
  FilterBar,
  FilterBarMore,
  FilterBarReset,
  FilterBarSubmit,
  FilterSearchInput,
  FilterSelectTrigger,
} from "@/features/school/FilterBar";
import { usePathname } from "@/i18n/navigation";
import type {
  TeacherMicrocourseLibraryFilters,
  TeacherMicrocourseOffering,
} from "./teacher-microcourse-library";
import type { CourseSeason } from "./types";

const DEFAULT_CLASS_TYPE = "__default__";

interface FilterTopic {
  slug: string;
  label: string;
}

export function TeacherMicrocourseLibraryFilters({
  filters,
  grades,
  seasons,
  classTypes,
  topics,
  offerings,
}: {
  filters: TeacherMicrocourseLibraryFilters;
  grades: number[];
  seasons: Array<CourseSeason | null>;
  classTypes: string[];
  topics: FilterTopic[];
  offerings: TeacherMicrocourseOffering[];
}) {
  const t = useTranslations("school.courses");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo");
  const resetParams = new URLSearchParams();
  if (returnTo) resetParams.set("returnTo", returnTo);
  const resetHref = `${pathname}${resetParams.size ? `?${resetParams.toString()}` : ""}`;
  const advancedCount = [
    filters.structure,
    filters.readiness,
    filters.grade,
    filters.courseSeason,
    filters.classType,
    filters.topic,
    filters.offering,
  ].filter((value) => value !== undefined).length;
  const hasFilters = Boolean(filters.q) || advancedCount > 0;

  return <FilterBar aria-label={t("microcourseFilters")}>
    {returnTo && <Input type="hidden" name="returnTo" value={returnTo} />}
    <FilterSearchInput
      name="q"
      defaultValue={filters.q}
      placeholder={t("microcourseSearchPlaceholder")}
      aria-label={t("microcourseSearchLabel")}
    />

    <FilterBarMore label={t("moreFilters")} activeCount={advancedCount}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select name="mcStructure" defaultValue={toSelectValue(filters.structure ?? "")}>
          <FilterSelectTrigger className="w-full" aria-label={t("microcourseStructure")}><SelectValue /></FilterSelectTrigger>
          <SelectContent>
            <SelectItem value={toSelectValue("")}>{t("microcourseAllStructures")}</SelectItem>
            <SelectItem value="single">{t("microcourseSingle")}</SelectItem>
            <SelectItem value="short">{t("microcourseShort")}</SelectItem>
            <SelectItem value="series">{t("microcourseSeries")}</SelectItem>
          </SelectContent>
        </Select>
        <Select name="mcReadiness" defaultValue={toSelectValue(filters.readiness ?? "")}>
          <FilterSelectTrigger className="w-full" aria-label={t("microcourseReadiness")}><SelectValue /></FilterSelectTrigger>
          <SelectContent>
            <SelectItem value={toSelectValue("")}>{t("microcourseAllReadiness")}</SelectItem>
            <SelectItem value="ready">{t("microcourseReady")}</SelectItem>
            <SelectItem value="incomplete">{t("microcourseNeedsWork")}</SelectItem>
          </SelectContent>
        </Select>
        <Select name="mcGrade" defaultValue={toSelectValue(filters.grade?.toString() ?? "")}>
          <FilterSelectTrigger className="w-full" aria-label={t("microcourseSourceGrade")}><SelectValue /></FilterSelectTrigger>
          <SelectContent>
            <SelectItem value={toSelectValue("")}>{t("microcourseAllGrades")}</SelectItem>
            {grades.map((grade) => <SelectItem key={grade} value={String(grade)}>{t("grade", { grade })}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select name="mcSeason" defaultValue={toSelectValue(filters.courseSeason === undefined ? "" : String(filters.courseSeason))}>
          <FilterSelectTrigger className="w-full" aria-label={t("microcourseSourceSeason")}><SelectValue /></FilterSelectTrigger>
          <SelectContent>
            <SelectItem value={toSelectValue("")}>{t("microcourseAllSeasons")}</SelectItem>
            {seasons.map((season) => <SelectItem key={season ?? "unspecified"} value={String(season ?? "unspecified")}>
              {season === null ? t("courseSeasonUnspecified") : t(["summer", "autumn", "winter", "spring"][season - 1])}
            </SelectItem>)}
          </SelectContent>
        </Select>
        <Select name="mcClassType" defaultValue={toSelectValue(filters.classType ?? "")}>
          <FilterSelectTrigger className="w-full" aria-label={t("microcourseSourceClassType")}><SelectValue /></FilterSelectTrigger>
          <SelectContent>
            <SelectItem value={toSelectValue("")}>{t("microcourseAllClassTypes")}</SelectItem>
            {classTypes.map((classType) => <SelectItem key={classType || "default"} value={classType || DEFAULT_CLASS_TYPE}>
              {classType || t("defaultClassType")}
            </SelectItem>)}
          </SelectContent>
        </Select>
        <Select name="mcTopic" defaultValue={toSelectValue(filters.topic ?? "")}>
          <FilterSelectTrigger className="w-full" aria-label={t("microcourseTopic")}><SelectValue /></FilterSelectTrigger>
          <SelectContent>
            <SelectItem value={toSelectValue("")}>{t("microcourseAllTopics")}</SelectItem>
            {topics.map((topic) => <SelectItem key={topic.slug} value={topic.slug}>{topic.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select name="mcOffering" defaultValue={toSelectValue(filters.offering ?? "")}>
          <FilterSelectTrigger className="w-full" aria-label={t("microcourseSourceOffering")}><SelectValue /></FilterSelectTrigger>
          <SelectContent>
            <SelectItem value={toSelectValue("")}>{t("microcourseAllOfferings")}</SelectItem>
            {offerings.map((offering) => <SelectItem key={offering} value={offering}>{t(`microcourseOffering_${offering}`)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </FilterBarMore>

    <FilterBarSubmit>{t("filter")}</FilterBarSubmit>
    {hasFilters && <FilterBarReset href={resetHref} label={t("clearFilters")} />}
  </FilterBar>;
}
