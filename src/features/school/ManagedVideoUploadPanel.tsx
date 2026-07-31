"use client";

import { LoaderCircle, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { uploadTusFile } from "@/lib/storage/tus-upload";
import { newId } from "@/lib/uuid";

const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const VIDEO_MIME_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);

export interface VideoTaskUploadTarget {
  videoTaskId: string;
  sessionId: string;
  studentId: string;
  classroomId: string;
  classroomName: string;
  lectureName: string;
}

export function ManagedVideoUploadPanel({ task }: { task: VideoTaskUploadTarget }) {
  const t = useTranslations("school.videos");
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const fileInputId = `video-file-${task.videoTaskId}-${task.studentId}`;
  const noteInputId = `video-note-${task.videoTaskId}-${task.studentId}`;

  const upload = async () => {
    if (!file) return;
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
    const videoId = newId();
    const extension = file.type === "video/webm" ? "webm" : file.type === "video/quicktime" ? "mov" : "mp4";
    const storagePath = `${task.classroomId}/${task.sessionId}/${videoId}.${extension}`;
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
        video_task_id: task.videoTaskId,
        session_id: task.sessionId,
        student_id: task.studentId,
        uploaded_by: authData.user.id,
        storage_path: storagePath,
        size_bytes: file.size,
        note: note.trim().slice(0, 1000),
      });
      if (error) {
        await supabase.storage.from("session-videos").remove([storagePath]);
        throw error;
      }
      setFile(null);
      setNote("");
      setProgress(0);
      setMessage(t("uploaded"));
      router.refresh();
    } catch {
      setMessage(t("uploadFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label={t("uploadTitle")} className="mt-4 rounded-xl border border-line bg-paper/60 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium text-ink">{t("uploadTitle")}</h3>
        <p className="text-xs text-muted">{task.classroomName} · {task.lectureName}</p>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={fileInputId}>{t("upload")}</Label>
          <Input id={fileInputId} type="file" accept="video/mp4,video/webm,video/quicktime" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={noteInputId}>{t("note")}</Label>
          <Input id={noteInputId} value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} placeholder={t("note")} />
        </div>
        <Button disabled={busy || !file || Boolean(file && file.size > MAX_VIDEO_BYTES)} onClick={upload} className="w-fit gap-1 sm:col-span-2">
          {busy ? <LoaderCircle size={15} className="animate-spin" /> : <Upload size={15} />} {t("upload")}
        </Button>
        {busy && <p className="text-xs text-muted sm:col-span-2" aria-live="polite">{t("uploadProgress", { progress })}</p>}
      </div>
      {message && <p className="mt-3 text-xs text-muted" aria-live="polite">{message}</p>}
    </section>
  );
}
