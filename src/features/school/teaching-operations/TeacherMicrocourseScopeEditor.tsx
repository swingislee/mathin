"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction, type ActionErrorMessages } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRouter } from "@/i18n/navigation";
import { setTeacherMicrocourseCourseScopesAction } from "../actions/teacher-microcourse-scenes";
import type { TeacherMicrocourseConfiguration, TeacherMicrocourseCourseScope } from "./teacher-microcourse-scenes";

function initialSelection(courseIds: string[], scopes: TeacherMicrocourseCourseScope[], key: keyof Pick<TeacherMicrocourseCourseScope, "sceneIds" | "gradeIds" | "termIds" | "classSystemIds" | "classTypeIds">) {
  const selectedScopes = courseIds.map((id) => scopes.find((scope) => scope.courseId === id)).filter(Boolean) as TeacherMicrocourseCourseScope[];
  if (selectedScopes.length === 0) return new Set<string>();
  const first = selectedScopes[0][key];
  if (selectedScopes.every((scope) => scope[key].length === first.length && scope[key].every((id) => first.includes(id)))) return new Set(first);
  return new Set<string>();
}

export function TeacherMicrocourseScopeEditor({
  open,
  onOpenChange,
  courseFamilyId,
  courseIds,
  locale,
  configuration,
  scopes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseFamilyId: string;
  courseIds: string[];
  locale: string;
  configuration: TeacherMicrocourseConfiguration;
  scopes: TeacherMicrocourseCourseScope[];
}) {
  const t = useTranslations("school.teacherMicrocourseBrowser");
  const router = useRouter();
  const [sceneIds, setSceneIds] = useState(() => initialSelection(courseIds, scopes, "sceneIds"));
  const [gradeIds, setGradeIds] = useState(() => initialSelection(courseIds, scopes, "gradeIds"));
  const [termIds, setTermIds] = useState(() => initialSelection(courseIds, scopes, "termIds"));
  const [classSystemIds, setClassSystemIds] = useState(() => initialSelection(courseIds, scopes, "classSystemIds"));
  const [classTypeIds, setClassTypeIds] = useState(() => initialSelection(courseIds, scopes, "classTypeIds"));
  const errors: ActionErrorMessages = {
    INVALID_SCOPE_SELECTION: t("invalidScopeSelection"),
    INVALID_SCOPE_TARGET: t("invalidScopeTarget"),
    FORBIDDEN: t("forbidden"),
    default: t("actionFailed"),
  };
  const save = useAction(setTeacherMicrocourseCourseScopesAction, {
    successMessage: t("scopeSaved"),
    errorMessage: errors,
    onSuccess: () => {
      onOpenChange(false);
      router.refresh();
    },
  });
  const toggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) => setter((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const dimensionGroup = (title: string, hint: string, items: Array<{ id: string; nameZh: string; nameEn: string; active: boolean }>, selected: Set<string>, setter: React.Dispatch<React.SetStateAction<Set<string>>>) => <section className="space-y-3">
    <div><h3 className="text-sm font-medium text-ink">{title}</h3><p className="text-xs leading-5 text-muted">{hint}</p></div>
    <div className="grid gap-2 sm:grid-cols-2">
      {items.filter((item) => item.active).map((item) => <Label key={item.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-line px-3 py-2 text-sm"><Checkbox checked={selected.has(item.id)} disabled={save.pending} onCheckedChange={() => toggle(setter, item.id)} />{locale === "zh" ? item.nameZh : item.nameEn}</Label>)}
    </div>
  </section>;

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-3xl">
      <DialogHeader>
        <DialogTitle>{t("scopeEditorTitle", { count: courseIds.length })}</DialogTitle>
        <DialogDescription>{courseIds.length > 1 ? t("bulkScopeReplaces") : t("scopeEditorHint")}</DialogDescription>
      </DialogHeader>
      <Tabs defaultValue="scenes" className="min-h-80">
        <TabsList><TabsTrigger value="scenes">{t("sceneSettings")}</TabsTrigger><TabsTrigger value="academic">{t("academicSettings")}</TabsTrigger></TabsList>
        <TabsContent value="scenes" className="space-y-4 pt-3">
          <p className="text-xs leading-5 text-muted">{t("multiSceneHint")}</p>
          {configuration.roots.filter((root) => root.enabled).map((root) => {
            const framework = configuration.frameworkItems.find((item) => item.code === root.frameworkItemCode);
            return <section key={root.id} className="space-y-2"><h3 className="text-sm font-medium">{framework ? (locale === "zh" ? framework.labelZh : framework.labelEn) : root.frameworkItemCode}</h3><div className="grid gap-2 sm:grid-cols-2">{root.scenes.filter((scene) => scene.status === "active").map((scene) => <Label key={scene.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-line px-3 py-2 text-sm"><Checkbox checked={sceneIds.has(scene.id)} disabled={save.pending} onCheckedChange={() => toggle(setSceneIds, scene.id)} />{scene.parentId ? "↳ " : ""}{scene.name}</Label>)}</div></section>;
          })}
          {configuration.roots.every((root) => root.scenes.every((scene) => scene.status !== "active")) && <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted">{t("noScenes")}</p>}
        </TabsContent>
        <TabsContent value="academic" className="space-y-6 pt-3">
          {dimensionGroup(t("grades"), t("universalWhenEmpty"), configuration.grades, gradeIds, setGradeIds)}
          {dimensionGroup(t("terms"), t("universalWhenEmpty"), configuration.terms, termIds, setTermIds)}
          {dimensionGroup(t("classSystems"), t("systemScopeHint"), configuration.classSystems, classSystemIds, setClassSystemIds)}
          {dimensionGroup(t("classTypes"), t("leafScopeHint"), configuration.classSystems.flatMap((system) => system.classTypes), classTypeIds, setClassTypeIds)}
        </TabsContent>
      </Tabs>
      <DialogFooter>
        <Button variant="secondary" disabled={save.pending} onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
        <Button disabled={save.pending || courseIds.length === 0} onClick={() => save.run({ courseFamilyId, courseIds, sceneIds: [...sceneIds], gradeIds: [...gradeIds], termIds: [...termIds], classSystemIds: [...classSystemIds], classTypeIds: [...classTypeIds] })}><Save className="mr-2 h-4 w-4" />{t("saveScope")}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
