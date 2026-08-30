"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Filter, FolderTree, Search, Settings2, SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  DashboardCommandActions,
  DashboardCommandFilters,
  DashboardCommandPanel,
  DashboardCommandSelection,
  DashboardCommandState,
} from "@/features/school/dashboard-page";
import { ObjectBar, ObjectWorkspace } from "@/features/school/object-workspace";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { TeacherMicrocourseBrowserCapabilities, TeacherMicrocourseQuickPreview as TeacherMicrocourseQuickPreviewData } from "./teacher-microcourse-library";
import type { TeacherMicrocourseConfiguration, TeacherMicrocourseCourseScope } from "./teacher-microcourse-scenes";
import type { TeacherMicrocourseBrowseMode, TeacherMicrocourseBrowserModel } from "./teacher-microcourse-browser";
import { TeacherMicrocourseCreateCourseDialog } from "./TeacherMicrocourseCreateCourseDialog";
import { TeacherMicrocourseQuickPreview } from "./TeacherMicrocourseQuickPreview";
import { TeacherMicrocourseSceneNavigator } from "./TeacherMicrocourseSceneNavigator";
import { TeacherMicrocourseScopeEditor } from "./TeacherMicrocourseScopeEditor";
import { TeacherMicrocourseTable } from "./TeacherMicrocourseTable";

const BROWSE_PREFERENCE_KEY = "mathin:teacher-microcourse:browse";
const nodePreferenceKey = (browse: TeacherMicrocourseBrowseMode) => `${BROWSE_PREFERENCE_KEY}:node:${browse}`;
const coursePreferenceKey = (browse: TeacherMicrocourseBrowseMode, node?: string) => `${BROWSE_PREFERENCE_KEY}:course:${browse}:${node ?? "all"}`;

export function TeacherMicrocourseBrowser({
  familyId,
  familyTitle,
  locale,
  model,
  configuration,
  scopes,
  capabilities,
  browseWasExplicit,
  courseWasExplicit,
}: {
  familyId: string;
  familyTitle: string;
  locale: string;
  model: TeacherMicrocourseBrowserModel;
  configuration: TeacherMicrocourseConfiguration;
  scopes: TeacherMicrocourseCourseScope[];
  capabilities: TeacherMicrocourseBrowserCapabilities;
  browseWasExplicit: boolean;
  courseWasExplicit: boolean;
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
  const initialPreview = model.selectedCourseId
    ? model.courses.find((course) => course.id === model.selectedCourseId)?.preview ?? null
    : null;
  const previewCache = useRef(new Map<string, TeacherMicrocourseQuickPreviewData>(
    model.selectedCourseId && initialPreview
      ? [[model.selectedCourseId, initialPreview]]
      : [],
  ));
  const selectedCourseIdRef = useRef(model.selectedCourseId);
  const previewRequest = useRef<AbortController | null>(null);
  const prefetchTimers = useRef(new Map<string, number>());
  const [selectedPreview, setSelectedPreview] = useState<TeacherMicrocourseQuickPreviewData | null>(initialPreview);
  const selectedCourseBase = model.courses.find((course) => course.id === selectedCourseId) ?? null;
  const selectedCourse = selectedCourseBase && selectedPreview?.courseId === selectedCourseBase.id
    ? { ...selectedCourseBase, preview: selectedPreview, branchCount: selectedPreview.branchCount }
    : selectedCourseBase;

  const loadPreview = useCallback(async (courseId: string) => {
    const cached = previewCache.current.get(courseId);
    if (cached) return cached;
    previewRequest.current?.abort();
    const controller = new AbortController();
    previewRequest.current = controller;
    try {
      const response = await fetch(`/api/teacher-microcourses/${courseId}/quick-preview`, { signal: controller.signal });
      if (!response.ok) return undefined;
      const preview = await response.json() as TeacherMicrocourseQuickPreviewData;
      previewCache.current.set(courseId, preview);
      while (previewCache.current.size > 20) {
        const oldest = previewCache.current.keys().next().value as string | undefined;
        if (!oldest) break;
        previewCache.current.delete(oldest);
      }
      return preview;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      return undefined;
    }
  }, []);

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
    if (stored === "scene" || stored === "grade" || stored === "term" || stored === "class") {
      navigate({ browse: stored, node: window.localStorage.getItem(nodePreferenceKey(stored)) ?? undefined, page: undefined, course: undefined });
    }
  }, [browseWasExplicit, navigate]);

  useEffect(() => {
    if (courseWasExplicit) return;
    const stored = window.localStorage.getItem(coursePreferenceKey(model.query.browse, model.query.node));
    const matching = stored ? model.courses.find((course) => course.id === stored) : undefined;
    if (!matching || matching.id === selectedCourseIdRef.current) return;
    selectedCourseIdRef.current = matching.id;
    setSelectedCourseId(matching.id);
    setSelectedPreview(previewCache.current.get(matching.id) ?? matching.preview);
    const params = new URLSearchParams(window.location.search);
    params.set("course", matching.id);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}`);
    void loadPreview(matching.id).then((preview) => {
      if (preview && selectedCourseIdRef.current === matching.id) setSelectedPreview(preview);
    });
  }, [courseWasExplicit, loadPreview, model.courses, model.query.browse, model.query.node]);

  useEffect(() => () => {
    previewRequest.current?.abort();
    for (const timer of prefetchTimers.current.values()) window.clearTimeout(timer);
  }, []);

  const setBrowse = (value: TeacherMicrocourseBrowseMode) => {
    window.localStorage.setItem(BROWSE_PREFERENCE_KEY, value);
    navigate({ browse: value, node: window.localStorage.getItem(nodePreferenceKey(value)) ?? undefined, page: undefined, course: undefined });
  };
  const selectDirectory = (node?: string) => {
    if (node) window.localStorage.setItem(nodePreferenceKey(model.query.browse), node);
    else window.localStorage.removeItem(nodePreferenceKey(model.query.browse));
    navigate({ node, page: undefined, course: undefined });
  };
  const selectCourse = (courseId: string) => {
    selectedCourseIdRef.current = courseId;
    setSelectedCourseId(courseId);
    setSelectedPreview(previewCache.current.get(courseId)
      ?? model.courses.find((course) => course.id === courseId)?.preview
      ?? null);
    window.localStorage.setItem(coursePreferenceKey(model.query.browse, model.query.node), courseId);
    const params = new URLSearchParams(window.location.search);
    params.set("course", courseId);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}`);
    void loadPreview(courseId).then((preview) => {
      if (preview && selectedCourseIdRef.current === courseId) setSelectedPreview(preview);
    });
    if (window.matchMedia("(max-width: 1023px)").matches) setMobilePreviewOpen(true);
  };
  const prefetchCourse = (courseId: string) => {
    if (previewCache.current.has(courseId) || prefetchTimers.current.has(courseId)) return;
    const timer = window.setTimeout(() => {
      prefetchTimers.current.delete(courseId);
      void loadPreview(courseId);
    }, 120);
    prefetchTimers.current.set(courseId, timer);
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

  const filterCount = model.query.gradeIds.length + model.query.termIds.length
    + model.query.classSystemIds.length + model.query.classTypeIds.length;
  const searchCourses = () => navigate({
    q: search.trim() || undefined,
    searchAll: searchAll ? "1" : undefined,
    page: undefined,
    course: undefined,
  });

  return <ObjectWorkspace
    className="w-full min-w-0"
    objectBar={<ObjectBar
      title={familyTitle}
      backHref="/dashboard/courses"
      backLabel={t("backToLibrary")}
      context={[
        { value: t("teacherMicrocourses") },
        { value: t("courseCount", { count: model.totalCount }) },
      ]}
      status={<Badge variant="outline">{t("browserV2")}</Badge>}
    />}
    commandPanel={<DashboardCommandPanel selection={checkedIds.size > 0 ? <DashboardCommandSelection>
      <span className="font-medium text-ink">{t("selectedCourses", { count: checkedIds.size })}</span>
      {capabilities.canManageScopes && <Button variant="secondary" size="sm" onClick={() => setScopeOpen(true)}><SlidersHorizontal className="h-4 w-4" />{t("editSelectedScope", { count: checkedIds.size })}</Button>}
      <Button variant="ghost" size="sm" onClick={() => setCheckedIds(new Set())}>{t("clearSelection")}</Button>
    </DashboardCommandSelection> : undefined}>
      <DashboardCommandState>
        <Label className="sr-only" htmlFor="microcourse-browse">{t("browseBy")}</Label>
        <Select value={model.query.browse} onValueChange={(value) => setBrowse(value as TeacherMicrocourseBrowseMode)}>
          <SelectTrigger id="microcourse-browse" className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="scene">{t("browseScene")}</SelectItem><SelectItem value="grade">{t("browseGrade")}</SelectItem><SelectItem value="term">{t("browseTerm")}</SelectItem><SelectItem value="class">{t("browseClass")}</SelectItem></SelectContent>
        </Select>
      </DashboardCommandState>
      <DashboardCommandFilters>
        <div className="flex basis-56 grow items-center gap-2 @3xl/chrome:max-w-xl">
          <Label className="sr-only" htmlFor="microcourse-search">{t("searchCourses")}</Label>
          <Input id="microcourse-search" value={search} placeholder={t("searchPlaceholder")} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") searchCourses(); }} />
          <Button size="sm" onClick={searchCourses}><Search className="h-4 w-4" /><span className="sr-only @4xl/chrome:not-sr-only">{t("search")}</span></Button>
        </div>
        <Label className="flex items-center gap-2 whitespace-nowrap text-xs text-muted"><Checkbox checked={searchAll} onCheckedChange={(checked) => setSearchAll(Boolean(checked))} />{t("searchAllCourses")}</Label>
        <Label className="sr-only" htmlFor="microcourse-sort">{t("sortBy")}</Label>
        <Select value={model.query.sort} onValueChange={(value) => navigate({ sort: value === "recent" ? undefined : value, page: undefined })}>
          <SelectTrigger id="microcourse-sort" className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="recent">{t("sortRecent")}</SelectItem><SelectItem value="name">{t("sortName")}</SelectItem><SelectItem value="lectures">{t("sortLectures")}</SelectItem></SelectContent>
        </Select>
        <Popover><PopoverTrigger asChild><Button variant="secondary" size="sm"><Filter className="h-4 w-4" />{t("filters")}{filterCount > 0 && <Badge variant="secondary">{filterCount}</Badge>}</Button></PopoverTrigger><PopoverContent className="w-[min(92vw,36rem)] space-y-5" align="end"><FilterGroup title={t("grades")} items={configuration.grades} locale={locale} selected={gradeIds} onToggle={(id) => toggleFilter(setGradeIds, id)} /><FilterGroup title={t("terms")} items={configuration.terms} locale={locale} selected={termIds} onToggle={(id) => toggleFilter(setTermIds, id)} /><FilterGroup title={t("classSystems")} items={configuration.classSystems} locale={locale} selected={systemIds} onToggle={(id) => toggleFilter(setSystemIds, id)} /><FilterGroup title={t("classTypes")} items={configuration.classSystems.flatMap((system) => system.classTypes)} locale={locale} selected={classTypeIds} onToggle={(id) => toggleFilter(setClassTypeIds, id)} /><div className="flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={clearFilters}>{t("clearFilters")}</Button><Button size="sm" onClick={applyFilters}>{t("applyFilters")}</Button></div></PopoverContent></Popover>
      </DashboardCommandFilters>
      <DashboardCommandActions>
        {capabilities.canManageScopes && selectedScopeIds.length > 0 && <Button variant="secondary" size="sm" onClick={() => setScopeOpen(true)}><SlidersHorizontal className="h-4 w-4" /><span className="sr-only">{t("editSelectedScope", { count: selectedScopeIds.length })}</span></Button>}
        {capabilities.canManageScenes && <Link href={`/dashboard/courses/${familyId}/microcourse-settings`} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}><Settings2 className="h-4 w-4" /><span className="sr-only">{t("directorySettings")}</span></Link>}
        {capabilities.canCreateCourse && <TeacherMicrocourseCreateCourseDialog courseFamilyId={familyId} locale={locale} configuration={configuration} defaultSceneId={defaultSceneId} />}
      </DashboardCommandActions>
    </DashboardCommandPanel>}
  >
    <div className="grid min-h-[34rem] min-w-0 overflow-hidden bg-moon/10 @3xl/page:grid-cols-[14rem_minmax(0,1fr)] @6xl/page:grid-cols-[16rem_minmax(0,1fr)_20rem]" data-teacher-microcourse-browser>
      <section className="min-w-0 @3xl/page:border-r @3xl/page:border-line/70" aria-labelledby="microcourse-directory-title">
        <header className="px-3 py-2.5">
          <h2 id="microcourse-directory-title" className="flex items-center gap-2 text-sm font-medium"><FolderTree className="h-4 w-4" />{t("virtualDirectory")}</h2>
          <p className="mt-0.5 text-xs leading-5 text-muted">{t("directoryHint")}</p>
        </header>
        <div className="max-h-52 overflow-y-auto p-2 @3xl/page:max-h-[calc(100dvh-16rem)]"><TeacherMicrocourseSceneNavigator nodes={model.directory} selectedNode={model.query.node} allLabel={t("allCourses", { count: model.totalCount })} onSelect={selectDirectory} /></div>
      </section>

      <section className="min-w-0" aria-labelledby="microcourse-table-title">
        <header className="flex min-h-14 items-center justify-between gap-3 px-3 py-2">
          <div><h2 id="microcourse-table-title" className="text-sm font-medium">{t("courseTable")}</h2><p className="text-xs text-muted">{t("courseCount", { count: model.totalCount })}</p></div>
          {checkedIds.size > 0 && <Badge variant="secondary">{t("selectedCourses", { count: checkedIds.size })}</Badge>}
        </header>
        <TeacherMicrocourseTable courses={model.courses} selectedCourseId={selectedCourseId} checkedIds={checkedIds} canManage={capabilities.canManageScopes} onSelect={selectCourse} onPrefetch={prefetchCourse} onToggle={toggleChecked} onToggleAll={toggleAll} />
        <div className="flex min-h-12 items-center justify-between px-3 py-2 text-xs text-muted"><span>{t("pageStatus", { page: model.query.page, pages: model.pageCount })}</span><div className="flex gap-1"><Button variant="ghost" size="sm" disabled={model.query.page <= 1} onClick={() => navigate({ page: String(model.query.page - 1), course: undefined })}>{t("previous")}</Button><Button variant="ghost" size="sm" disabled={model.query.page >= model.pageCount} onClick={() => navigate({ page: String(model.query.page + 1), course: undefined })}>{t("next")}</Button></div></div>
      </section>

      <aside className="hidden min-w-0 border-l border-line/70 @6xl/page:block"><TeacherMicrocourseQuickPreview familyId={familyId} course={selectedCourse} canCreateBranch={capabilities.canCreateBranch} /></aside>
    </div>

    <Sheet open={mobilePreviewOpen} onOpenChange={setMobilePreviewOpen}><SheetContent className="w-[min(94vw,32rem)] overflow-y-auto @6xl/page:hidden" closeLabel={t("cancel")}><SheetHeader className="sr-only"><SheetTitle>{t("quickPreview")}</SheetTitle><SheetDescription>{t("selectCourseHint")}</SheetDescription></SheetHeader><TeacherMicrocourseQuickPreview familyId={familyId} course={selectedCourse} canCreateBranch={capabilities.canCreateBranch} /></SheetContent></Sheet>
    {capabilities.canManageScopes && <TeacherMicrocourseScopeEditor key={selectedScopeIds.join(",")} open={scopeOpen} onOpenChange={setScopeOpen} courseFamilyId={familyId} courseIds={selectedScopeIds} locale={locale} configuration={configuration} scopes={scopes} />}
  </ObjectWorkspace>;
}

function FilterGroup({ title, items, locale, selected, onToggle }: {
  title: string;
  items: Array<{ id: string; nameZh: string; nameEn: string; active: boolean }>;
  locale: string;
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  return <fieldset className="space-y-2"><legend className="text-sm font-medium">{title}</legend><div className="grid max-h-36 gap-1 overflow-y-auto bg-moon/10 p-1 @2xl/page:grid-cols-2">{items.filter((item) => item.active).map((item) => <Label key={item.id} className="flex cursor-pointer items-center gap-2 px-2 py-2 text-sm"><Checkbox checked={selected.has(item.id)} onCheckedChange={() => onToggle(item.id)} />{locale === "zh" ? item.nameZh : item.nameEn}</Label>)}</div></fieldset>;
}
