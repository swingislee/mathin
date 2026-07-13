"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { LoaderCircle, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRouter } from "@/i18n/navigation";
import { createStudentAction, findDuplicateStudentsAction, type DuplicateStudentRow } from "./actions";
import { Link } from "@/i18n/navigation";
import { fromSelectValue, inputClass, toSelectValue } from "./controls";

/**
 * P4D-0 完整版新建学生弹窗：基础资料、地区/来源与家长联系方式一次写入 RPC。
 */
export function NewStudentDialog() {
  const t = useTranslations("school.followups");
  const studentsT = useTranslations("school.students");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [grade, setGrade] = useState("");
  const [source, setSource] = useState("");
  const [region, setRegion] = useState("");
  const [parentName, setParentName] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [remark, setRemark] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateStudentRow[]>([]);
  const [duplicateChecked, setDuplicateChecked] = useState(false);
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setName("");
    setPhone("");
    setGrade("");
    setSource("");
    setRegion("");
    setParentName("");
    setParentPhone("");
    setRemark("");
    setError(null);
    setDuplicates([]);
    setDuplicateChecked(false);
  };

  const submit = () => {
    if (!name.trim()) return;
    startTransition(async () => {
      setError(null);
      if (!duplicateChecked) {
        const found = await findDuplicateStudentsAction(name, phone);
        if (!found.ok) { setError(t("createFailed")); return; }
        setDuplicateChecked(true);
        setDuplicates(found.data);
        if (found.data.length > 0) return;
      }
      const result = await createStudentAction({
        name,
        grade: grade ? Number(grade) : null,
        phone,
        region,
        source,
        parentName,
        parentPhone,
        remark,
      });
      if (!result.ok) {
        setError(t("createFailed"));
        return;
      }
      toast.success(t("createSuccess"));
      setOpen(false);
      reset();
      router.refresh();
    });
  };

  return (
    <>
      <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <UserPlus size={15} />
        {t("newStudent")}
      </Button>
      <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setError(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("newStudent")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <Label className="grid gap-1 text-xs font-normal text-muted">
              {studentsT("name")}
              <Input
                value={name}
                onChange={(event) => { setName(event.target.value); setError(null); setDuplicateChecked(false); setDuplicates([]); }}
                maxLength={100}
                required
                className={inputClass}
              />
            </Label>
            <div className="grid grid-cols-2 gap-3">
              <Label className="grid gap-1 text-xs font-normal text-muted">
                {t("phone")}
                <Input value={phone} onChange={(event) => { setPhone(event.target.value); setDuplicateChecked(false); setDuplicates([]); }} maxLength={40} className={inputClass} />
              </Label>
              <Label className="grid gap-1 text-xs font-normal text-muted">
                {studentsT("gradeCol")}
                <Select value={toSelectValue(grade)} onValueChange={(value) => setGrade(fromSelectValue(value))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={toSelectValue("")}>{studentsT("allGrades")}</SelectItem>
                    {Array.from({ length: 9 }, (_, index) => index + 1).map((value) => (
                      <SelectItem key={value} value={String(value)}>{studentsT("grade", { grade: value })}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Label className="grid gap-1 text-xs font-normal text-muted">
                {studentsT("region")}
                <Input value={region} onChange={(event) => setRegion(event.target.value)} maxLength={100} className={inputClass} />
              </Label>
              <Label className="grid gap-1 text-xs font-normal text-muted">
                {t("source")}
                <Input value={source} onChange={(event) => setSource(event.target.value)} maxLength={100} className={inputClass} />
              </Label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Label className="grid gap-1 text-xs font-normal text-muted">
                {studentsT("parentName")}
                <Input value={parentName} onChange={(event) => setParentName(event.target.value)} maxLength={100} className={inputClass} />
              </Label>
              <Label className="grid gap-1 text-xs font-normal text-muted">
                {studentsT("parentPhone")}
                <Input value={parentPhone} onChange={(event) => setParentPhone(event.target.value)} maxLength={40} className={inputClass} />
              </Label>
            </div>
            <Label className="grid gap-1 text-xs font-normal text-muted">
              {studentsT("remark")}
              <textarea value={remark} onChange={(event) => setRemark(event.target.value)} rows={2} maxLength={500} className={`resize-y ${inputClass}`} />
            </Label>
          </div>
          {error && <p role="alert" className="text-xs text-rose">{error}</p>}
          {duplicates.length > 0 && <div role="alert" className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm"><p className="font-medium">{t("duplicatesFound")}</p><ul className="mt-2 grid gap-1">{duplicates.map(row=><li key={row.id}><Link href={`/dashboard/students/${row.id}`} className="underline underline-offset-2">{row.name} · {row.phone || studentsT("none")} · {studentsT(row.status)}</Link></li>)}</ul><p className="mt-2 text-xs text-muted">{t("duplicateProceedHint")}</p></div>}
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>{t("cancel")}</Button>
            <Button size="sm" className="gap-1.5" disabled={pending || !name.trim()} onClick={submit}>
              {pending && <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" />}
              {duplicates.length > 0 ? t("createAnyway") : t("create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
