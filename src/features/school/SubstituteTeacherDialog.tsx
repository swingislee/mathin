"use client";

import { useEffect, useState, useTransition } from "react";
import { LoaderCircle, UserRoundCog } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";
import { assignSessionSubstituteAction, listSubstituteTeachersAction } from "./actions";

interface SubstituteTeacherOption { id: string; name: string }

export function SubstituteTeacherDialog({ sessionId, currentTeacherId }: { sessionId: string; currentTeacherId: string | null }) {
  const t = useTranslations("school.classes");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [teachers, setTeachers] = useState<SubstituteTeacherOption[]>([]);
  const [selected, setSelected] = useState<string | null>(currentTeacherId);
  const [reason, setReason] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    let live = true;
    listSubstituteTeachersAction(sessionId).then((rows) => { if (live) setTeachers(rows); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [open, sessionId]);

  const save = () => startTransition(async () => {
    try {
      await assignSessionSubstituteAction(sessionId, selected, reason);
      setOpen(false);
      router.refresh();
    } catch { setFailed(true); }
  });

  return <>
    <Button type="button" size="sm" variant="ghost" onClick={() => { setSelected(currentTeacherId); setFailed(false); setOpen(true); }}>
      <UserRoundCog size={14} />{t("substitute")}
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("substituteTitle")}</DialogTitle><DialogDescription>{t("substituteDescription")}</DialogDescription></DialogHeader>
        <div className="grid max-h-64 gap-2 overflow-y-auto" role="radiogroup" aria-label={t("substituteTeacher")}>
          <Button type="button" variant={selected === null ? "primary" : "secondary"} onClick={() => setSelected(null)} role="radio" aria-checked={selected === null}>{t("inheritClassTeacher")}</Button>
          {teachers.map((teacher) => <Button key={teacher.id} type="button" variant={selected === teacher.id ? "primary" : "secondary"} onClick={() => setSelected(teacher.id)} role="radio" aria-checked={selected === teacher.id}>{teacher.name}</Button>)}
        </div>
        <Input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} placeholder={t("substituteReason")} />
        {failed && <p className="text-xs text-rose">{t("actionFailed")}</p>}
        <DialogFooter><Button type="button" variant="secondary" onClick={() => setOpen(false)}>{t("cancel")}</Button><Button type="button" disabled={pending} onClick={save}>{pending && <LoaderCircle size={14} className="animate-spin" />}{t("confirm")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
