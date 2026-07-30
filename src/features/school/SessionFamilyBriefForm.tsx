"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/components/action-form";
import { useRouter } from "@/i18n/navigation";
import { publishSessionFamilyBriefAction, saveSessionFamilyBriefAction } from "./actions/classes";
import type { SessionFamilyBrief } from "./classes";

export function SessionFamilyBriefForm({ sessionId, brief }: { sessionId: string; brief: SessionFamilyBrief }) {
  const t = useTranslations("school.session");
  const router = useRouter();
  const [lessonTitle, setLessonTitle] = useState(brief.lessonTitle);
  const [learningSummary, setLearningSummary] = useState(brief.learningSummary);
  const [materialsNote, setMaterialsNote] = useState(brief.materialsNote);
  const [teacherPublicComment, setTeacherPublicComment] = useState(brief.teacherPublicComment);

  const saveRun = useAction(saveSessionFamilyBriefAction, {
    successMessage: t("knowledgeSummarySaved"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => router.refresh(),
  });
  const publishRun = useAction(publishSessionFamilyBriefAction, {
    successMessage: t("knowledgeSummaryPublishedToast"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => router.refresh(),
  });

  const fields = {
    sessionId,
    lessonTitle,
    learningSummary,
    homeworkSummary: brief.homeworkSummary,
    materialsNote,
    teacherPublicComment,
  };
  const pending = saveRun.pending || publishRun.pending;

  return (
    <div className="flex flex-col gap-3">
      <Label className="grid gap-1 text-xs font-normal text-muted">
        {t("knowledgeSummaryTitleLabel")}
        <Input value={lessonTitle} onChange={(event) => setLessonTitle(event.target.value)} maxLength={200} />
      </Label>
      <Label className="grid gap-1 text-xs font-normal text-muted">
        {t("knowledgeSummaryBodyLabel")}
        <Textarea value={learningSummary} onChange={(event) => setLearningSummary(event.target.value)} maxLength={2000} rows={6} />
      </Label>
      <Label className="grid gap-1 text-xs font-normal text-muted">
        {t("knowledgeSummaryMediaLabel")}
        <Textarea value={materialsNote} onChange={(event) => setMaterialsNote(event.target.value)} maxLength={2000} rows={3} />
      </Label>
      <Label className="grid gap-1 text-xs font-normal text-muted">
        {t("knowledgeSummaryCommentLabel")}
        <Textarea value={teacherPublicComment} onChange={(event) => setTeacherPublicComment(event.target.value)} maxLength={2000} rows={3} />
      </Label>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => saveRun.run(fields)}>
          {t("saveDraft")}
        </Button>
        <Button
          size="sm"
          disabled={pending || !lessonTitle.trim() || !learningSummary.trim()}
          onClick={() => publishRun.run(sessionId)}
        >
          {brief.publishedAt ? t("republish") : t("publishKnowledgeSummary")}
        </Button>
      </div>
    </div>
  );
}
