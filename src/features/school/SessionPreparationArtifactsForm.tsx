"use client";

import { FileText, Link2, LoaderCircle, Trash2, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useAction } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "@/i18n/navigation";
import { compressHomeworkImage } from "@/lib/media/compress-image";
import { createClient } from "@/lib/supabase/client";
import { newId } from "@/lib/uuid";
import { saveSessionPreparationArtifactsAction } from "./actions/classes";
import type { PrepArtifactFile, SessionPreparationArtifacts } from "./session-preparation-artifacts";

const MAX_FILE_BYTES = 12 * 1024 * 1024;
const ACCEPT = "image/*,application/pdf,.doc,.docx";

function extension(file: File): string {
  if (file.type === "image/jpeg") return "jpg";
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "application/pdf") return "pdf";
  return file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase() || "bin";
}

export function SessionPreparationArtifactsForm({
  sessionId,
  initial,
}: {
  sessionId: string;
  initial: SessionPreparationArtifacts;
}) {
  const t = useTranslations("school.session");
  const router = useRouter();
  const [solutionNotes, setSolutionNotes] = useState(initial.solutionNotes);
  const [solutionFiles, setSolutionFiles] = useState(initial.solutionFiles);
  const [lessonPlanFiles, setLessonPlanFiles] = useState(initial.lessonPlanFiles);
  const [rehearsalVideoUrl, setRehearsalVideoUrl] = useState(initial.rehearsalVideoUrl);
  const [uploadingKind, setUploadingKind] = useState<"solution" | "lesson-plan" | null>(null);
  const [message, setMessage] = useState("");

  const save = useAction(saveSessionPreparationArtifactsAction, {
    successMessage: t("prepArtifactsSaved"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => router.refresh(),
  });

  const upload = async (kind: "solution" | "lesson-plan", list: FileList | null) => {
    if (!list?.length) return;
    const current = kind === "solution" ? solutionFiles : lessonPlanFiles;
    const sources = Array.from(list).slice(0, Math.max(0, 10 - current.length));
    setUploadingKind(kind);
    setMessage("");
    const added: PrepArtifactFile[] = [];
    try {
      const supabase = createClient();
      for (const source of sources) {
        const file = await compressHomeworkImage(source);
        if (file.size > MAX_FILE_BYTES) throw new Error("FILE_TOO_LARGE");
        const path = sessionId + "/" + kind + "/" + newId() + "." + extension(file);
        const { error } = await supabase.storage.from("prep-artifacts").upload(path, file, {
          cacheControl: "3600",
          contentType: file.type || undefined,
          upsert: false,
        });
        if (error) throw error;
        added.push({ path, name: file.name, size: file.size, type: file.type });
      }
      if (kind === "solution") setSolutionFiles((files) => [...files, ...added]);
      else setLessonPlanFiles((files) => [...files, ...added]);
      setMessage(t("prepArtifactsUploaded", { count: added.length }));
    } catch {
      setMessage(t("prepArtifactsUploadFailed"));
    } finally {
      setUploadingKind(null);
    }
  };

  const remove = async (kind: "solution" | "lesson-plan", file: PrepArtifactFile) => {
    const supabase = createClient();
    await supabase.storage.from("prep-artifacts").remove([file.path]);
    if (kind === "solution") setSolutionFiles((files) => files.filter((item) => item.path !== file.path));
    else setLessonPlanFiles((files) => files.filter((item) => item.path !== file.path));
  };

  const list = (kind: "solution" | "lesson-plan", files: PrepArtifactFile[]) => files.length > 0 && (
    <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
      {files.map((file) => (
        <li key={file.path} className="flex min-h-11 items-center gap-2 px-3 text-xs">
          <FileText size={14} className="shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          <Button type="button" size="sm" variant="ghost" className="size-9 p-0" onClick={() => void remove(kind, file)} aria-label={t("removePrepArtifact")}>
            <Trash2 size={14} />
          </Button>
        </li>
      ))}
    </ul>
  );

  return (
    <section className="border-t border-line pt-5">
      <div>
        <h3 className="text-sm font-medium text-ink">{t("prepArtifactsTitle")}</h3>
        <p className="mt-1 text-xs text-muted">{t("prepArtifactsHint")}</p>
      </div>
      <div className="mt-4 grid gap-5 @2xl:grid-cols-2">
        <div>
          <Label className="text-xs text-muted">{t("solutionRecordTitle")}</Label>
          <Textarea className="mt-2" value={solutionNotes} onChange={(event) => setSolutionNotes(event.target.value)} maxLength={5000} rows={4} placeholder={t("solutionRecordPlaceholder")} />
          <Input className="mt-2" type="file" accept={ACCEPT} multiple disabled={uploadingKind !== null} onChange={(event) => void upload("solution", event.target.files)} />
          {list("solution", solutionFiles)}
        </div>
        <div>
          <Label className="text-xs text-muted">{t("standardLessonPlanTitle")}</Label>
          <p className="mt-1 text-xs text-muted">{t("standardLessonPlanHint")}</p>
          <Input className="mt-2" type="file" accept={ACCEPT} multiple disabled={uploadingKind !== null} onChange={(event) => void upload("lesson-plan", event.target.files)} />
          {list("lesson-plan", lessonPlanFiles)}
        </div>
      </div>
      <Label className="mt-5 grid gap-1 text-xs font-normal text-muted">
        <span className="flex items-center gap-2"><Link2 size={14} />{t("rehearsalVideoLinkTitle")}</span>
        <Input type="url" value={rehearsalVideoUrl} onChange={(event) => setRehearsalVideoUrl(event.target.value)} maxLength={1000} placeholder="https://pan.baidu.com/..." />
      </Label>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted" aria-live="polite">
          {uploadingKind ? <span className="inline-flex items-center gap-1"><LoaderCircle size={13} className="animate-spin" />{t("uploading")}</span> : message}
        </p>
        <Button
          size="sm"
          className="gap-1"
          disabled={save.pending || uploadingKind !== null}
          onClick={() => save.run({ sessionId, solutionNotes, solutionFiles, lessonPlanFiles, rehearsalVideoUrl })}
        >
          <Upload size={14} />
          {t("savePrepArtifacts")}
        </Button>
      </div>
    </section>
  );
}
