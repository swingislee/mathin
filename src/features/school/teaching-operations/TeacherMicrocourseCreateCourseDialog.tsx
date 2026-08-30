"use client";

import { useState } from "react";
import { BookPlus, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction, type ActionErrorMessages } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "@/i18n/navigation";
import { createTeacherMicrocourseCatalogCourseAction } from "../actions/teacher-microcourse-maintenance";
import type { TeacherMicrocourseConfiguration } from "./teacher-microcourse-scenes";

export function TeacherMicrocourseCreateCourseDialog({
  courseFamilyId,
  locale,
  configuration,
  defaultSceneId,
}: {
  courseFamilyId: string;
  locale: string;
  configuration: TeacherMicrocourseConfiguration;
  defaultSceneId?: string;
}) {
  const t = useTranslations("school.teacherMicrocourseBrowser");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sceneIds, setSceneIds] = useState(() => new Set(defaultSceneId ? [defaultSceneId] : []));
  const [gradeIds, setGradeIds] = useState<Set<string>>(() => new Set());
  const [termIds, setTermIds] = useState<Set<string>>(() => new Set());
  const [classSystemIds, setClassSystemIds] = useState<Set<string>>(() => new Set());
  const [classTypeIds, setClassTypeIds] = useState<Set<string>>(() => new Set());
  const errors: ActionErrorMessages = {
    INVALID_COURSE_NAME: t("invalidCourseName"),
    INVALID_SCENE_SCOPE: t("invalidScopeSelection"),
    INVALID_GRADE_SCOPE: t("invalidScopeSelection"),
    INVALID_TERM_SCOPE: t("invalidScopeSelection"),
    INVALID_CLASS_SYSTEM_SCOPE: t("invalidScopeSelection"),
    INVALID_CLASS_TYPE_SCOPE: t("invalidScopeSelection"),
    FORBIDDEN: t("forbidden"),
    default: t("actionFailed"),
  };
  const create = useAction(createTeacherMicrocourseCatalogCourseAction, {
    successMessage: t("courseReady"),
    errorMessage: errors,
    onSuccess: (result) => {
      setOpen(false);
      router.push(`/dashboard/courses/${courseFamilyId}/microcourses/${result.courseId}`);
    },
  });
  const toggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) => setter((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const dimensions = (items: Array<{ id: string; nameZh: string; nameEn: string; active: boolean }>, selected: Set<string>, setter: React.Dispatch<React.SetStateAction<Set<string>>>) => <div className="grid gap-2 @2xl/create-course:grid-cols-2">
    {items.filter((item) => item.active).map((item) => <Label key={item.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-line px-3 py-2 text-sm"><Checkbox checked={selected.has(item.id)} disabled={create.pending} onCheckedChange={() => toggle(setter, item.id)} />{locale === "zh" ? item.nameZh : item.nameEn}</Label>)}
  </div>;

  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button size="sm"><BookPlus className="h-4 w-4" />{t("createCourse")}</Button></DialogTrigger>
    <DialogContent className="@container/create-course max-h-[92dvh] max-w-3xl overflow-y-auto">
      <DialogHeader><DialogTitle>{t("createCourse")}</DialogTitle><DialogDescription>{t("createCourseHint")}</DialogDescription></DialogHeader>
      <Tabs defaultValue="identity">
        <TabsList><TabsTrigger value="identity">{t("courseIdentity")}</TabsTrigger><TabsTrigger value="scope">{t("applicability")}</TabsTrigger></TabsList>
        <TabsContent value="identity" className="space-y-4 pt-4">
          <div><Label htmlFor="new-microcourse-title">{t("courseName")}</Label><Input id="new-microcourse-title" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} /></div>
          <div><Label htmlFor="new-microcourse-description">{t("shortDescription")}</Label><Textarea id="new-microcourse-description" value={description} maxLength={1000} onChange={(event) => setDescription(event.target.value)} /></div>
          <p className="rounded-lg bg-moon/15 p-3 text-xs leading-5 text-muted">{t("duplicateCourseHint")}</p>
          <p className="text-xs leading-5 text-muted">{t("noPresetLecturesHint")}</p>
        </TabsContent>
        <TabsContent value="scope" className="space-y-6 pt-4">
          <section className="space-y-3"><div><h3 className="text-sm font-medium">{t("sceneSettings")}</h3><p className="text-xs text-muted">{t("multiSceneHint")}</p></div>{configuration.roots.filter((root) => root.enabled).map((root) => <div key={root.id} className="space-y-2"><p className="text-xs font-medium text-muted">{configuration.frameworkItems.find((item) => item.code === root.frameworkItemCode)?.[locale === "zh" ? "labelZh" : "labelEn"] ?? root.frameworkItemCode}</p>{dimensions(root.scenes.map((scene) => ({ id: scene.id, nameZh: scene.parentId ? `↳ ${scene.name}` : scene.name, nameEn: scene.parentId ? `↳ ${scene.name}` : scene.name, active: scene.status === "active" })), sceneIds, setSceneIds)}</div>)}</section>
          <section className="space-y-3"><div><h3 className="text-sm font-medium">{t("grades")}</h3><p className="text-xs text-muted">{t("universalWhenEmpty")}</p></div>{dimensions(configuration.grades, gradeIds, setGradeIds)}</section>
          <section className="space-y-3"><div><h3 className="text-sm font-medium">{t("terms")}</h3><p className="text-xs text-muted">{t("universalWhenEmpty")}</p></div>{dimensions(configuration.terms, termIds, setTermIds)}</section>
          <section className="space-y-3"><div><h3 className="text-sm font-medium">{t("classSystems")}</h3><p className="text-xs text-muted">{t("systemScopeHint")}</p></div>{dimensions(configuration.classSystems, classSystemIds, setClassSystemIds)}</section>
          <section className="space-y-3"><div><h3 className="text-sm font-medium">{t("classTypes")}</h3><p className="text-xs text-muted">{t("leafScopeHint")}</p></div>{dimensions(configuration.classSystems.flatMap((system) => system.classTypes), classTypeIds, setClassTypeIds)}</section>
        </TabsContent>
      </Tabs>
      <DialogFooter><Button variant="secondary" disabled={create.pending} onClick={() => setOpen(false)}>{t("cancel")}</Button><Button disabled={create.pending || !title.trim()} onClick={() => create.run({ courseFamilyId, title, description, sceneIds: [...sceneIds], gradeIds: [...gradeIds], termIds: [...termIds], classSystemIds: [...classSystemIds], classTypeIds: [...classTypeIds] })}><Save className="h-4 w-4" />{t("createAndOpen")}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
