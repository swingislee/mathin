"use client";

import { RotateCcw, Search } from "lucide-react";
import { FormEvent, useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import {
  FilterBarFrame,
  FilterBarMore,
  FilterSearchInput,
  FilterSelectTrigger,
} from "@/features/school/FilterBar";
import { usePathname, useRouter } from "@/i18n/navigation";
import type {
  TeacherMicrocourseLibraryFilters,
  TeacherMicrocourseOffering,
} from "./teacher-microcourse-library";
import type { CourseSeason } from "./types";

const ALL = "__all__";
const FILTER_KEYS = [
  "q",
  "mcStructure",
  "mcReadiness",
  "mcGrade",
  "mcSeason",
  "mcClassType",
  "mcTopic",
  "mcOffering",
] as const;

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
  const router = useRouter();
  const [queryText, setQueryText] = useState(filters.q ?? "");

  const replace = (updates: Record<string, string | null>) => {
    const query = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) query.set(key, value); else query.delete(key);
    }
    query.delete("variant");
    query.delete("lecture");
    query.delete("page");
    query.delete("track");
    router.replace(`${pathname}${query.size ? `?${query.toString()}` : ""}`);
  };

  const reset = () => {
    const query = new URLSearchParams(searchParams.toString());
    for (const key of FILTER_KEYS) query.delete(key);
    query.delete("variant");
    query.delete("lecture");
    query.delete("page");
    query.delete("track");
    setQueryText("");
    router.replace(`${pathname}${query.size ? `?${query.toString()}` : ""}`);
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    replace({ q: queryText.trim() || null });
  };

  const advancedCount = [
    filters.grade,
    filters.courseSeason,
    filters.classType,
    filters.topic,
    filters.offering,
  ].filter((value) => value !== undefined).length;
  const hasFilters = FILTER_KEYS.some((key) => searchParams.has(key));

  return <FilterBarFrame aria-label={t("microcourseFilters")} className="rounded-2xl border border-line bg-card p-3">
    <form role="search" className="contents" onSubmit={submitSearch}>
      <FilterSearchInput
        value={queryText}
        onChange={(event) => setQueryText(event.target.value)}
        placeholder={t("microcourseSearchPlaceholder")}
        aria-label={t("microcourseSearchLabel")}
      />
      <Button type="submit" variant="secondary" size="sm" className="h-9 border-moon bg-moon/40 px-3 hover:bg-moon/70">
        <Search className="size-3.5" />{t("filter")}
      </Button>
    </form>

    <Select
      value={filters.structure ?? ALL}
      onValueChange={(value) => replace({ mcStructure: value === ALL ? null : value })}
    >
      <FilterSelectTrigger aria-label={t("microcourseStructure")}><SelectValue /></FilterSelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{t("microcourseAllStructures")}</SelectItem>
        <SelectItem value="single">{t("microcourseSingle")}</SelectItem>
        <SelectItem value="short">{t("microcourseShort")}</SelectItem>
        <SelectItem value="series">{t("microcourseSeries")}</SelectItem>
      </SelectContent>
    </Select>

    <Select
      value={filters.readiness ?? ALL}
      onValueChange={(value) => replace({ mcReadiness: value === ALL ? null : value })}
    >
      <FilterSelectTrigger aria-label={t("microcourseReadiness")}><SelectValue /></FilterSelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{t("microcourseAllReadiness")}</SelectItem>
        <SelectItem value="ready">{t("microcourseReady")}</SelectItem>
        <SelectItem value="incomplete">{t("microcourseNeedsWork")}</SelectItem>
      </SelectContent>
    </Select>

    <FilterBarMore label={t("moreFilters")} activeCount={advancedCount}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select value={filters.grade?.toString() ?? ALL} onValueChange={(value) => replace({ mcGrade: value === ALL ? null : value })}>
          <FilterSelectTrigger className="w-full" aria-label={t("microcourseSourceGrade")}><SelectValue /></FilterSelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("microcourseAllGrades")}</SelectItem>
            {grades.map((grade) => <SelectItem key={grade} value={String(grade)}>{t("grade", { grade })}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select
          value={filters.courseSeason === undefined ? ALL : String(filters.courseSeason)}
          onValueChange={(value) => replace({ mcSeason: value === ALL ? null : value })}
        >
          <FilterSelectTrigger className="w-full" aria-label={t("microcourseSourceSeason")}><SelectValue /></FilterSelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("microcourseAllSeasons")}</SelectItem>
            {seasons.map((season) => <SelectItem key={season ?? "unspecified"} value={String(season ?? "unspecified")}>
              {season === null ? t("courseSeasonUnspecified") : t(["summer", "autumn", "winter", "spring"][season - 1])}
            </SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.classType ?? ALL} onValueChange={(value) => replace({ mcClassType: value === ALL ? null : value })}>
          <FilterSelectTrigger className="w-full" aria-label={t("microcourseSourceClassType")}><SelectValue /></FilterSelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("microcourseAllClassTypes")}</SelectItem>
            {classTypes.map((classType) => <SelectItem key={classType || "default"} value={classType || "__default__"}>
              {classType || t("defaultClassType")}
            </SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.topic ?? ALL} onValueChange={(value) => replace({ mcTopic: value === ALL ? null : value })}>
          <FilterSelectTrigger className="w-full" aria-label={t("microcourseTopic")}><SelectValue /></FilterSelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("microcourseAllTopics")}</SelectItem>
            {topics.map((topic) => <SelectItem key={topic.slug} value={topic.slug}>{topic.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.offering ?? ALL} onValueChange={(value) => replace({ mcOffering: value === ALL ? null : value })}>
          <FilterSelectTrigger className="w-full" aria-label={t("microcourseSourceOffering")}><SelectValue /></FilterSelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("microcourseAllOfferings")}</SelectItem>
            {offerings.map((offering) => <SelectItem key={offering} value={offering}>{t(`microcourseOffering_${offering}`)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </FilterBarMore>

    {hasFilters && <Button type="button" variant="ghost" size="sm" className="h-9 px-3" onClick={reset}>
      <RotateCcw className="size-3.5" />{t("clearFilters")}
    </Button>}
  </FilterBarFrame>;
}
