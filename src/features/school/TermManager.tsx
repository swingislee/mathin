"use client";

import { useState } from "react";
import { CalendarRange, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/components/action-form";
import { useRouter } from "@/i18n/navigation";
import { activateSchoolTermAction, createSchoolTermAction } from "./actions/courses";
import type { SchoolTermRow } from "./courses";

/** 运营学年学期只属于排课；课程季节不在此处读写。 */
export function TermManager({ terms }: { terms: SchoolTermRow[] }) {
  const t = useTranslations("school.schedule");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear());
  const [term, setTerm] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const createRun = useAction(createSchoolTermAction, { successMessage: t("termCreated"), errorMessage: { default: t("actionFailed") }, onSuccess: () => { setOpen(false); router.refresh(); } });
  const activateRun = useAction(activateSchoolTermAction, { successMessage: t("termActivated"), errorMessage: { default: t("actionFailed") }, onSuccess: () => router.refresh() });
  const pending = createRun.pending || activateRun.pending;

  return <Dialog open={open} onOpenChange={setOpen}>
    <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}><CalendarRange className="size-4" />{t("schoolTerms")}</Button>
    <DialogContent>
      <DialogHeader><DialogTitle>{t("schoolTerms")}</DialogTitle><DialogDescription>{t("schoolTermsHint")}</DialogDescription></DialogHeader>
      <div className="max-h-48 overflow-y-auto divide-y divide-line rounded-xl border border-line px-3">
        {terms.length === 0 ? <p className="py-3 text-sm text-muted">{t("schoolTermsEmpty")}</p> : terms.map((row) => <div key={row.id} className="flex flex-wrap items-center gap-2 py-2 text-sm"><span className="min-w-0 flex-1">{row.name} · {row.startsOn} — {row.endsOn}</span>{row.isCurrent ? <Badge variant="secondary">{t("currentSchoolTerm")}</Badge> : <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => activateRun.run(row.id)}>{t("activateSchoolTerm")}</Button>}</div>)}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Label className="grid gap-1 text-xs font-normal text-muted">{t("schoolYear")}<Input type="number" min={2020} max={2100} value={year} onChange={(event) => setYear(Number(event.target.value))} /></Label>
        <div className="grid gap-1 text-xs text-muted"><span>{t("semester")}</span><div className="flex gap-2"><Button type="button" size="sm" variant={term === 1 ? "primary" : "secondary"} onClick={() => setTerm(1)}>{t("semesterOne")}</Button><Button type="button" size="sm" variant={term === 2 ? "primary" : "secondary"} onClick={() => setTerm(2)}>{t("semesterTwo")}</Button></div></div>
        <Label className="grid gap-1 text-xs font-normal text-muted sm:col-span-2">{t("name")}<Input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} /></Label>
        <Label className="grid gap-1 text-xs font-normal text-muted">{t("startsOn")}<Input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></Label>
        <Label className="grid gap-1 text-xs font-normal text-muted">{t("endsOn")}<Input type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></Label>
      </div>
      <DialogFooter><Button type="button" variant="secondary" onClick={() => setOpen(false)}>{t("cancel")}</Button><Button type="button" disabled={pending || !name.trim() || !start || !end} onClick={() => createRun.run({ year, term, name, startsOn: start, endsOn: end })}>{pending && <LoaderCircle className="size-4 animate-spin" />}{t("create")}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
