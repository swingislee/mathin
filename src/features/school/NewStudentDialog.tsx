"use client";

import { LoaderCircle, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRouter } from "@/i18n/navigation";
import { createStudentAction } from "./actions";
import { inputClass, selectClass } from "./controls";

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
  };

  const submit = () => {
    if (!name.trim()) return;
    startTransition(async () => {
      try {
        await createStudentAction({
          name,
          grade: grade ? Number(grade) : null,
          phone,
          region,
          source,
          parentName,
          parentPhone,
          remark,
        });
        setOpen(false);
        reset();
        router.refresh();
      } catch {
        setError(t("createFailed"));
      }
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
            <label className="grid gap-1 text-xs text-muted">
              {studentsT("name")}
              <input
                value={name}
                onChange={(event) => { setName(event.target.value); setError(null); }}
                maxLength={100}
                required
                className={inputClass}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-xs text-muted">
                {t("phone")}
                <input value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={40} className={inputClass} />
              </label>
              <label className="grid gap-1 text-xs text-muted">
                {studentsT("gradeCol")}
                <select value={grade} onChange={(event) => setGrade(event.target.value)} className={selectClass}>
                  <option value="">{studentsT("allGrades")}</option>
                  {Array.from({ length: 9 }, (_, index) => index + 1).map((value) => (
                    <option key={value} value={value}>{studentsT("grade", { grade: value })}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-xs text-muted">
                {studentsT("region")}
                <input value={region} onChange={(event) => setRegion(event.target.value)} maxLength={100} className={inputClass} />
              </label>
              <label className="grid gap-1 text-xs text-muted">
                {t("source")}
                <input value={source} onChange={(event) => setSource(event.target.value)} maxLength={100} className={inputClass} />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-xs text-muted">
                {studentsT("parentName")}
                <input value={parentName} onChange={(event) => setParentName(event.target.value)} maxLength={100} className={inputClass} />
              </label>
              <label className="grid gap-1 text-xs text-muted">
                {studentsT("parentPhone")}
                <input value={parentPhone} onChange={(event) => setParentPhone(event.target.value)} maxLength={40} className={inputClass} />
              </label>
            </div>
            <label className="grid gap-1 text-xs text-muted">
              {studentsT("remark")}
              <textarea value={remark} onChange={(event) => setRemark(event.target.value)} rows={2} maxLength={500} className={`resize-y ${inputClass}`} />
            </label>
          </div>
          {error && <p role="alert" className="text-xs text-rose">{error}</p>}
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>{t("cancel")}</Button>
            <Button size="sm" className="gap-1.5" disabled={pending || !name.trim()} onClick={submit}>
              {pending && <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" />}
              {t("create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
