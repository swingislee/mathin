"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useRouter } from "@/i18n/navigation";
import { DashboardCommandActions, DashboardCommandPanel, DashboardPage, DashboardTableShell } from "./dashboard-page";
import { MaterialSelect } from "./ClassMaterialFields";
import { saveCourseMaterialRuleAction } from "./actions/class-material";
import { materialErrorCode, materialRuleInputSchema, type MaterialOptions, type MaterialRule, type MaterialRuleInput } from "./class-material-contract";

export function CourseMaterialRulesWorkspace({ options }: { options: MaterialOptions }) {
  const t = useTranslations("school.classMaterial");
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MaterialRule | null>(null);
  const [input, setInput] = useState<MaterialRuleInput>({
    title: "", familyId: "", businessClassType: "", materialClassType: "",
    fromYear: null, fromSeason: null, toYear: null, toSeason: null, entryGrade: null, enabled: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const patch = (value: Partial<MaterialRuleInput>) => { setInput((current) => ({ ...current, ...value })); setError(""); };
  const edit = (rule: MaterialRule | null) => {
    setEditing(rule); setError("");
    setInput(rule ? {
      title: rule.title, familyId: rule.familyId, businessClassType: rule.businessClassType,
      materialClassType: rule.materialClassType, fromYear: rule.fromYear, fromSeason: rule.fromSeason,
      toYear: rule.toYear, toSeason: rule.toSeason, entryGrade: rule.entryGrade, enabled: rule.enabled,
    } : { title: "", familyId: options.families[0]?.id ?? "", businessClassType: "", materialClassType: "", fromYear: null, fromSeason: null, toYear: null, toSeason: null, entryGrade: null, enabled: true });
    setOpen(true);
  };
  const save = async () => {
    setBusy(true); setError("");
    try {
      const result = await saveCourseMaterialRuleAction(editing?.id ?? null, editing?.version ?? 0, input);
      if (!result.ok) {
        setError(t("errors." + materialErrorCode(result.code)));
        if (result.code === "MATERIAL_STALE") router.refresh();
        return;
      }
      setOpen(false); router.refresh();
    } catch { setError(t("errors.UNKNOWN")); } finally { setBusy(false); }
  };
  const range = (rule: MaterialRule) => {
    const start = rule.fromYear === null ? t("unbounded") : t("batchLabel", { year: rule.fromYear, season: rule.fromSeason ?? 1 });
    const end = rule.toYear === null ? t("unbounded") : t("batchLabel", { year: rule.toYear, season: rule.toSeason ?? 1 });
    return start + " — " + end;
  };
  return <DashboardPage title={t("rulesTitle")} backHref="/dashboard/courses" backLabel={t("backCourses")}
    commandPanel={<DashboardCommandPanel><DashboardCommandActions><Button size="sm" onClick={() => edit(null)}><Plus size={15} />{t("newRule")}</Button></DashboardCommandActions></DashboardCommandPanel>}>
    <div className="grid gap-5">
      <p className="text-sm text-muted">{t("rulesHelp")}</p>
      <DashboardTableShell><Table><TableHeader><TableRow>
        <TableHead>{t("ruleName")}</TableHead><TableHead>{t("mapping")}</TableHead><TableHead>{t("cohortRange")}</TableHead><TableHead>{t("version")}</TableHead><TableHead>{t("actions")}</TableHead>
      </TableRow></TableHeader><TableBody>
        {options.rules.filter((rule) => rule.isCurrent).map((rule) => <TableRow key={rule.id}>
          <TableCell><p className="font-medium">{rule.title}</p><p className="text-xs text-muted">{rule.familyTitle}</p></TableCell>
          <TableCell>{rule.businessClassType} → {rule.materialClassType}</TableCell>
          <TableCell><p>{range(rule)}</p><p className="text-xs text-muted">{rule.entryGrade === null ? t("allEntryGrades") : t("entryGradeLabel", { grade: rule.entryGrade })}</p></TableCell>
          <TableCell><p>v{rule.version} · {t(rule.enabled ? "enabled" : "disabled")}</p><p className="text-xs text-muted">{t("classroomCount", { count: rule.classroomCount })}</p></TableCell>
          <TableCell><Button variant="ghost" size="sm" onClick={() => edit(rule)}>{t("edit")}</Button></TableCell>
        </TableRow>)}
      </TableBody></Table></DashboardTableShell>
      {options.rules.length === 0 && <p className="text-sm text-muted">{t("noRules")}</p>}
    </div>
    <Dialog open={open} onOpenChange={(v) => { if (!busy) setOpen(v); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{t(editing ? "editRule" : "newRule")}</DialogTitle><DialogDescription>{t("versionHelp")}</DialogDescription></DialogHeader>
        <fieldset disabled={busy} className="grid gap-4">
          <div className="grid gap-1.5"><Label htmlFor={id + "-title"}>{t("ruleName")}</Label><Input id={id + "-title"} maxLength={100} value={input.title} onChange={(event) => patch({ title: event.target.value })} /></div>
          <MaterialSelect label={t("family")} value={input.familyId} disabled={busy} options={options.families.map((f) => ({ value: f.id, label: f.title }))} onChange={(v) => patch({ familyId: v, materialClassType: "" })} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5"><Label htmlFor={id + "-band"}>{t("businessClassType")}</Label><Input id={id + "-band"} maxLength={20} value={input.businessClassType} onChange={(event) => patch({ businessClassType: event.target.value.toUpperCase() })} /></div>
            <MaterialSelect label={t("materialClassType")} value={input.materialClassType} disabled={busy} options={(options.families.find((f) => f.id === input.familyId)?.materialTypes ?? []).map((v) => ({ value: v, label: v }))} onChange={(v) => patch({ materialClassType: v })} />
            {(["from", "to"] as const).map((bound) => <div key={bound} className="grid gap-2">
              <Label htmlFor={id + bound}>{t(bound === "from" ? "fromBatch" : "toBatch")}</Label>
              <Input id={id + bound} type="number" min={2000} max={2200} value={input[bound + "Year" as "fromYear" | "toYear"] ?? ""}
                onChange={(event) => patch({ [bound + "Year"]: event.target.value ? Number(event.target.value) : null })} />
              <MaterialSelect label={t("seasonLabel")} disabled={busy} value={String(input[bound + "Season" as "fromSeason" | "toSeason"] ?? "none")}
                options={[{ value: "none", label: t("unbounded") }, ...[1, 2, 3, 4].map((s) => ({ value: String(s), label: t("season", { season: s }) }))]}
                onChange={(v) => patch({ [bound + "Season"]: v === "none" ? null : Number(v) })} />
            </div>)}
            <div className="grid gap-1.5"><Label htmlFor={id + "-grade"}>{t("cohortGradeOptional")}</Label><Input id={id + "-grade"} type="number" min={1} max={12} value={input.entryGrade ?? ""} onChange={(event) => patch({ entryGrade: event.target.value ? Number(event.target.value) : null })} /></div>
          </div>
          <p className="text-sm text-muted">{t("rangeHelp")}</p>
          <div className="flex items-center gap-2"><Checkbox id={id + "-enabled"} checked={input.enabled} disabled={busy} onCheckedChange={(v) => patch({ enabled: v === true })} /><Label htmlFor={id + "-enabled"}>{t("enabled")}</Label></div>
        </fieldset>
        {error && <p role="alert" className="text-sm text-rose">{error}</p>}
        <DialogFooter><Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>{t("cancel")}</Button><Button disabled={busy || !materialRuleInputSchema.safeParse(input).success} onClick={() => void save()}>{t(busy ? "working" : "saveRule")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </DashboardPage>;
}
