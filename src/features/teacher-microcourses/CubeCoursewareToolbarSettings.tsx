"use client";

import { useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cubeStructuresMessages } from "@/features/tools/spatial-lab/cube-structures-messages";
import { CUBE_TOOLBAR_GROUPS, CUBE_TOOLBAR_IDS, CUBE_TOOLBAR_LABELS, type CubeToolbarId } from "@/features/tools/spatial-lab/cube-structures-toolbar";
import { configureCubeCoursewareToolbar, type CubeCoursewareTool } from "@/features/tools/courseware/cube-structures-content";

export function CubeCoursewareToolbarSelection({ value, onChange }: {
  value: readonly CubeToolbarId[]; onChange: (value: CubeToolbarId[]) => void;
}) {
  const t = useTranslations("teacherMicrocourses");
  const m = cubeStructuresMessages(useLocale() === "en" ? "en" : "zh");
  const id = useId();
  return <div className="space-y-3" data-cube-toolbar-selection>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm font-medium">{t("cubeToolbarCount", { count: value.length, total: CUBE_TOOLBAR_IDS.length })}</p>
      <div className="flex gap-1"><Button type="button" size="sm" variant="ghost" onClick={() => onChange([...CUBE_TOOLBAR_IDS])}>{t("cubeToolbarAll")}</Button><Button type="button" size="sm" variant="ghost" onClick={() => onChange([])}>{t("cubeToolbarNone")}</Button></div>
    </div>
    {CUBE_TOOLBAR_GROUPS.map((group) => <fieldset key={group.id} className="space-y-2 rounded-xl border border-line p-3">
      <legend className="px-1 text-xs text-muted">{t(`cubeToolbarGroups.${group.id}`)}</legend>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{group.tools.map((tool) => <div key={tool} className="flex items-center gap-2">
        <Checkbox id={`${id}-${tool}`} checked={value.includes(tool)} onCheckedChange={(checked) => onChange(CUBE_TOOLBAR_IDS.filter((entry) => entry === tool ? checked === true : value.includes(entry)))} />
        <Label htmlFor={`${id}-${tool}`} className="cursor-pointer text-xs leading-5">{tool === "reset" ? t("cubeToolbarReset") : m[CUBE_TOOLBAR_LABELS[tool]]}</Label>
      </div>)}</div>
    </fieldset>)}
    <p className="text-xs leading-5 text-muted">{t("cubeToolbarHint")}</p>
  </div>;
}

export function CubeCoursewareToolbarSettings({ tool, onChange }: { tool: CubeCoursewareTool; onChange: (tool: CubeCoursewareTool) => void }) {
  const t = useTranslations("teacherMicrocourses");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const [value, setValue] = useState<readonly CubeToolbarId[]>([]);
  const current = "toolbar" in tool.payload ? tool.payload.toolbar : CUBE_TOOLBAR_IDS;
  return <Dialog open={open} onOpenChange={(next) => { if (next) { setValue(current); setError(false); } setOpen(next); }}>
    <DialogTrigger asChild><Button type="button" size="sm" variant="secondary">{t("cubeToolbarConfigure")}</Button></DialogTrigger>
    <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
      <DialogHeader><DialogTitle>{t("cubeToolbarConfigure")}</DialogTitle><DialogDescription>{t("cubeToolbarSavedHint")}</DialogDescription></DialogHeader>
      <CubeCoursewareToolbarSelection value={value} onChange={setValue} />
      {error && <p role="alert" className="text-sm text-rose">{t("cubeContentTooLarge")}</p>}
      <DialogFooter><Button type="button" variant="secondary" onClick={() => setOpen(false)}>{t("cancel")}</Button><Button type="button" onClick={() => { try { onChange(configureCubeCoursewareToolbar(tool, value)); setOpen(false); } catch { setError(true); } }}>{t("cubeToolbarApply")}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
