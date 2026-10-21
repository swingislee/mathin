"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useRouter } from "@/i18n/navigation";
import { getReviewDrawerData, saveSessionReviewsAction, type ReviewRecord } from "./review-actions";
import { publishSessionReviewsAction } from "./learning-result-actions";
import type { LearningResultStatus } from "./learning-results";

export function ReviewDrawer({ sessionId, openInitially = false, onClose, showPublish = false, resultStatus, onSaved, onPublishingChange }: {
  sessionId: string; openInitially?: boolean; onClose?: () => void; showPublish?: boolean;
  resultStatus?: LearningResultStatus; onSaved?: (rows: ReviewRecord[]) => void;
  onPublishingChange?: (value: boolean) => void;
}) {
  const t = useTranslations("school.reviews");
  const en = useLocale().startsWith("en");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ReviewRecord[]>([]);
  const [initial, setInitial] = useState<ReviewRecord[]>([]);
  const [savedStudentIds, setSavedStudentIds] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [published, setPublished] = useState(false);
  const busy = useRef(false);
  const openedInitially = useRef(false);
  const dirty = JSON.stringify(rows) !== JSON.stringify(initial);

  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true; setOpen(true); setPending(true); setError(""); setMessage(""); setLoaded(false);
    try {
      const data = await getReviewDrawerData(sessionId);
      setRows(data.records); setInitial(data.records); setSavedStudentIds(data.savedStudentIds); setLoaded(true);
    } catch { setError(t("failed")); }
    finally { busy.current = false; setPending(false); }
  }, [sessionId, t]);
  useEffect(() => {
    if (openInitially && !openedInitially.current) { openedInitially.current = true; void load(); }
  }, [openInitially, load]);
  const close = () => { setOpen(false); onClose?.(); };
  const update = <K extends keyof ReviewRecord>(id: string, key: K, value: ReviewRecord[K]) => {
    setRows(current => current.map(row => row.studentId === id ? { ...row, [key]: value } : row));
    setPublished(false); setMessage("");
  };

  async function save() {
    if (!loaded || !dirty || busy.current) return;
    busy.current = true; setPending(true); setError(""); setMessage("");
    const changed = rows.filter(row => JSON.stringify(initial.find(old => old.studentId === row.studentId)) !== JSON.stringify(row));
    try {
      const result = await saveSessionReviewsAction(sessionId, changed);
      if (!result.ok) { setError(t("failed")); return; }
      setInitial(rows); setSavedStudentIds(current => [...new Set([...current, ...changed.map(row => row.studentId)])]);
      setMessage(t("saved")); onSaved?.(rows); router.refresh();
      if (!showPublish) close();
    } catch { setError(t("failed")); }
    finally { busy.current = false; setPending(false); }
  }
  async function publish() {
    if (!loaded || dirty || !savedStudentIds.length || busy.current) return;
    busy.current = true; setPending(true); setError(""); setMessage(""); onPublishingChange?.(true);
    try {
      const result = await publishSessionReviewsAction(sessionId);
      if (!result.ok) { setError(t("failed")); return; }
      setPublished(true); setMessage(en ? "Saved reviews published." : "已保存的课评已发布。");
      onSaved?.(rows); router.refresh();
    } catch { setError(t("failed")); }
    finally { busy.current = false; setPending(false); onPublishingChange?.(false); }
  }
  const republish = ["published", "revised", "withdrawn"].includes(resultStatus ?? "draft");
  const recipients = rows.filter(row => savedStudentIds.includes(row.studentId));
  return <>
    {!openInitially && <Button size="sm" variant="secondary" disabled={pending} onClick={() => void load()}>{t("button")}</Button>}
    <Dialog open={open} onOpenChange={value => { if (!pending && !dirty) { if (value) setOpen(true); else close(); } }}>
      <DialogContent className="max-h-[90dvh] sm:max-w-5xl">
        <DialogHeader><DialogTitle>{en ? "Lesson reviews" : "课评"}</DialogTitle></DialogHeader>
        <p className="text-xs text-muted">{en ? "Write feedback for the students you observed. Save drafts here, then publish the saved reviews when ready." : "按实际观察填写对应学生的课评；先保存草稿，再发布已保存的课评。"}</p>
        {error && <p role="alert" className="text-xs text-rose">{error}</p>}
        {message && <p role="status" className="text-xs text-muted">{message}</p>}
        {!loaded && (pending ? <p role="status" className="text-sm text-muted">{en ? "Loading reviews…" : "正在读取课评…"}</p>
          : <Button variant="secondary" onClick={() => void load()}>{en ? "Retry" : "重试"}</Button>)}
        {loaded && <fieldset disabled={pending} className="min-w-0 divide-y divide-line border-y border-line">
          {rows.map(row => <div key={row.studentId} className="grid gap-3 py-3 sm:grid-cols-[8rem_1fr]">
            <div><p className="text-sm font-medium">{row.studentName}</p><p className="mt-1 text-xs text-muted">{savedStudentIds.includes(row.studentId) ? (en ? "Saved draft" : "已保存") : (en ? "Not recorded" : "尚未填写")}</p></div>
            <div className="min-w-0 space-y-3">
              <Label className="grid gap-1 text-xs">{t("comment")}<Textarea value={row.comment} maxLength={2000} rows={2}
                onChange={event => update(row.studentId, "comment", event.target.value)} /></Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{(["entryScore", "exitScore", "focus", "participation", "mastery"] as const).map(field => <Label key={field} className="grid gap-1 text-xs text-muted">
                {t(field === "entryScore" ? "entry" : field === "exitScore" ? "exit" : field)}
                <Input type="number" min={field.endsWith("Score") ? 0 : 1} max={field.endsWith("Score") ? 100 : 5}
                  step={field.endsWith("Score") ? 0.5 : 1} value={row[field] ?? ""}
                  onChange={event => update(row.studentId, field, event.target.value === "" ? null : Number(event.target.value))} />
              </Label>)}</div>
            </div>
          </div>)}
        </fieldset>}
        {showPublish && loaded && <div className="space-y-1 text-xs text-muted">
          <p>{en ? "Publication includes the saved reviews for:" : "发布范围：本课已保存课评的学生"}</p>
          <p>{recipients.length ? recipients.map(row => row.studentName).join("、") : (en ? "No saved reviews yet." : "暂无已保存课评。")}</p>
          {dirty && <p>{en ? "Save your changes before publishing." : "有未保存修改，保存后即可发布。"}</p>}
        </div>}
        <DialogFooter>
          <Button size="sm" variant="ghost" disabled={pending} onClick={close}>{dirty ? (en ? "Discard changes and close" : "放弃修改并关闭") : (en ? "Close" : "关闭")}</Button>
          <Button size="sm" variant={showPublish ? "secondary" : "primary"} disabled={!loaded || !dirty || pending} onClick={() => void save()}>{t("save")}</Button>
          {showPublish && <Button size="sm" disabled={!loaded || dirty || !recipients.length || pending || published} onClick={() => void publish()}>
            {published ? (en ? "Published" : "已发布") : en ? (republish ? "Publish updates" : "Publish saved reviews") : republish ? "发布课评更新" : "发布已保存课评"}
          </Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
