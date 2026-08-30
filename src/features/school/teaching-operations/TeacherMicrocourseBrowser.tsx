"use client";

import { useCallback, useEffect, useState } from "react";
import { Filter, FolderTree, Search, Settings2, SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { TeacherMicrocourseBrowserCapabilities } from "./teacher-microcourse-library";
import type { TeacherMicrocourseConfiguration, TeacherMicrocourseCourseScope } from "./teacher-microcourse-scenes";
import type { TeacherMicrocourseBrowseMode, TeacherMicrocourseBrowserModel } from "./teacher-microcourse-browser";
import { TeacherMicrocourseCreateCourseDialog } from "./TeacherMicrocourseCreateCourseDialog";
import { TeacherMicrocourseQuickPreview } from "./TeacherMicrocourseQuickPreview";
import { TeacherMicrocourseSceneNavigator } from "./TeacherMicrocourseSceneNavigator";
import { TeacherMicrocourseScopeEditor } from "./TeacherMicrocourseScopeEditor";
import { TeacherMicrocourseTable } from "./TeacherMicrocourseTable";

const BROWSE_PREFERENCE_KEY = "mathin:teacher-microcourse:browse";

export function TeacherMicrocourseBrowser({
  familyId,
  familyTitle,
  locale,
  model,
  configuration,
  scopes,
  capabilities,
  browseWasExplicit,
}: {
  familyId: string;
  familyTitle: string;
  locale: string;
  model: TeacherMicrocourseBrowserModel;
  configuration: TeacherMicrocourseConfiguration;
  scopes: TeacherMicrocourseCourseScope[];
  capabilities: TeacherMicrocourseBrowserCapabilities;
  browseWasExplicit: boolean;
}) {
  const t = useTranslations("school.teacherMicrocourseBrowser");
  const router = useRouter();
  const pathname = usePathname();
  const [selectedCourseId, setSelectedCourseId] = useState(model.selectedCourseId);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [search, setSearch] = useState(model.query.q ?? "");
  const [searchAll, setSearchAll] = useState(model.query.searchAll);
  const [gradeIds, setGradeIds] = useState(() => new Set(model.query.gradeIds));
  const [termIds, setTermIds] = useState(() => new Set(model.query.termIds));
  const [systemIds, setSystemIds] = useState(() => new Set(model.query.classSystemIds));
  const [classTypeIds, setClassTypeIds] = useState(() => new Set(model.query.classTypeIds));
  const selectedCourse = model.courses.find((course) => course.id === selectedCourseId) ?? null;

  const navigate = useCallback((patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(patch)) {
      if (value) params.set(key, value); else params.delete(key);
    }
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}`);
  }, [pathname, router]);

  useEffect(() => {
    if (browseWasExplicit) return;
    const stored = window.localStorage.getItem(BROWSE_PREFERENCE_KEY);
    if (stored === "grade" || stored === "term" || stored === "class") navigate({ browse: stored, node: undefined, page: undefined, course: undefined });
  }, [browseWasExplicit, navigate]);

  const setBrowse = (value: TeacherMicrocourseBrowseMode) => {
    window.localStorage.setItem(BROWSE_PREFERENCE_KEY, value);
    navigate({ browse: value, node: undefined, page: undefined, course: undefined });
  };
  const selectCourse = (courseId: string) => {
    setSelectedCourseId(courseId);
    const params = new URLSearchParams(window.location.search);
    params.set("course", courseId);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}`);
    if (window.matchMedia("(max-width: 1023px)").matches) setMobilePreviewOpen(true);
  };
  const toggleChecked = (courseId: string) => setCheckedIds((current) => {
    const next = new Set(current);
    if (next.has(courseId)) next.delete(courseId); else next.add(courseId);
    return next;
  });
  const toggleAll = () => setCheckedIds((current) => model.courses.every((course) => current.has(course.id))
    ? new Set()
    : new Set(model.courses.map((course) => course.id)));
  const toggleFilter = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) => setter((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const applyFilters = () => navigate({
    grades: gradeIds.size ? [...gradeIds].join(",") : undefined,
    terms: termIds.size ? [...termIds].join(",") : undefined,
    systems: systemIds.size ? [...systemIds].join(",") : undefined,
    classTypes: classTypeIds.size ? [...classTypeIds].join(",") : undefined,
    page: undefined,
    course: undefined,
  });
  const clearFilters = () => {
    setGradeIds(new Set()); setTermIds(new Set()); setSystemIds(new Set()); setClassTypeIds(new Set());
    navigate({ grades: undefined, terms: undefined, systems: undefined, classTypes: undefined, page: undefined, course: undefined });
  };
  const selectedScopeIds = checkedIds.size ? [...checkedIds] : selectedCourseId ? [selectedCourseId] : [];
  const defaultSceneId = model.query.node?.startsWith("scene:") ? model.query.node.slice("scene:".length) : undefined;

  return <div className="w-full min-w-0 space-y-5" data-teacher-microcourse-browser>
    <Card>
      <CardHeader className="gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div><div className="flex flex-wrap items-center gap-2"><Badge variant="secondary">{t("teacherMicrocourses")}</Badge><Badge variant="outline">{t("browserV2")}</Badge></div><CardTitle className="mt-3 font-display text-2xl">{familyTitle}</CardTitle><CardDescription className="mt-1">{t("browserDescription")}</CardDescription></div>
        <div className="flex flex-wrap gap-2"><Link href="/dashboard/courses" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>{t("backToLibrary")}</Link>{capabilities.canCreateCourse && <TeacherMicrocourseCreateCourseDialog courseFamilyId={familyId} locale={locale} configuration={configuration} defaultSceneId={defaultSceneId} />}{capabilities.canManageScenes && <Link href={`/dashboard/courses/${familyId}/microcourse-settings`} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}><Settings2 className="h-4 w-4" />{t("directorySettings")}</Link>}</div>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-3 border-t border-line pt-4">
        <div className="w-full basis-80 grow"><Label htmlFor="microcourse-search">{t("searchCourses")}</Label><div className="mt-1 flex gap-2"><Input id="microcourse-search" value={search} placeholder={t("searchPlaceholder")} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") navigate({ q: search.trim() || undefined, searchAll: searchAll ? "1" : undefined, page: undefined, course: undefined }); }} /><Button size="sm" onClick={() => navigate({ q: search.trim() || undefined, searchAll: searchAll ? "1" : undefined, page: undefined, course: undefined })}><Search className="h-4 w-4" />{t("search")}</Button></div><Label className="mt-2 flex items-center gap-2 text-xs text-muted"><Checkbox checked={searchAll} onCheckedChange={(checked) => setSearchAll(Boolean(checked))} />{t("searchAllCourses")}</Label></div>
        <div className="min-w-44"><Label>{t("browseBy")}</Label><Select value={model.query.browse} onValueChange={(value) => setBrowse(value as TeacherMicrocourseBrowseMode)}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="scene">{t("browseScene")}</SelectItem><SelectItem value="grade">{t("browseGrade")}</SelectItem><SelectItem value="term">{t("browseTerm")}</SelectItem><SelectItem value="class">{t("browseClass")}</SelectItem></SelectContent></Select></div>
        <div className="min-w-40"><Label>{t("sortBy")}</Label><Select value={model.query.sort} onValueChange={(value) => navigate({ sort: value === "recent" ? undefined : value, page: undefined })}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="recent">{t("sortRecent")}</SelectItem><SelectItem value="name">{t("sortName")}</SelectItem><SelectItem value="lectures">{t("sortLectures")}</SelectItem></SelectContent></Select></div>
        <Popover><PopoverTrigger asChild><Button variant="secondary" size="sm"><Filter className="h-4 w-4" />{t("filters")}{model.query.gradeIds.length + model.query.termIds.length + model.query.classSystemIds.length + model.query.classTypeIds.length > 0 && <Badge variant="secondary">{model.query.gradeIds.length + model.query.termIds.length + model.query.classSystemIds.length + model.query.classTypeIds.length}</Badge>}</Button></PopoverTrigger><PopoverContent className="w-[min(92vw,36rem)] space-y-5" align="end"><FilterGroup title={t("grades")} items={configuration.grades} locale={locale} selected={gradeIds} onToggle={(id) => toggleFilter(setGradeIds, id)} /><FilterGroup title={t("terms")} items={configuration.terms} locale={locale} selected={termIds} onToggle={(id) => toggleFilter(setTermIds, id)} /><FilterGroup title={t("classSystems")} items={configuration.classSystems} locale={locale} selected={systemIds} onToggle={(id) => toggleFilter(setSystemIds, id)} /><FilterGroup title={t("classTypes")} items={configuration.classSystems.flatMap((system) => system.classTypes)} locale={locale} selected={classTypeIds} onToggle={(id) => toggleFilter(setClassTypeIds, id)} /><div className="flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={clearFilters}>{t("clearFilters")}</Button><Button size="sm" onClick={applyFilters}>{t("applyFilters")}</Button></div></PopoverContent></Popover>
        {capabilities.canManageScopes && <Button variant="secondary" size="sm" disabled={selectedScopeIds.length === 0} onClick={() => setScopeOpen(true)}><SlidersHorizontal className="h-4 w-4" />{t("editSelectedScope", { count: selectedScopeIds.length })}</Button>}
      </CardContent>
    </Card>

    <div className="grid min-w-0 gap-4 @6xl/page:grid-cols-[18rem_minmax(0,1fr)_22rem]">
      <Card className="min-w-0"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><FolderTree className="h-4 w-4" />{t("virtualDirectory")}</CardTitle><CardDescription>{t("directoryHint")}</CardDescription></CardHeader><CardContent className="max-h-[calc(100dvh-18rem)] overflow-y-auto"><TeacherMicrocourseSceneNavigator nodes={model.directory} selectedNode={model.query.node} allLabel={t("allCourses", { count: model.totalCount })} onSelect={(node) => navigate({ node, page: undefined, course: undefined })} /></CardContent></Card>

      <Card className="min-w-0"><CardHeader className="flex-row items-start justify-between gap-4 space-y-0"><div><CardTitle>{t("courseTable")}</CardTitle><CardDescription>{t("courseCount", { count: model.totalCount })}</CardDescription></div>{checkedIds.size > 0 && <Badge variant="secondary">{t("selectedCourses", { count: checkedIds.size })}</Badge>}</CardHeader><CardContent className="p-0"><TeacherMicrocourseTable courses={model.courses} selectedCourseId={selectedCourseId} checkedIds={checkedIds} canManage={capabilities.canManageScopes} onSelect={selectCourse} onToggle={toggleChecked} onToggleAll={toggleAll} /><div className="flex items-center justify-between border-t border-line p-4 text-sm text-muted"><span>{t("pageStatus", { page: model.query.page, pages: model.pageCount })}</span><div className="flex gap-2"><Button variant="secondary" size="sm" disabled={model.query.page <= 1} onClick={() => navigate({ page: String(model.query.page - 1), course: undefined })}>{t("previous")}</Button><Button variant="secondary" size="sm" disabled={model.query.page >= model.pageCount} onClick={() => navigate({ page: String(model.query.page + 1), course: undefined })}>{t("next")}</Button></div></div></CardContent></Card>

      <aside className="hidden min-w-0 lg:block"><TeacherMicrocourseQuickPreview familyId={familyId} course={selectedCourse} canCreateBranch={capabilities.canCreateBranch} /></aside>
    </div>

    <Sheet open={mobilePreviewOpen} onOpenChange={setMobilePreviewOpen}><SheetContent className="w-[min(94vw,32rem)] overflow-y-auto lg:hidden" closeLabel={t("cancel")}><SheetHeader className="sr-only"><SheetTitle>{t("quickPreview")}</SheetTitle><SheetDescription>{t("selectCourseHint")}</SheetDescription></SheetHeader><TeacherMicrocourseQuickPreview familyId={familyId} course={selectedCourse} canCreateBranch={capabilities.canCreateBranch} /></SheetContent></Sheet>
    {capabilities.canManageScopes && <TeacherMicrocourseScopeEditor key={selectedScopeIds.join(",")} open={scopeOpen} onOpenChange={setScopeOpen} courseFamilyId={familyId} courseIds={selectedScopeIds} locale={locale} configuration={configuration} scopes={scopes} />}
  </div>;
}

function FilterGroup({ title, items, locale, selected, onToggle }: {
  title: string;
  items: Array<{ id: string; nameZh: string; nameEn: string; active: boolean }>;
  locale: string;
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  return <fieldset className="space-y-2"><legend className="text-sm font-medium">{title}</legend><div className="grid max-h-36 gap-2 overflow-y-auto @2xl/page:grid-cols-2">{items.filter((item) => item.active).map((item) => <Label key={item.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm"><Checkbox checked={selected.has(item.id)} onCheckedChange={() => onToggle(item.id)} />{locale === "zh" ? item.nameZh : item.nameEn}</Label>)}</div></fieldset>;
}
