"use client";

import { LoaderCircle, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { uploadTusFile } from "@/lib/storage/tus-upload";
import { deleteSessionVideoAction } from "./video-actions";

const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const VIDEO_MIME_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);

interface SessionOption {
  id: string;
  studentId: string;
  classroomId: string;
  classroomName: string;
  lectureName: string;
}

interface UploadRow {
  video_id: string;
  lecture_name: string;
  submitted_at: string;
  reviewed_at: string | null;
}

export function ManagedVideoUploadPanel() {
  const t = useTranslations("school.videos");
  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const supabase = createClient();
    const [sessionResult, uploadResult] = await Promise.all([
      supabase.rpc("get_my_video_sessions"),
      supabase.rpc("get_my_video_uploads"),
    ]);
    const options = ((sessionResult.data ?? []) as Array<{
      session_id: string;
      student_id: string;
      classroom_id: string;
      classroom_name: string;
      lecture_name: string;
    }>).map((row) => ({
      id: row.session_id,
      studentId: row.student_id,
      classroomId: row.classroom_id,
      classroomName: row.classroom_name,
      lectureName: row.lecture_name,
    }));
    setSessions(options);
    setSessionId((current) => current || options[0]?.id || "");
    setUploads((uploadResult.data ?? []) as UploadRow[]);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const upload = async () => {
    const session = sessions.find((candidate) => candidate.id === sessionId);
    if (!file || !session) return;
    if (!VIDEO_MIME_TYPES.has(file.type)) {
      setMessage(t("unsupportedType"));
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      setMessage(t("fileTooLarge"));
      return;
    }

    setBusy(true);
    setMessage("");
    setProgress(0);
    const supabase = createClient();
    const videoId = crypto.randomUUID();
    const extension = file.type === "video/webm" ? "webm" : file.type === "video/quicktime" ? "mov" : "mp4";
    const storagePath = `${session.classroomId}/${session.id}/${videoId}.${extension}`;
    try {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) throw new Error("UNAUTHENTICATED");
      await uploadTusFile({
        bucketId: "session-videos",
        objectPath: storagePath,
        file,
        onProgress: (uploaded, total) => setProgress(total > 0 ? Math.round((uploaded / total) * 100) : 0),
      });
      const { error } = await supabase.from("session_videos").insert({
        id: videoId,
        session_id: session.id,
        student_id: session.studentId,
        uploaded_by: authData.user.id,
        storage_path: storagePath,
        size_bytes: file.size,
        note: note.trim().slice(0, 1000),
      });
      if (error) throw error;
      setFile(null);
      setNote("");
      setProgress(0);
      setMessage(t("uploaded"));
      await load();
    } catch {
      setMessage(t("uploadFailed"));
    } finally {
      setBusy(false);
    }
  };

  if (sessions.length === 0 && uploads.length === 0) return null;
  return (
    <section className="rounded-2xl border border-line bg-card p-5">
      <h2 className="text-base font-medium text-ink">{t("uploadTitle")}</h2>
      {sessions.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Select value={sessionId} onValueChange={setSessionId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{sessions.map((session) => (
              <SelectItem key={session.id} value={session.id}>{session.classroomName} · {session.lectureName}</SelectItem>
            ))}</SelectContent>
          </Select>
          <Input type="file" accept="video/mp4,video/webm,video/quicktime" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("note")} />
          <Button disabled={busy || !file || Boolean(file && file.size > MAX_VIDEO_BYTES)} onClick={upload} className="gap-1">
            {busy ? <LoaderCircle size={15} className="animate-spin" /> : <Upload size={15} />} {t("upload")}
          </Button>
          {busy && <p className="text-xs text-muted sm:col-span-2" aria-live="polite">{t("uploadProgress", { progress })}</p>}
        </div>
      )}
      {uploads.length > 0 && (
        <ul className="mt-4 divide-y divide-line">{uploads.map((video) => (
          <li key={video.video_id} className="flex items-center gap-3 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{video.lecture_name}</span>
            <span className="text-xs text-muted">{video.reviewed_at ? t("reviewed") : t("pending")}</span>
            {!video.reviewed_at && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => {
                setBusy(true);
                void deleteSessionVideoAction(video.video_id).then(load).finally(() => setBusy(false));
              }}>{t("delete")}</Button>
            )}
          </li>
        ))}</ul>
      )}
      {message && <p className="mt-3 text-xs text-muted" aria-live="polite">{message}</p>}
    </section>
  );
}
