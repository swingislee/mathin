"use client";

import { Camera, FileText, LoaderCircle, Paperclip } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "@/i18n/navigation";
import { compressHomeworkImage } from "@/lib/media/compress-image";
import { createClient } from "@/lib/supabase/client";
import { newId } from "@/lib/uuid";
import { submitCustomerAssignmentAction } from "@/features/school/customer-actions";
import type { AssignmentAttachment, SubmissionRecord } from "../types";

const MAX_FILES = 12;
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"]);

export function SubmissionForm({
  assignmentId,
  studentId,
  mine,
}: {
  assignmentId: string;
  studentId: string;
  mine: SubmissionRecord | null;
}) {
  const t = useTranslations("classroom.assignments");
  const router = useRouter();
  const [text, setText] = useState(mine?.content.text ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const existingAttachments = mine?.content.attachments ?? [];

  const openAttachment = async (attachment: AssignmentAttachment) => {
    const { data, error } = await createClient().storage.from("assignment-submissions").createSignedUrl(attachment.path, 600);
    if (error || !data?.signedUrl) {
      setMessage(t("attachmentOpenFailed"));
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const submit = () => startTransition(async () => {
    setMessage(t("optimizingPhotos"));
    const attachments = [...existingAttachments];
    try {
      if (attachments.length + files.length > MAX_FILES) throw new Error("TOO_MANY_FILES");
      const supabase = createClient();
      for (let index = 0; index < files.length; index += 1) {
        const source = files[index];
        if (!ALLOWED_TYPES.has(source.type)) throw new Error("UNSUPPORTED_TYPE");
        const prepared = await compressHomeworkImage(source);
        if (prepared.size > MAX_FILE_BYTES) throw new Error("FILE_TOO_LARGE");
        setMessage(t("uploadingAttachment", { current: index + 1, total: files.length }));
        const extension = prepared.type === "application/pdf" ? "pdf" : prepared.type === "image/png" ? "png" : prepared.type === "image/webp" ? "webp" : prepared.type === "image/heic" ? "heic" : prepared.type === "image/heif" ? "heif" : "jpg";
        const path = `${assignmentId}/${studentId}/${newId()}.${extension}`;
        const { error } = await supabase.storage.from("assignment-submissions").upload(path, prepared, {
          cacheControl: "3600",
          contentType: prepared.type,
          upsert: false,
        });
        if (error) throw error;
        attachments.push({ path, name: prepared.name, mimeType: prepared.type as AssignmentAttachment["mimeType"], size: prepared.size });
      }
      const result = await submitCustomerAssignmentAction({ assignmentId, studentId, text, attachments });
      if (!result.ok) throw new Error(result.code);
      setFiles([]);
      setMessage(t("submitted"));
      router.refresh();
    } catch (error) {
      const code = error instanceof Error ? error.message : "UPLOAD_FAILED";
      setMessage(code === "FILE_TOO_LARGE" ? t("attachmentTooLarge") : code === "TOO_MANY_FILES" ? t("tooManyAttachments") : code === "UNSUPPORTED_TYPE" ? t("attachmentUnsupported") : t("submitFailed"));
    }
  });

  return (
    <div className="rounded-2xl border border-line p-5">
      <h3 className="text-sm font-medium text-muted">{t("yourSubmission")}</h3>
      {mine?.gradedAt && (
        <div className="mt-3 rounded-xl bg-moon/20 px-4 py-3 text-sm">
          <p className="font-medium">{t("statusGraded", { score: mine.score ?? "—" })}</p>
          {mine.feedback && <p className="mt-1 text-muted">{mine.feedback}</p>}
        </div>
      )}
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={t("submitPlaceholder")}
        rows={6}
        className="mt-3"
      />
      <div className="mt-3 rounded-xl border border-dashed border-line bg-moon/10 p-4">
        <div className="flex items-center gap-2 text-sm font-medium"><Camera size={16} />{t("photoUploadTitle")}</div>
        <p className="mt-1 text-xs text-muted">{t("photoUploadHint")}</p>
        <Input
          type="file"
          accept="image/*,application/pdf"
          multiple
          capture="environment"
          className="mt-3"
          disabled={pending}
          onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
        />
        {files.length > 0 && <p className="mt-2 text-xs text-muted">{t("selectedFiles", { count: files.length })}</p>}
        {existingAttachments.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {existingAttachments.map((attachment) => (
              <li key={attachment.path}>
                <Button type="button" size="sm" variant="secondary" className="gap-1" onClick={() => void openAttachment(attachment)}>
                  {attachment.mimeType === "application/pdf" ? <FileText size={14} /> : <Paperclip size={14} />}
                  <span className="max-w-40 truncate">{attachment.name}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={pending || (!text.trim() && files.length === 0 && existingAttachments.length === 0)} onClick={submit}>
          {pending ? <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" /> : t("submit")}
        </Button>
        {mine?.submittedAt && <p className="text-xs text-muted">{t("resubmitHint")}</p>}
      </div>
      {message && <p className="mt-3 text-xs text-muted" aria-live="polite">{message}</p>}
    </div>
  );
}