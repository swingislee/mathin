"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, LoaderCircle, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { getClassBuildCourseDetailAction, searchClassBuildCoursesAction } from "../actions/classes";
import type { ClassBuildCourseCandidate, ClassBuildCourseDetail, ClassBuildPurpose } from "./course-picker-types";

const ALL = "__all__";

function isReady(course: Pick<ClassBuildCourseCandidate, "lectureCount" | "releasedLectureCount">) {
  return course.lectureCount > 0 && course.lectureCount === course.releasedLectureCount;
}

function CourseCandidateLabel({ candidate }: { candidate: ClassBuildCourseCandidate }) {
  const t = useTranslations("school.classBuild");
  return <div className="min-w-0 flex-1">
    <div className="flex min-w-0 items-center gap-2">
      <span className="truncate font-medium">{candidate.title}</span>
      {!isReady(candidate) && <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300">{t("incomplete")}</Badge>}
    </div>
    <p className="mt-0.5 truncate text-xs text-muted">
      {t("courseCandidateMeta", {
        grade: candidate.grade,
        season: t(`courseSeason_${candidate.courseSeason}`),
        classType: candidate.classType || t("defaultClassType"),
        code: candidate.productCode || "—",
      })}
    </p>
  </div>;
}

export function CoursePicker({
  purpose,
  selected,
  onSelect,
  onClear,
  disabled = false,
}: {
  purpose: ClassBuildPurpose;
  selected: ClassBuildCourseDetail | null;
  onSelect: (course: ClassBuildCourseDetail) => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  const t = useTranslations("school.classBuild");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [grade, setGrade] = useState<number | null>(null);
  const [courseSeason, setCourseSeason] = useState<number | null>(null);
  const [classType, setClassType] = useState("");
  const [results, setResults] = useState<ClassBuildCourseCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const hasCriteria = Boolean(query.trim() || grade !== null || courseSeason !== null || classType);
  const grouped = useMemo(() => {
    const groups = new Map<string, ClassBuildCourseCandidate[]>();
    for (const candidate of results) {
      const current = groups.get(candidate.familyTitle) ?? [];
      current.push(candidate);
      groups.set(candidate.familyTitle, current);
    }
    return Array.from(groups.entries());
  }, [results]);

  useEffect(() => {
    if (!open || !hasCriteria) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setSearching(true);
      setFailed(false);
      void searchClassBuildCoursesAction({ query, grade, courseSeason, classType, purpose })
        .then((next) => { if (active) setResults(next); })
        .catch(() => { if (active) { setResults([]); setFailed(true); } })
        .finally(() => { if (active) setSearching(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [classType, courseSeason, grade, hasCriteria, open, purpose, query]);

  const visibleResults = open && hasCriteria ? grouped : [];
  const showSearching = open && hasCriteria && searching;

  const choose = async (candidate: ClassBuildCourseCandidate) => {
    setSelectingId(candidate.id);
    setFailed(false);
    try {
      const detail = await getClassBuildCourseDetailAction(candidate.id, purpose);
      onSelect(detail);
      setOpen(false);
      setQuery("");
    } catch {
      setFailed(true);
    } finally {
      setSelectingId(null);
    }
  };

  return <div className="space-y-3">
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="secondary" disabled={disabled} aria-expanded={open} className="h-auto min-h-10 w-full justify-between px-3 py-2 text-left">
          {selected ? <span className="min-w-0"><span className="block truncate font-medium">{selected.familyTitle} · {selected.title}</span><span className="block truncate text-xs font-normal text-muted">{selected.productCode || "—"} · {selected.releasedLectureCount}/{selected.lectureCount}</span></span> : <span className="text-muted">{t("chooseCourse")}</span>}
          <ChevronsUpDown className="ml-2 size-4 shrink-0 text-muted" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(34rem,calc(100vw-2rem))] p-0">
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder={t("searchCourses")} aria-label={t("searchCourses")} />
          <div className="grid grid-cols-3 gap-2 border-b p-2">
            <Select value={grade?.toString() ?? ALL} onValueChange={(value) => setGrade(value === ALL ? null : Number(value))}>
              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder={t("allGrades")} /></SelectTrigger>
              <SelectContent><SelectItem value={ALL}>{t("allGrades")}</SelectItem>{Array.from({ length: 9 }, (_, index) => index + 1).map((item) => <SelectItem key={item} value={String(item)}>{t("grade", { grade: item })}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={courseSeason?.toString() ?? ALL} onValueChange={(value) => setCourseSeason(value === ALL ? null : Number(value))}>
              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder={t("allCourseSeasons")} /></SelectTrigger>
              <SelectContent><SelectItem value={ALL}>{t("allCourseSeasons")}</SelectItem>{[1, 2, 3, 4].map((item) => <SelectItem key={item} value={String(item)}>{t(`courseSeason_${item}`)}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={classType || ALL} onValueChange={(value) => setClassType(value === ALL ? "" : value)}>
              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder={t("allClassTypes")} /></SelectTrigger>
              <SelectContent><SelectItem value={ALL}>{t("allClassTypes")}</SelectItem>{["A", "B", "S"].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <CommandList className="max-h-80">
            {!hasCriteria && <div className="px-3 py-8 text-center text-sm text-muted"><Search className="mx-auto mb-2 size-4" />{t("coursePickerStart")}</div>}
            {showSearching && <div className="flex items-center justify-center gap-2 px-3 py-8 text-sm text-muted"><LoaderCircle className="size-4 animate-spin" />{t("searchingCourses")}</div>}
            {!showSearching && hasCriteria && visibleResults.map(([familyTitle, candidates]) => <CommandGroup key={familyTitle} heading={familyTitle}>
              {candidates.map((candidate) => <CommandItem key={candidate.id} value={`${candidate.familyTitle} ${candidate.title} ${candidate.productCode ?? ""}`} onSelect={() => void choose(candidate)} disabled={selectingId !== null} className="items-start py-2">
                <CourseCandidateLabel candidate={candidate} />
                {selectingId === candidate.id ? <LoaderCircle className="mt-1 size-4 animate-spin" /> : selected?.id === candidate.id ? <Check className="mt-1 size-4" /> : null}
              </CommandItem>)}
            </CommandGroup>)}
            {!showSearching && hasCriteria && !failed && <CommandEmpty>{t("coursePickerEmpty")}</CommandEmpty>}
            {!showSearching && failed && <p className="px-3 py-5 text-center text-sm text-rose">{t("coursePickerFailed")}</p>}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>

    {selected && <div className="flex flex-wrap items-center gap-2 text-sm">
      <CourseCandidateLabel candidate={selected} />
      <Button type="button" variant="ghost" size="sm" onClick={onClear} disabled={disabled} className={cn("shrink-0", disabled && "hidden")}><X className="size-4" />{t("clearCourse")}</Button>
    </div>}
  </div>;
}
