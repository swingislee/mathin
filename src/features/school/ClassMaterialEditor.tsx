"use client";

import { useId, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { BookOpen, LoaderCircle } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Link, useRouter } from "@/i18n/navigation";
import { applyClassroomMaterialChangeAction, getClassroomMaterialWorkspaceAction, previewClassroomMaterialChangeAction } from "./actions/class-material";
import { ClassMaterialFields, MaterialSelect } from "./ClassMaterialFields";
import { emptyMaterialSelection, materialErrorCode, materialSelectionSchema, type MaterialPreview, type MaterialSelection, type MaterialWorkspace } from "./class-material-contract";

export function ClassMaterialEditor({ classroomId }: { classroomId: string }) {
  const t = useTranslations("school.classMaterial");
  const format = useFormatter();
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [workspace, setWorkspace] = useState<MaterialWorkspace | null>(null);
  const [selection, setSelection] = useState<MaterialSelection>(emptyMaterialSelection);
  const [courseId, setCourseId] = useState("");
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<MaterialPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const load = async () => {
    setBusy(true); setError("");
    try {
      const result = await getClassroomMaterialWorkspaceAction(classroomId);
      if (!result.ok) { setError(t("errors." + materialErrorCode(result.code))); return; }
      setWorkspace(result.data); setSelection(result.data.selection ?? emptyMaterialSelection);
      setCourseId(result.data.courseId ?? ""); setPreview(null); setIncludeDrafts(false);
    } catch { setError(t("errors.UNKNOWN")); } finally { setBusy(false); }
  };
  const change = (next: MaterialSelection) => { setSelection(next); setPreview(null); setSaved(false); setError(""); };
  const handlePreview = async () => {
    setBusy(true); setError(""); setSaved(false);
    try {
      const result = await previewClassroomMaterialChangeAction({ classroomId, courseId, selection, includeDrafts });
      if (result.ok) setPreview(result.data);
      else { setPreview(null); setError(t("errors." + materialErrorCode(result.code))); }
    } catch { setError(t("errors.UNKNOWN")); } finally { setBusy(false); }
  };
  const save = async () => {
    if (!preview) return;
    setBusy(true); setError("");
    try {
      const result = await applyClassroomMaterialChangeAction({ classroomId, courseId, selection, includeDrafts, expectedToken: preview.token, reason });
      if (!result.ok) { setPreview(null); setError(t("errors." + materialErrorCode(result.code))); return; }
      await load(); setReason(""); setSaved(true); router.refresh();
    } catch { setError(t("errors.UNKNOWN")); } finally { setBusy(false); }
  };
  return <>
    <Button type="button" variant="secondary" size="sm" onClick={() => { setOpen(true); setSaved(false); void load(); }}><BookOpen size={15} />{t("title")}</Button>
    <Dialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>{t("title")}</DialogTitle><DialogDescription>{t("editorHelp")}</DialogDescription></DialogHeader>
        {busy && <p role="status" className="flex items-center gap-2 text-sm text-muted"><LoaderCircle size={16} className="animate-spin" />{t("working")}</p>}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        {saved && <p role="status" className="text-sm text-success">{t("saved")}</p>}
        {workspace && <div className="grid gap-6">
          <p className="text-sm">{t("currentCourse", { title: workspace.courseTitle ?? t("unknown") })}</p>
          {workspace.editable ? <>
            <ClassMaterialFields options={workspace.options} courseId={courseId} value={selection} onChange={change} disabled={busy}
              onApplyRule={(nextCourse, nextSelection) => { setCourseId(nextCourse); change(nextSelection); }} />
            <MaterialSelect label={t("actualCourse")} value={courseId} disabled={busy} onChange={(next) => { setCourseId(next); change({ ...selection, ruleRevisionId: null, inheritedFromClassroomId: null }); }}
              options={workspace.options.courses.filter((course) => course.grade === workspace.grade && course.season === workspace.season)
                .map((course) => ({ value: course.id, label: t("courseOption", { title: course.title, version: course.catalogVersionTitle, material: course.classType }) }))} />
            <div className="grid gap-2">
              <div className="flex items-start gap-2"><Checkbox id={id + "-drafts"} checked={includeDrafts} disabled={busy} onCheckedChange={(v) => { setIncludeDrafts(v === true); setPreview(null); }} /><Label htmlFor={id + "-drafts"}>{t("includeDrafts")}</Label></div>
              <p className="text-sm text-muted">{t("draftHelp")}</p>
            </div>
            <Button type="button" variant="secondary" className="justify-self-start" disabled={busy || !courseId || !materialSelectionSchema.safeParse(selection).success} onClick={() => void handlePreview()}>{t("preview")}</Button>
            {preview && <section className="grid gap-4 border-t border-line pt-4" aria-label={t("preview")}>
              <p className="text-sm font-medium">{t("impact", { change: preview.changeCount, preserve: preview.preserveCount, missing: preview.missingCount })}</p>
              {preview.draftChangeCount > 0 && <p className="text-sm text-warning">{t("draftImpact", { count: preview.draftChangeCount })}</p>}
              <div className="max-h-72 overflow-auto"><Table>
                <TableHeader className="sticky top-0 bg-card"><TableRow><TableHead>{t("lecture")}</TableHead><TableHead>{t("result")}</TableHead></TableRow></TableHeader>
                <TableBody>{preview.sessions.map((session) => <TableRow key={session.id}><TableCell>{session.no}. {session.title}</TableCell><TableCell>{t("status." + session.status)}</TableCell></TableRow>)}</TableBody>
              </Table></div>
              <div className="grid gap-1.5"><Label htmlFor={id + "-reason"}>{t("reason")}</Label><Textarea id={id + "-reason"} value={reason} maxLength={500} disabled={busy} onChange={(event) => setReason(event.target.value)} /></div>
              <Button type="button" className="justify-self-start" disabled={busy || !reason.trim() || preview.missingCount > 0} onClick={() => void save()}>{t("confirm")}</Button>
            </section>}
          </> : <p className="text-sm text-muted">{t("unavailable")}</p>}
          {workspace.selection && <Link href={"/dashboard/classes/new?inheritMaterialFrom=" + classroomId} className={buttonVariants({ variant: "secondary", size: "sm", className: "justify-self-start" })}>{t("inheritNew")}</Link>}
          <section className="grid gap-3 border-t border-line pt-4">
            <h3 className="text-sm font-medium">{t("history")}</h3>
            {workspace.history.length === 0 && <p className="text-sm text-muted">{t("noHistory")}</p>}
            {workspace.history.map((item) => <div key={item.id} className="grid gap-1 border-b border-line pb-3 text-sm">
              <p>{item.before.courseTitle ?? "—"} → {item.after.courseTitle ?? "—"}</p>
              <p className="text-muted">{format.dateTime(new Date(item.createdAt), { dateStyle: "medium", timeStyle: "short" })} · {t("historyCounts", { change: item.changedSessions, preserve: item.preservedSessions })}</p>
              <p>{item.reason === "initial_material_selection" ? t("initialSelection") : item.reason}</p>
              {item.after.selection && <p className="text-muted">{t("businessClassType")}: {item.after.selection.businessClassType} · {t("materialClassType")}: {item.after.materialClassType}</p>}
            </div>)}
          </section>
        </div>}
      </DialogContent>
    </Dialog>
  </>;
}
