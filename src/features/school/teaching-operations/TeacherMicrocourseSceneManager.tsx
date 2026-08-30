"use client";

import { useMemo, useState } from "react";
import { Archive, ArrowDown, ArrowUp, GripVertical, Plus, RotateCcw, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction, type ActionErrorMessages } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { DashboardTableShell } from "@/features/school/dashboard-page";
import { useRouter } from "@/i18n/navigation";
import type { StaffOption } from "../classes";
import {
  createTeacherMicrocourseSceneAction,
  moveTeacherMicrocourseDimensionAction,
  moveTeacherMicrocourseScenesAction,
  reorderTeacherMicrocourseSceneRootsAction,
  setTeacherMicrocourseSceneRootsAction,
  setTeacherMicrocourseSubjectManagersAction,
  updateTeacherMicrocourseSceneAction,
  upsertTeacherMicrocourseDimensionAction,
} from "../actions/teacher-microcourse-scenes";
import type {
  TeacherMicrocourseConfiguration,
  TeacherMicrocourseDimensionKind,
  TeacherMicrocourseScene,
} from "./teacher-microcourse-scenes";

const emptyDimension = {
  id: null as string | null,
  kind: "grade_stage" as TeacherMicrocourseDimensionKind,
  parentId: null as string | null,
  code: "",
  nameZh: "",
  nameEn: "",
  gradeNo: null as number | null,
  legacySeason: null as number | null,
  active: true,
};

type DimensionDraft = typeof emptyDimension;

export function TeacherMicrocourseSceneManager({
  courseFamilyId,
  locale,
  configuration,
  staffOptions,
}: {
  courseFamilyId: string;
  locale: string;
  configuration: TeacherMicrocourseConfiguration;
  staffOptions: StaffOption[];
}) {
  const t = useTranslations("school.teacherMicrocourseBrowser");
  const router = useRouter();
  const errors: ActionErrorMessages = {
    SCENE_NAME_EXISTS: t("sceneNameExists"),
    SCENE_HAS_ACTIVE_CHILDREN: t("sceneHasChildren"),
    SCENE_HAS_UNSELECTED_CHILDREN: t("sceneHasUnselectedChildren"),
    DIMENSION_VALUE_EXISTS: t("dimensionExists"),
    FORBIDDEN: t("forbidden"),
    default: t("actionFailed"),
  };
  const refresh = () => router.refresh();
  const commonOpts = { successMessage: t("saved"), errorMessage: errors, onSuccess: refresh };

  const enabledRoots = configuration.roots.filter((root) => root.enabled);
  const [rootCodes, setRootCodes] = useState(() => new Set(enabledRoots.map((root) => root.frameworkItemCode)));
  const [selectedScenes, setSelectedScenes] = useState<Set<string>>(() => new Set());
  const [moveRootId, setMoveRootId] = useState(enabledRoots[0]?.id ?? "");
  const [moveParentId, setMoveParentId] = useState("__root__");
  const [sceneDraft, setSceneDraft] = useState<{
    id: string | null;
    rootId: string;
    parentId: string;
    name: string;
    description: string;
    status: "active" | "archived";
  } | null>(null);
  const [dimensionDraft, setDimensionDraft] = useState<DimensionDraft | null>(null);
  const [managerIds, setManagerIds] = useState(() => new Set(configuration.subjectManagers.map((manager) => manager.userId)));

  const rootSave = useAction(setTeacherMicrocourseSceneRootsAction, commonOpts);
  const rootOrder = useAction(reorderTeacherMicrocourseSceneRootsAction, commonOpts);
  const sceneCreate = useAction(createTeacherMicrocourseSceneAction, { ...commonOpts, onSuccess: () => { setSceneDraft(null); refresh(); } });
  const sceneUpdate = useAction(updateTeacherMicrocourseSceneAction, { ...commonOpts, onSuccess: () => { setSceneDraft(null); refresh(); } });
  const sceneMove = useAction(moveTeacherMicrocourseScenesAction, { ...commonOpts, onSuccess: () => { setSelectedScenes(new Set()); refresh(); } });
  const dimensionSave = useAction(upsertTeacherMicrocourseDimensionAction, { ...commonOpts, onSuccess: () => { setDimensionDraft(null); refresh(); } });
  const dimensionMove = useAction(moveTeacherMicrocourseDimensionAction, commonOpts);
  const managerSave = useAction(setTeacherMicrocourseSubjectManagersAction, commonOpts);
  const pending = rootSave.pending || rootOrder.pending || sceneCreate.pending || sceneUpdate.pending
    || sceneMove.pending || dimensionSave.pending || dimensionMove.pending || managerSave.pending;

  const frameworkLabel = (code: string) => {
    const item = configuration.frameworkItems.find((candidate) => candidate.code === code);
    return item ? (locale === "zh" ? item.labelZh : item.labelEn) : code;
  };
  const moveParents = useMemo(() => configuration.roots
    .find((root) => root.id === moveRootId)?.scenes
    .filter((scene) => scene.status === "active" && scene.parentId === null && !selectedScenes.has(scene.id)) ?? [],
  [configuration.roots, moveRootId, selectedScenes]);

  const reorderRoot = (sourceId: string, targetId: string) => {
    const ids = enabledRoots.map((root) => root.id);
    const sourceIndex = ids.indexOf(sourceId);
    const targetIndex = ids.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
    const next = [...ids];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    rootOrder.run({ courseFamilyId, rootIds: next });
  };

  const toggleScene = (id: string) => setSelectedScenes((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const openNewScene = (rootId: string, parentId = "__root__") => setSceneDraft({
    id: null, rootId, parentId, name: "", description: "", status: "active",
  });
  const openEditScene = (rootId: string, scene: TeacherMicrocourseScene) => setSceneDraft({
    id: scene.id,
    rootId,
    parentId: scene.parentId ?? "__root__",
    name: scene.name,
    description: scene.description,
    status: scene.status,
  });

  const saveScene = () => {
    if (!sceneDraft) return;
    if (sceneDraft.id) {
      sceneUpdate.run({ courseFamilyId, sceneId: sceneDraft.id, name: sceneDraft.name, description: sceneDraft.description, status: sceneDraft.status });
    } else {
      sceneCreate.run({ courseFamilyId, rootId: sceneDraft.rootId, parentId: sceneDraft.parentId === "__root__" ? null : sceneDraft.parentId, name: sceneDraft.name, description: sceneDraft.description });
    }
  };

  const dimensions = [
    { kind: "grade_stage" as const, title: t("gradeStages"), rows: configuration.gradeStages.map((row) => ({ ...row, parentId: null, gradeNo: null, legacySeason: null })) },
    { kind: "grade" as const, title: t("grades"), rows: configuration.grades.map((row) => ({ ...row, code: String(row.gradeNo), parentId: row.stageId, gradeNo: row.gradeNo, legacySeason: null })) },
    { kind: "term" as const, title: t("terms"), rows: configuration.terms.map((row) => ({ ...row, parentId: null, gradeNo: null })) },
    { kind: "class_system" as const, title: t("classSystems"), rows: configuration.classSystems.map((row) => ({ ...row, parentId: null, gradeNo: null, legacySeason: null })) },
    { kind: "class_type" as const, title: t("classTypes"), rows: configuration.classSystems.flatMap((system) => system.classTypes.map((row) => ({ ...row, parentId: system.id, gradeNo: null, legacySeason: null }))) },
  ];

  return <Tabs defaultValue="scenes" className="space-y-5">
    <TabsList>
      <TabsTrigger value="scenes">{t("sceneSettings")}</TabsTrigger>
      <TabsTrigger value="academic">{t("academicSettings")}</TabsTrigger>
      <TabsTrigger value="managers">{t("subjectManagers")}</TabsTrigger>
    </TabsList>

    <TabsContent value="scenes" className="space-y-5">
      <section className="border-y border-line">
        <header className="border-b border-line px-3 py-2.5">
          <h2 className="text-sm font-medium">{t("frameworkTitle")}</h2>
          <p className="mt-0.5 text-xs text-muted">{t("frameworkHint")}</p>
        </header>
        <div className="space-y-5 px-3 py-3">
          {(["seven_step", "six_support", "six_guarantee"] as const).map((group) => <div key={group} className="space-y-2">
            <p className="text-sm font-medium">{t(group)}</p>
            <div className="grid gap-2 @2xl/page:grid-cols-2 @6xl/page:grid-cols-3">
              {configuration.frameworkItems.filter((item) => item.groupCode === group).map((item) => <Label key={item.code} className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg border border-line px-3 py-2 text-sm">
                <Checkbox checked={rootCodes.has(item.code)} disabled={!configuration.canManageScenes || pending} onCheckedChange={(checked) => setRootCodes((current) => {
                  const next = new Set(current);
                  if (checked) next.add(item.code); else next.delete(item.code);
                  return next;
                })} />
                {locale === "zh" ? item.labelZh : item.labelEn}
              </Label>)}
            </div>
          </div>)}
          {configuration.canManageScenes && <Button disabled={pending} onClick={() => rootSave.run({ courseFamilyId, frameworkItemCodes: [...rootCodes] })}>
            <Save className="mr-2 h-4 w-4" />{t("saveEnabledRoots")}
          </Button>}
        </div>
      </section>

      <div className="space-y-4">
        {enabledRoots.map((root, rootIndex) => {
          const topLevel = root.scenes.filter((scene) => scene.parentId === null);
          return <section className="border-y border-line" key={root.id} draggable={configuration.canManageScenes} onDragStart={(event) => event.dataTransfer.setData("application/x-mathin-root", root.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
            event.preventDefault();
            const sourceRoot = event.dataTransfer.getData("application/x-mathin-root");
            if (sourceRoot) reorderRoot(sourceRoot, root.id);
            else if (selectedScenes.size) sceneMove.run({ courseFamilyId, sceneIds: [...selectedScenes], targetRootId: root.id, targetParentId: null, targetIndex: topLevel.length });
          }}>
            <header className="flex items-start justify-between gap-4 border-b border-line px-3 py-2.5">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-medium"><GripVertical className="h-4 w-4 text-muted" />{frameworkLabel(root.frameworkItemCode)}</h2>
                <p className="mt-0.5 text-xs text-muted">{t("rootSummary", { scenes: root.scenes.filter((scene) => scene.status === "active").length, courses: root.courseCount })}</p>
              </div>
              {configuration.canManageScenes && <div className="flex gap-1">
                <Button size="sm" className="h-9 w-9 p-0" variant="ghost" disabled={pending || rootIndex === 0} aria-label={t("moveUp")} onClick={() => reorderRoot(root.id, enabledRoots[rootIndex - 1]?.id ?? root.id)}><ArrowUp className="h-4 w-4" /></Button>
                <Button size="sm" className="h-9 w-9 p-0" variant="ghost" disabled={pending || rootIndex === enabledRoots.length - 1} aria-label={t("moveDown")} onClick={() => reorderRoot(root.id, enabledRoots[rootIndex + 1]?.id ?? root.id)}><ArrowDown className="h-4 w-4" /></Button>
                <Button size="sm" variant="secondary" disabled={pending} onClick={() => openNewScene(root.id)}><Plus className="mr-2 h-4 w-4" />{t("addScene")}</Button>
              </div>}
            </header>
            <DashboardTableShell>
              <Table>
                <TableHeader><TableRow><TableHead className="w-10" /><TableHead>{t("scene")}</TableHead><TableHead>{t("description")}</TableHead><TableHead>{t("linkedCourses")}</TableHead><TableHead className="text-right">{t("actions")}</TableHead></TableRow></TableHeader>
                <TableBody>
                  {topLevel.map((scene) => <SceneRow key={scene.id} scene={scene} childrenRows={root.scenes.filter((child) => child.parentId === scene.id)} canManage={configuration.canManageScenes} selectedIds={selectedScenes} pending={pending} onToggle={toggleScene} onEditScene={(target) => openEditScene(root.id, target)} onAddChild={() => openNewScene(root.id, scene.id)} />)}
                  {topLevel.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted">{t("noScenes")}</TableCell></TableRow>}
                </TableBody>
              </Table>
            </DashboardTableShell>
          </section>;
        })}
      </div>

      {configuration.canManageScenes && selectedScenes.size > 0 && <section className="sticky bottom-4 flex flex-wrap items-end gap-3 border-y border-crater bg-paper/95 p-4 shadow-lg backdrop-blur">
          <div className="mr-auto"><p className="text-sm font-medium">{t("selectedScenes", { count: selectedScenes.size })}</p><p className="text-xs text-muted">{t("bulkMoveHint")}</p></div>
          <div className="min-w-48"><Label>{t("targetRoot")}</Label><Select value={moveRootId} onValueChange={(value) => { setMoveRootId(value); setMoveParentId("__root__"); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{enabledRoots.map((root) => <SelectItem key={root.id} value={root.id}>{frameworkLabel(root.frameworkItemCode)}</SelectItem>)}</SelectContent></Select></div>
          <div className="min-w-48"><Label>{t("targetParent")}</Label><Select value={moveParentId} onValueChange={setMoveParentId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__root__">{t("rootLevel")}</SelectItem>{moveParents.map((scene) => <SelectItem key={scene.id} value={scene.id}>{scene.name}</SelectItem>)}</SelectContent></Select></div>
          <Button disabled={pending || !moveRootId} onClick={() => sceneMove.run({ courseFamilyId, sceneIds: [...selectedScenes], targetRootId: moveRootId, targetParentId: moveParentId === "__root__" ? null : moveParentId, targetIndex: 10_000 })}>{t("moveSelected")}</Button>
      </section>}
    </TabsContent>

    <TabsContent value="academic" className="space-y-5">
      {!configuration.canManageOrganization && <p className="rounded-lg border border-line bg-moon/15 p-4 text-sm text-muted">{t("academicReadOnly")}</p>}
      {dimensions.map((group) => <section className="border-y border-line" key={group.kind}>
        <header className="flex items-center justify-between border-b border-line px-3 py-2.5"><div><h2 className="text-sm font-medium">{group.title}</h2><p className="mt-0.5 text-xs text-muted">{t(`${group.kind}Hint`)}</p></div>{configuration.canManageOrganization && <Button size="sm" variant="secondary" onClick={() => setDimensionDraft({ ...emptyDimension, kind: group.kind })}><Plus className="mr-2 h-4 w-4" />{t("add")}</Button>}</header>
        <DashboardTableShell><Table><TableHeader><TableRow><TableHead>{t("code")}</TableHead><TableHead>{t("chineseName")}</TableHead><TableHead>{t("englishName")}</TableHead><TableHead>{t("status")}</TableHead><TableHead className="text-right">{t("actions")}</TableHead></TableRow></TableHeader><TableBody>
          {group.rows.map((row, index) => <TableRow key={row.id}><TableCell>{row.code}</TableCell><TableCell>{row.nameZh}</TableCell><TableCell>{row.nameEn}</TableCell><TableCell><Badge variant={row.active ? "secondary" : "outline"}>{row.active ? t("active") : t("inactive")}</Badge></TableCell><TableCell><div className="flex justify-end gap-1">{configuration.canManageOrganization && <><Button size="sm" className="h-9 w-9 p-0" variant="ghost" disabled={pending || index === 0} onClick={() => dimensionMove.run({ kind: group.kind, id: row.id, direction: -1 })}><ArrowUp className="h-4 w-4" /></Button><Button size="sm" className="h-9 w-9 p-0" variant="ghost" disabled={pending || index === group.rows.length - 1} onClick={() => dimensionMove.run({ kind: group.kind, id: row.id, direction: 1 })}><ArrowDown className="h-4 w-4" /></Button><Button size="sm" variant="ghost" onClick={() => setDimensionDraft({ id: row.id, kind: group.kind, parentId: row.parentId, code: row.code, nameZh: row.nameZh, nameEn: row.nameEn, gradeNo: row.gradeNo, legacySeason: row.legacySeason ?? null, active: row.active })}>{t("edit")}</Button></>}</div></TableCell></TableRow>)}
        </TableBody></Table></DashboardTableShell>
      </section>)}
    </TabsContent>

    <TabsContent value="managers">
      <section className="border-y border-line"><header className="border-b border-line px-3 py-2.5"><h2 className="text-sm font-medium">{t("subjectManagers")}</h2><p className="mt-0.5 text-xs text-muted">{t("managerHint")}</p></header><div className="space-y-4 p-3"><div className="grid gap-2 @2xl/page:grid-cols-2 @6xl/page:grid-cols-3">{staffOptions.map((staff) => <Label key={staff.id} className="flex items-center gap-3 border-y border-line px-3 py-2"><Checkbox checked={managerIds.has(staff.id)} disabled={pending} onCheckedChange={(checked) => setManagerIds((current) => { const next = new Set(current); if (checked) next.add(staff.id); else next.delete(staff.id); return next; })} />{staff.name}</Label>)}</div><Button disabled={pending} onClick={() => managerSave.run({ courseFamilyId, userIds: [...managerIds] })}><Save className="mr-2 h-4 w-4" />{t("saveManagers")}</Button></div></section>
    </TabsContent>

    <Dialog open={sceneDraft !== null} onOpenChange={(open) => { if (!open) setSceneDraft(null); }}>
      <DialogContent><DialogHeader><DialogTitle>{sceneDraft?.id ? t("editScene") : t("addScene")}</DialogTitle><DialogDescription>{t("sceneDialogHint")}</DialogDescription></DialogHeader>{sceneDraft && <div className="space-y-4"><div><Label htmlFor="scene-name">{t("sceneName")}</Label><Input id="scene-name" value={sceneDraft.name} maxLength={80} onChange={(event) => setSceneDraft({ ...sceneDraft, name: event.target.value })} /></div><div><Label htmlFor="scene-description">{t("description")}</Label><Textarea id="scene-description" value={sceneDraft.description} maxLength={500} onChange={(event) => setSceneDraft({ ...sceneDraft, description: event.target.value })} /></div>{sceneDraft.id && <Label className="flex items-center gap-3"><Checkbox checked={sceneDraft.status === "active"} onCheckedChange={(checked) => setSceneDraft({ ...sceneDraft, status: checked ? "active" : "archived" })} />{sceneDraft.status === "active" ? t("active") : t("archived")}</Label>}</div>}<DialogFooter><Button variant="secondary" onClick={() => setSceneDraft(null)}>{t("cancel")}</Button><Button disabled={pending || !sceneDraft?.name.trim()} onClick={saveScene}>{sceneDraft?.status === "archived" ? <Archive className="mr-2 h-4 w-4" /> : <Save className="mr-2 h-4 w-4" />}{t("save")}</Button></DialogFooter></DialogContent>
    </Dialog>

    <Dialog open={dimensionDraft !== null} onOpenChange={(open) => { if (!open) setDimensionDraft(null); }}>
      <DialogContent><DialogHeader><DialogTitle>{dimensionDraft?.id ? t("editDimension") : t("addDimension")}</DialogTitle><DialogDescription>{t("dimensionDialogHint")}</DialogDescription></DialogHeader>{dimensionDraft && <div className="grid gap-4 sm:grid-cols-2"><div><Label htmlFor="dimension-code">{t("code")}</Label><Input id="dimension-code" value={dimensionDraft.code} disabled={dimensionDraft.kind === "grade"} maxLength={40} onChange={(event) => setDimensionDraft({ ...dimensionDraft, code: event.target.value })} /></div>{dimensionDraft.kind === "grade" && <div><Label htmlFor="dimension-grade">{t("gradeNumber")}</Label><Input id="dimension-grade" type="number" min={1} max={99} value={dimensionDraft.gradeNo ?? ""} onChange={(event) => setDimensionDraft({ ...dimensionDraft, gradeNo: event.target.value ? Number(event.target.value) : null, code: event.target.value })} /></div>}<div><Label htmlFor="dimension-zh">{t("chineseName")}</Label><Input id="dimension-zh" value={dimensionDraft.nameZh} maxLength={40} onChange={(event) => setDimensionDraft({ ...dimensionDraft, nameZh: event.target.value })} /></div><div><Label htmlFor="dimension-en">{t("englishName")}</Label><Input id="dimension-en" value={dimensionDraft.nameEn} maxLength={80} onChange={(event) => setDimensionDraft({ ...dimensionDraft, nameEn: event.target.value })} /></div>{dimensionDraft.kind === "grade" && <div><Label>{t("gradeStage")}</Label><Select value={dimensionDraft.parentId ?? ""} onValueChange={(value) => setDimensionDraft({ ...dimensionDraft, parentId: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{configuration.gradeStages.map((stage) => <SelectItem key={stage.id} value={stage.id}>{locale === "zh" ? stage.nameZh : stage.nameEn}</SelectItem>)}</SelectContent></Select></div>}{dimensionDraft.kind === "class_type" && <div><Label>{t("classSystem")}</Label><Select value={dimensionDraft.parentId ?? ""} onValueChange={(value) => setDimensionDraft({ ...dimensionDraft, parentId: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{configuration.classSystems.map((system) => <SelectItem key={system.id} value={system.id}>{locale === "zh" ? system.nameZh : system.nameEn}</SelectItem>)}</SelectContent></Select></div>}{dimensionDraft.kind === "term" && <div><Label>{t("legacySeason")}</Label><Select value={dimensionDraft.legacySeason ? String(dimensionDraft.legacySeason) : "none"} onValueChange={(value) => setDimensionDraft({ ...dimensionDraft, legacySeason: value === "none" ? null : Number(value) })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{t("none")}</SelectItem>{[1,2,3,4].map((season) => <SelectItem key={season} value={String(season)}>{t(`season${season}`)}</SelectItem>)}</SelectContent></Select></div>}<Label className="flex items-center gap-3 sm:col-span-2"><Checkbox checked={dimensionDraft.active} onCheckedChange={(checked) => setDimensionDraft({ ...dimensionDraft, active: Boolean(checked) })} />{t("active")}</Label></div>}<DialogFooter><Button variant="secondary" onClick={() => setDimensionDraft(null)}>{t("cancel")}</Button><Button disabled={pending || !dimensionDraft?.nameZh.trim() || !dimensionDraft?.nameEn.trim() || !dimensionDraft?.code.trim()} onClick={() => dimensionDraft && dimensionSave.run(dimensionDraft)}><Save className="mr-2 h-4 w-4" />{t("save")}</Button></DialogFooter></DialogContent>
    </Dialog>
  </Tabs>;
}

function SceneRow({ scene, childrenRows, canManage, selectedIds, pending, onToggle, onEditScene, onAddChild }: {
  scene: TeacherMicrocourseScene;
  childrenRows: TeacherMicrocourseScene[];
  canManage: boolean;
  selectedIds: ReadonlySet<string>;
  pending: boolean;
  onToggle: (id: string) => void;
  onEditScene: (scene: TeacherMicrocourseScene) => void;
  onAddChild: () => void;
}) {
  const t = useTranslations("school.teacherMicrocourseBrowser");
  return <>
    <TableRow draggable={canManage} onDragStart={(event) => event.dataTransfer.setData("application/x-mathin-scenes", scene.id)} className={scene.status === "archived" ? "opacity-60" : undefined}>
      <TableCell>{canManage && <Checkbox checked={selectedIds.has(scene.id)} disabled={pending || scene.status === "archived"} onCheckedChange={() => onToggle(scene.id)} aria-label={t("selectScene", { name: scene.name })} />}</TableCell>
      <TableCell><div className="flex items-center gap-2"><GripVertical className="h-4 w-4 text-muted" /><span className="font-medium">{scene.name}</span>{scene.status === "archived" && <Badge variant="outline">{t("archived")}</Badge>}</div></TableCell>
      <TableCell className="max-w-72 truncate text-muted">{scene.description || "—"}</TableCell>
      <TableCell>{scene.courseCount}</TableCell>
      <TableCell><div className="flex justify-end gap-1">{canManage && <><Button size="sm" variant="ghost" disabled={pending || scene.status === "archived"} onClick={onAddChild}><Plus className="mr-1 h-4 w-4" />{t("childScene")}</Button><Button size="sm" variant="ghost" disabled={pending} onClick={() => onEditScene(scene)}>{scene.status === "archived" ? <RotateCcw className="mr-1 h-4 w-4" /> : null}{t("edit")}</Button></>}</div></TableCell>
    </TableRow>
    {childrenRows.map((child) => <TableRow key={child.id} className={child.status === "archived" ? "opacity-60" : undefined}><TableCell>{canManage && <Checkbox checked={selectedIds.has(child.id)} disabled={pending || child.status === "archived"} onCheckedChange={() => onToggle(child.id)} aria-label={t("selectScene", { name: child.name })} />}</TableCell><TableCell className="pl-12">↳ {child.name}</TableCell><TableCell className="max-w-72 truncate text-muted">{child.description || "—"}</TableCell><TableCell>{child.courseCount}</TableCell><TableCell className="text-right">{canManage && <Button size="sm" variant="ghost" onClick={() => onEditScene(child)}>{t("edit")}</Button>}</TableCell></TableRow>)}
  </>;
}
