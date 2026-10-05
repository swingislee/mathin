"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { compressHomeworkImage } from "@/lib/media/compress-image";
import { createClient } from "@/lib/supabase/client";
import { newId } from "@/lib/uuid";
import { dateTimeInputToInstant, zonedDateTimeInputValue } from "./schedule";
import { materialMessages, type MaterialFile } from "./session-materials-contract";
import { supplementSessionMaterialAction } from "./session-material-supplement-actions";
import { MATERIAL_SUPPLEMENT_KINDS, MATERIAL_SUPPLEMENT_MAX_BYTES, materialSupplementMessages, materialSupplementSchema, type MaterialSupplementKind } from "./session-material-supplement-contract";

type UploadFile = { id: string; file: File; uploaded?: Omit<MaterialFile, "url"> };
type Draft = { files: UploadFile[]; notes: string; videoUrl: string; completedAt: string; completionEdited: boolean };
const emptyDraft = (timeZone: string): Draft => ({ files: [], notes: "", videoUrl: "", completedAt: zonedDateTimeInputValue(new Date(), timeZone), completionEdited: false });
function extension(file: File) {
  if (file.type === "image/jpeg") return "jpg";
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase() || "bin";
}

export function SessionMaterialSupplement({ sessionId, locale, timeZone, onSaved, onClose, onDirtyChange }: {
  sessionId: string; locale: string; timeZone: string; onSaved: () => void; onClose: () => void; onDirtyChange?: (dirty: boolean) => void;
}) {
  const m = materialSupplementMessages(locale), labels = materialMessages(locale);
  const [kind, setKind] = useState<MaterialSupplementKind>("solution");
  const [drafts, setDrafts] = useState<Record<MaterialSupplementKind, Draft>>(() => ({ solution: emptyDraft(timeZone), lesson_plan: emptyDraft(timeZone), rehearsal_video: emptyDraft(timeZone) }));
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const draft = drafts[kind];
  const dirty = Object.values(drafts).some(value => value.files.length || value.notes.trim() || value.videoUrl.trim() || value.completionEdited);
  const update = (change: Partial<Draft>) => setDrafts(current => ({ ...current, [kind]: { ...current[kind], ...change } }));
  useEffect(() => { onDirtyChange?.(dirty || saving); }, [dirty, saving, onDirtyChange]);
  useEffect(() => () => { onDirtyChange?.(false); }, [onDirtyChange]);
  useEffect(() => {
    if (!dirty && !saving) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, saving]);

  const submit = async () => {
    if (submitting.current) return;
    const completed = dateTimeInputToInstant(draft.completedAt, timeZone);
    if (!completed || completed.getTime() > Date.now()) { setMessage({ error: true, text: m.invalidTime }); return; }
    const completedAt = completed.toISOString();
    const preview = { sessionId, kind, notes: draft.notes, videoUrl: draft.videoUrl, completedAt, files: draft.files.map(item => item.uploaded ?? {
      path: `${sessionId}/${kind === "lesson_plan" ? "lesson-plan" : "solution"}/${item.id}.${extension(item.file)}`,
      name: item.file.name, size: item.file.size, type: item.file.type,
    }) };
    if (!materialSupplementSchema.safeParse(preview).success) { setMessage({ error: true, text: m.invalid }); return; }
    submitting.current = true; setSaving(true); setMessage(null);
    try {
      const supabase = createClient();
      const files: Omit<MaterialFile, "url">[] = [];
      for (const item of draft.files) {
        if (item.uploaded) { files.push(item.uploaded); continue; }
        const file = await compressHomeworkImage(item.file);
        if (file.size > MATERIAL_SUPPLEMENT_MAX_BYTES) throw new Error("FILE_TOO_LARGE");
        const path = `${sessionId}/${kind === "lesson_plan" ? "lesson-plan" : "solution"}/${newId()}.${extension(file)}`;
        const { error } = await supabase.storage.from("prep-artifacts").upload(path, file, { cacheControl: "3600", contentType: file.type || undefined, upsert: false });
        if (error) throw new Error("UPLOAD_FAILED");
        const uploaded = { path, name: item.file.name, size: file.size, type: file.type };
        files.push(uploaded);
        setDrafts(current => ({ ...current, [kind]: { ...current[kind], files: current[kind].files.map(value => value.id === item.id ? { ...value, uploaded } : value) } }));
      }
      const result = await supplementSessionMaterialAction({ sessionId, kind, files, notes: draft.notes, videoUrl: draft.videoUrl, completedAt });
      if (!result.ok) throw new Error(result.code);
      setDrafts(current => ({ ...current, [kind]: emptyDraft(timeZone) }));
      setMessage({ error: false, text: result.data.changed ? m.success : result.data.timeChanged ? m.timeSaved : m.unchanged });
      onSaved();
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      const text = code === "FORBIDDEN" || code === "UNAUTHENTICATED" || code === "SESSION_NOT_FOUND" ? m.forbidden
        : code === "MATERIAL_CONFLICT" ? m.conflict : code === "FILES_LIMIT" ? m.filesLimit : code === "FILE_TOO_LARGE" ? m.fileSize
          : code === "NOTES_LIMIT" ? m.notesLimit : code === "REVIEWER_NOT_AVAILABLE" ? m.reviewer : code === "COMPLETION_TIME_INVALID" ? m.invalidTime : code === "VALIDATION" ? m.invalid : m.failed;
      setMessage({ error: true, text });
    } finally { submitting.current = false; setSaving(false); }
  };

  return <section className="space-y-3 py-3" aria-label={m.title} data-session-material-supplement>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><h4 className="text-sm font-medium">{m.title}</h4><p className="mt-1 text-xs text-muted">{m.hint}</p></div>
      <Button size="sm" variant="ghost" disabled={saving} aria-label={m.close} onClick={() => { if (!dirty || window.confirm(m.discard)) onClose(); }}><X size={14} /></Button>
    </div>
    <div role="group" aria-label={m.kind} className="flex flex-wrap gap-1">{MATERIAL_SUPPLEMENT_KINDS.map(value =>
      <Button key={value} size="sm" variant={kind === value ? "secondary" : "ghost"} aria-pressed={kind === value} disabled={saving} onClick={() => { setKind(value); setMessage(null); }}>{labels[value]}</Button>)}</div>
    <Label className="grid max-w-xs gap-1 text-xs">{m.completedAt}<Input type="datetime-local" required value={draft.completedAt} disabled={saving}
      max={zonedDateTimeInputValue(new Date(), timeZone)} onChange={event => update({ completedAt: event.target.value, completionEdited: true })} /></Label>
    <p className="text-xs text-muted">{m.completionHint}</p>
    {kind === "rehearsal_video" ? <Label className="grid max-w-xl gap-1 text-xs">{m.video}<Input type="url" value={draft.videoUrl} disabled={saving} maxLength={1000} placeholder="https://" onChange={event => update({ videoUrl: event.target.value })} /></Label> : <>
      <Label className="grid max-w-xl gap-1 text-xs">{m.files}<Input key={kind} type="file" accept="image/*,application/pdf,.doc,.docx" multiple disabled={saving} onChange={event => {
        const selected = Array.from(event.target.files ?? []); event.target.value = "";
        if (selected.some(file => file.size > MATERIAL_SUPPLEMENT_MAX_BYTES)) { setMessage({ error: true, text: m.fileSize }); return; }
        if (draft.files.length + selected.length > 10) { setMessage({ error: true, text: m.filesLimit }); return; }
        update({ files: [...draft.files, ...selected.map(file => ({ id: newId(), file }))] }); setMessage(null);
      }} /></Label>
      <p className="text-xs text-muted">{m.fileHint}</p>
      {draft.files.length > 0 && <ul className="max-w-xl divide-y divide-line">{draft.files.map(item => <li key={item.id} className="flex items-center gap-2 py-1 text-xs">
        <span className="min-w-0 flex-1 break-all">{item.file.name}</span><Button size="sm" variant="ghost" disabled={saving} aria-label={`${m.remove} · ${item.file.name}`} onClick={() => update({ files: draft.files.filter(value => value.id !== item.id) })}><X size={13} /></Button>
      </li>)}</ul>}
      {kind === "solution" && <Label className="grid max-w-xl gap-1 text-xs">{m.notes}<Textarea value={draft.notes} disabled={saving} maxLength={5000} rows={3} onChange={event => update({ notes: event.target.value })} /></Label>}
    </>}
    <div className="flex flex-wrap items-center gap-3"><Button size="sm" disabled={saving || (!draft.files.length && !draft.notes.trim() && !draft.videoUrl.trim())} onClick={() => void submit()}>
      {saving ? <LoaderCircle size={14} className="animate-spin" /> : <Upload size={14} />}{saving ? m.submitting : m.submit}
    </Button>{message && <p className={message.error ? "text-xs text-rose" : "text-xs text-leaf-deep"} role={message.error ? "alert" : "status"}>{message.text}</p>}</div>
  </section>;
}
