"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  adoptMaterialRule, compatibleMaterialRules, materialRuleCourses, type MaterialOptions, type MaterialSelection,
} from "./class-material-contract";

export function MaterialSelect({ label, value, options, onChange, disabled = false }: {
  label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void; disabled?: boolean;
}) {
  const id = useId();
  return <div className="grid min-w-0 gap-1.5">
    <Label htmlFor={id}>{label}</Label>
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id}><SelectValue placeholder={label} /></SelectTrigger>
      <SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
    </Select>
  </div>;
}

export function ClassMaterialFields({ options, courseId, value, onChange, onApplyRule, disabled = false }: {
  options: MaterialOptions; courseId: string; value: MaterialSelection;
  onChange: (value: MaterialSelection) => void;
  onApplyRule: (courseId: string, value: MaterialSelection) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("school.classMaterial");
  const id = useId();
  const course = options.courses.find((item) => item.id === courseId);
  const matches = course ? compatibleMaterialRules(options, course.familyId, value) : [];
  const selectedRule = options.rules.find((item) => item.revisionId === value.ruleRevisionId);
  const choices = matches.filter((rule) => course && materialRuleCourses(options, course, rule).length === 1);
  const patch = (next: Partial<MaterialSelection>) => onChange({
    ...value, ...next, ruleRevisionId: null, inheritedFromClassroomId: null,
  });
  const selectRule = (revisionId: string) => {
    if (revisionId === "manual") { patch({}); return; }
    const rule = matches.find((item) => item.revisionId === revisionId);
    const target = course && rule ? materialRuleCourses(options, course, rule)[0] : null;
    if (target && rule) onApplyRule(target.id, adoptMaterialRule(value, rule.revisionId));
  };
  return <fieldset disabled={disabled} className="grid gap-4">
    <legend className="mb-3 text-sm font-medium">{t("selectionTitle")}</legend>
    <p className="text-sm text-muted">{t("cohortHelp")}</p>
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-1.5"><Label htmlFor={id + "-band"}>{t("businessClassType")}</Label><Input id={id + "-band"} maxLength={20} value={value.businessClassType} onChange={(event) => patch({ businessClassType: event.target.value.toUpperCase() })} /></div>
      <div className="grid gap-1.5"><Label htmlFor={id + "-year"}>{t("cohortYear")}</Label><Input id={id + "-year"} type="number" min={2000} max={2200} value={value.cohortYear ?? ""} onChange={(event) => patch({ cohortYear: event.target.value ? Number(event.target.value) : null })} /></div>
      <MaterialSelect label={t("cohortSeason")} value={String(value.cohortSeason ?? "unknown")} disabled={disabled} onChange={(v) => patch({ cohortSeason: v === "unknown" ? null : Number(v) })}
        options={[{ value: "unknown", label: t("unknown") }, ...[1, 2, 3, 4].map((s) => ({ value: String(s), label: t("season", { season: s }) }))]} />
      <div className="grid gap-1.5"><Label htmlFor={id + "-grade"}>{t("cohortGrade")}</Label><Input id={id + "-grade"} type="number" min={1} max={12} value={value.cohortGrade ?? ""} onChange={(event) => patch({ cohortGrade: event.target.value ? Number(event.target.value) : null })} /></div>
    </div>
    <MaterialSelect label={t("rule")} disabled={disabled} value={value.ruleRevisionId ?? "manual"} onChange={selectRule}
      options={[{ value: "manual", label: t("manual") }, ...choices.map((rule) => ({ value: rule.revisionId, label: t("ruleOption", { title: rule.title, version: rule.version, material: rule.materialClassType }) })),
        ...(selectedRule && !choices.some((rule) => rule.revisionId === selectedRule.revisionId)
          ? [{ value: selectedRule.revisionId, label: t("savedRule", { title: selectedRule.title, version: selectedRule.version }) }] : [])]} />
    {choices.length === 0 && !selectedRule && <p className="text-sm text-muted">{t("noMatchingRule")}</p>}
    {value.inheritedFromClassroomId && <p className="text-sm text-muted">{t("inherited")}</p>}
  </fieldset>;
}
