"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { LoaderCircle, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAction } from "@/components/action-form";
import { useRouter } from "@/i18n/navigation";
import { updateStudentAction, type UpdateStudentInput } from "./actions";
import { fromSelectValue, inputClass, toSelectValue } from "./controls";
import type { StudentDetail } from "./students";

const SOURCE_OPTIONS = ["地推", "转介绍", "自然引流", "活动", "其他"];

export function StudentProfileEditor({ student, canEdit }: { student: StudentDetail; canEdit: boolean }) {
  const t = useTranslations("school.students");
  const router = useRouter();
  const [form, setForm] = useState<UpdateStudentInput>({
    name: student.name,
    gender: student.gender,
    birthday: student.birthday,
    phone: student.phone,
    wechat: student.wechat,
    school: student.school,
    grade: student.grade,
    region: student.region,
    source: student.source,
    parentName: student.parentName,
    parentRelation: student.parentRelation,
    parentPhone: student.parentPhone,
    remark: student.remark,
  });

  const set = <K extends keyof UpdateStudentInput>(key: K, value: UpdateStudentInput[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const { run: save, pending } = useAction((input: UpdateStudentInput) => updateStudentAction(student.id, input), {
    successMessage: t("saved"),
    errorMessage: { default: t("saveFailed") },
    onSuccess: () => router.refresh(),
  });

  const disabled = !canEdit || pending || Boolean(student.deletedAt);
  const fieldClass = `${inputClass} disabled:cursor-default disabled:opacity-80`;

  return (
    <section className="rounded-xl border border-line bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-medium">{t("profile")}</h2>
        {canEdit && !student.deletedAt && (
          <Button type="button" size="sm" disabled={pending || !form.name.trim()} onClick={() => save(form)} className="gap-1.5">
            {pending ? <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" /> : <Save size={15} />}
            {t("save")}
          </Button>
        )}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label={t("name")}><Input disabled={disabled} value={form.name} maxLength={100} onChange={(e) => set("name", e.target.value)} className={fieldClass} /></Field>
        <Field label={t("gender")}><Input disabled={disabled} value={form.gender} maxLength={30} onChange={(e) => set("gender", e.target.value)} className={fieldClass} /></Field>
        <Field label={t("birthday")}><Input disabled={disabled} type="date" value={form.birthday ?? ""} onChange={(e) => set("birthday", e.target.value || null)} className={fieldClass} /></Field>
        <Field label={t("gradeCol")}>
          <Select disabled={disabled} value={toSelectValue(String(form.grade ?? ""))} onValueChange={(value) => { const raw = fromSelectValue(value); set("grade", raw ? Number(raw) : null); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={toSelectValue("")}>{t("none")}</SelectItem>
              {Array.from({ length: 12 }, (_, index) => index + 1).map((grade) => <SelectItem key={grade} value={String(grade)}>{t("grade", { grade })}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t("phone")}><Input disabled={disabled} value={form.phone} maxLength={40} onChange={(e) => set("phone", e.target.value)} className={fieldClass} /></Field>
        <Field label={t("wechat")}><Input disabled={disabled} value={form.wechat} maxLength={80} onChange={(e) => set("wechat", e.target.value)} className={fieldClass} /></Field>
        <Field label={t("schoolName")}><Input disabled={disabled} value={form.school} maxLength={100} onChange={(e) => set("school", e.target.value)} className={fieldClass} /></Field>
        <Field label={t("region")}><Input disabled={disabled} list="student-region-options" value={form.region} maxLength={100} onChange={(e) => set("region", e.target.value)} className={fieldClass} /></Field>
        <Field label={t("source")}><Input disabled={disabled} list="student-source-options" value={form.source} maxLength={100} onChange={(e) => set("source", e.target.value)} className={fieldClass} /></Field>
        <Field label={t("parentName")}><Input disabled={disabled} value={form.parentName} maxLength={100} onChange={(e) => set("parentName", e.target.value)} className={fieldClass} /></Field>
        <Field label={t("parentRelation")}><Input disabled={disabled} value={form.parentRelation} maxLength={40} onChange={(e) => set("parentRelation", e.target.value)} className={fieldClass} /></Field>
        <Field label={t("parentPhone")}><Input disabled={disabled} value={form.parentPhone} maxLength={40} onChange={(e) => set("parentPhone", e.target.value)} className={fieldClass} /></Field>
      </div>
      <Label className="mt-3 grid gap-1 text-xs font-normal text-muted">
        {t("remark")}
        <textarea disabled={disabled} rows={3} value={form.remark} maxLength={2000} onChange={(e) => set("remark", e.target.value)} className={`${fieldClass} resize-y`} />
      </Label>
      <datalist id="student-source-options">{SOURCE_OPTIONS.map((value) => <option key={value} value={value} />)}</datalist>
      <datalist id="student-region-options"><option value="主校区" /><option value="东区" /><option value="西区" /></datalist>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <Label className="grid gap-1 text-xs font-normal text-muted">{label}{children}</Label>;
}
