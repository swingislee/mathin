"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, LoaderCircle, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  getClassBuildCourseDetailAction,
  getTeacherMicrocourseSourceCourseDetailAction,
  listClassBuildMicrocourseTopicsAction,
  searchClassBuildCoursesAction,
  searchTeacherMicrocourseSourceCoursesAction,
} from "../actions/classes";
import { compareCourseDifficulty } from "./course-difficulty";
import type { ClassBuildCourseCandidate, ClassBuildCourseDetail, ClassBuildMicrocourseTopic, ClassBuildPurpose } from "./course-picker-types";

const ALL = "__all__";
const CLASS_TYPES = ["X+", "G+", "A+", "A", "B", "S"];

function isReady(course: Pick<ClassBuildCourseCandidate, "lectureCount" | "releasedLectureCount">) {
  return course.lectureCount > 0 && course.lectureCount === course.releasedLectureCount;
}

function CourseCandidateLabel({ candidate }: { candidate: ClassBuildCourseCandidate }) {
  const t = useTranslations("school.classBuild");
  const locale = useLocale();
  const topic = locale === "en" ? candidate.primaryTopicTitleEn : candidate.primaryTopicTitleZh;
  return <div className="min-w-0 flex-1">
    <div className="flex min-w-0 items-center gap-2">
      <span className="truncate font-medium">{candidate.title}</span>
      {/* `default` 版本表示该课程族尚未发生教材年度换代，此时版本徽标没有区分作用。 */}
      {candidate.catalogVersionSlug !== "default" && <Badge variant="outline">{candidate.catalogVersionTitle}</Badge>}
      {candidate.isSuperseded && <Badge variant="outline" className="border-line text-muted">{t("supersededCourse")}</Badge>}
      {candidate.courseKind === "microcourse" && <Badge variant="secondary">{t("teacherMicrocourse")}</Badge>}
      {!isReady(candidate) && <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300">{t("incomplete")}</Badge>}
    </div>
    <p className="mt-0.5 truncate text-xs text-muted">
      {candidate.courseKind === "microcourse"
        ? t("microcourseCandidateMeta", {
            grade: candidate.grade,
            season: candidate.courseSeason ? t(`courseSeason_${candidate.courseSeason}`) : t("seasonOptional"),
            author: candidate.authorName ?? "—",
            topic: topic ?? "—",
          })
        : t("courseCandidateMeta", {
            grade: candidate.grade,
            season: candidate.courseSeason ? t(`courseSeason_${candidate.courseSeason}`) : t("seasonOptional"),
            classType: candidate.classType || t("defaultClassType"),
            code: candidate.productCode || "—",
          })}
    </p>
    {candidate.courseKind === "microcourse" && candidate.keywords.length > 0 && <p className="mt-0.5 truncate text-xs text-muted">{candidate.keywords.join(" · ")}</p>}
  </div>;
}

export function CoursePicker({
  purpose,
  selected,
  onSelect,
  onClear,
  disabled = false,
  fixedCourseKind,
  showSelectedDetail = true,
  accessContext = "class-build",
}: {
  purpose: ClassBuildPurpose;
  selected: ClassBuildCourseDetail | null;
  onSelect: (course: ClassBuildCourseDetail) => void;
  onClear: () => void;
  disabled?: boolean;
  fixedCourseKind?: "curriculum" | "microcourse";
  showSelectedDetail?: boolean;
  accessContext?: "class-build" | "microcourse-source";
}) {
  const t = useTranslations("school.classBuild");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [grade, setGrade] = useState<number | null>(null);
  const [courseSeason, setCourseSeason] = useState<number | null>(null);
  const [classType, setClassType] = useState("");
  const [courseKind, setCourseKind] = useState<"curriculum" | "microcourse" | null>(null);
  const [primaryTopicSlug, setPrimaryTopicSlug] = useState("");
  const [keyword, setKeyword] = useState("");
  const [microcourseTopics, setMicrocourseTopics] = useState<ClassBuildMicrocourseTopic[]>([]);
  // 已被新版替代的课程默认不出现：教务在同一年级/季节/班型下几乎总是要最新教材版本，
  // 需要沿用旧版开班时才显式打开。
  const [includeSuperseded, setIncludeSuperseded] = useState(false);
  const [results, setResults] = useState<ClassBuildCourseCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const effectiveCourseKind = fixedCourseKind ?? courseKind;
  const showMicrocourseFilters = effectiveCourseKind !== "curriculum";
  const grouped = useMemo(() => {
    const groups = new Map<string, ClassBuildCourseCandidate[]>();
    for (const candidate of results) {
      const current = groups.get(candidate.familyTitle) ?? [];
      current.push(candidate);
      current.sort((left, right) => left.grade - right.grade
        || (left.courseSeason ?? 99) - (right.courseSeason ?? 99)
        || compareCourseDifficulty(left.classType, right.classType)
        || (left.productCode ?? "").localeCompare(right.productCode ?? "", "en"));
      groups.set(candidate.familyTitle, current);
    }
    return Array.from(groups.entries());
  }, [results]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setSearching(true);
      setFailed(false);
      const searchAction = accessContext === "microcourse-source"
        ? searchTeacherMicrocourseSourceCoursesAction
        : searchClassBuildCoursesAction;
      void searchAction({
        query,
        grade,
        courseSeason,
        classType,
        purpose,
        includeSuperseded,
        courseKind: effectiveCourseKind,
        primaryTopicSlug: showMicrocourseFilters ? primaryTopicSlug : "",
        keyword: showMicrocourseFilters ? keyword : "",
      })
        .then((next) => { if (active) setResults(next); })
        .catch(() => { if (active) { setResults([]); setFailed(true); } })
        .finally(() => { if (active) setSearching(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [accessContext, classType, courseSeason, effectiveCourseKind, grade, includeSuperseded, keyword, open, primaryTopicSlug, purpose, query, showMicrocourseFilters]);

  useEffect(() => {
    if (!open || !showMicrocourseFilters || microcourseTopics.length > 0) return;
    let active = true;
    void listClassBuildMicrocourseTopicsAction()
      .then((topics) => { if (active) setMicrocourseTopics(topics); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [microcourseTopics.length, open, showMicrocourseFilters]);

  const visibleResults = open ? grouped : [];
  const showSearching = open && searching;

  const choose = async (candidate: ClassBuildCourseCandidate) => {
    setSelectingId(candidate.id);
    setFailed(false);
    try {
      const detailAction = accessContext === "microcourse-source"
        ? getTeacherMicrocourseSourceCourseDetailAction
        : getClassBuildCourseDetailAction;
      const detail = await detailAction(candidate.id, purpose);
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
          {selected ? <span className="min-w-0"><span className="block truncate font-medium">{showSelectedDetail ? `${selected.familyTitle} · ${selected.title}` : selected.title}</span>{showSelectedDetail && <span className="block truncate text-xs font-normal text-muted">{selected.productCode || "—"} · {selected.releasedLectureCount}/{selected.lectureCount}</span>}</span> : <span className="text-muted">{t("chooseCourse")}</span>}
          <ChevronsUpDown className="ml-2 size-4 shrink-0 text-muted" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(34rem,calc(100vw-2rem))] p-0">
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder={t("searchCourses")} aria-label={t("searchCourses")} />
          <div className="grid grid-cols-2 gap-2 border-b p-2 sm:grid-cols-3">
            {!fixedCourseKind && <Select value={courseKind ?? ALL} onValueChange={(value) => setCourseKind(value === ALL ? null : value as "curriculum" | "microcourse")}>
              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder={t("allCourseKinds")} /></SelectTrigger>
              <SelectContent><SelectItem value={ALL}>{t("allCourseKinds")}</SelectItem><SelectItem value="curriculum">{t("curriculumCourse")}</SelectItem><SelectItem value="microcourse">{t("teacherMicrocourse")}</SelectItem></SelectContent>
            </Select>}
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
              <SelectContent><SelectItem value={ALL}>{t("allClassTypes")}</SelectItem>{CLASS_TYPES.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
            </Select>
            {showMicrocourseFilters && <Select value={primaryTopicSlug || ALL} onValueChange={(value) => setPrimaryTopicSlug(value === ALL ? "" : value)}>
              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder={t("allTopics")} /></SelectTrigger>
              <SelectContent><SelectItem value={ALL}>{t("allTopics")}</SelectItem>{microcourseTopics.map((topic) => <SelectItem key={topic.id} value={topic.slug}>{locale === "en" ? topic.titleEn : topic.titleZh}</SelectItem>)}</SelectContent>
            </Select>}
            {showMicrocourseFilters && <Input value={keyword} onChange={(event) => setKeyword(event.target.value)} maxLength={32} placeholder={t("keywordFilter")} className="h-9 text-xs" />}
          </div>
          <Label className="flex items-center gap-2 border-b px-2 py-2 text-xs font-normal text-muted">
            <Checkbox checked={includeSuperseded} onCheckedChange={(value) => setIncludeSuperseded(value === true)} />
            {t("includeSupersededCourses")}
          </Label>
          <CommandList className="max-h-80">
            {showSearching && <div className="flex items-center justify-center gap-2 px-3 py-8 text-sm text-muted"><LoaderCircle className="size-4 animate-spin" />{t("searchingCourses")}</div>}
            {!showSearching && visibleResults.map(([familyTitle, candidates]) => <CommandGroup key={familyTitle} heading={familyTitle}>
              {candidates.map((candidate) => <CommandItem key={candidate.id} value={`${candidate.familyTitle} ${candidate.title} ${candidate.productCode ?? ""}`} onSelect={() => void choose(candidate)} disabled={selectingId !== null} className="items-start py-2">
                <CourseCandidateLabel candidate={candidate} />
                {selectingId === candidate.id ? <LoaderCircle className="mt-1 size-4 animate-spin" /> : selected?.id === candidate.id ? <Check className="mt-1 size-4" /> : null}
              </CommandItem>)}
            </CommandGroup>)}
            {!showSearching && !failed && <CommandEmpty>{t("coursePickerEmpty")}</CommandEmpty>}
            {!showSearching && failed && <p className="px-3 py-5 text-center text-sm text-rose">{t("coursePickerFailed")}</p>}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>

    {selected && showSelectedDetail && <div className="flex flex-wrap items-center gap-2 text-sm">
      <CourseCandidateLabel candidate={selected} />
      <Button type="button" variant="ghost" size="sm" onClick={onClear} disabled={disabled} className={cn("shrink-0", disabled && "hidden")}><X className="size-4" />{t("clearCourse")}</Button>
    </div>}
  </div>;
}
