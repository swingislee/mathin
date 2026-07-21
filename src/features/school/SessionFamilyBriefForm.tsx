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

/** 家庭摘要教师侧写作+发布入口（doc19 §16.5）；P4I 只交付这个员工入口，家庭侧阅读页留给 P4J。 */
export function SessionFamilyBriefForm({ sessionId, brief }: { sessionId: string; brief: SessionFamilyBrief }) {
  const t = useTranslations("school.session");
  const router = useRouter();
  const [lessonTitle, setLessonTitle] = useState(brief.lessonTitle);
  const [learningSummary, setLearningSummary] = useState(brief.learningSummary);
  const [homeworkSummary, setHomeworkSummary] = useState(brief.homeworkSummary);
  const [materialsNote, setMaterialsNote] = useState(brief.materialsNote);
  const [teacherPublicComment, setTeacherPublicComment] = useState(brief.teacherPublicComment);

  const saveRun = useAction(saveSessionFamilyBriefAction, {
    successMessage: t("familyBriefSaved"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => router.refresh(),
  });
  const publishRun = useAction(publishSessionFamilyBriefAction, {
    successMessage: t("familyBriefPublishedToast"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => router.refresh(),
  });

  const fields = { sessionId, lessonTitle, learningSummary, homeworkSummary, materialsNote, teacherPublicComment };
  const pending = saveRun.pending || publishRun.pending;

  return (
    <div className="flex flex-col gap-3">
      <Label className="grid gap-1 text-xs font-normal text-muted">
        {t("familyBriefLessonTitle")}
        <Input value={lessonTitle} onChange={(event) => setLessonTitle(event.target.value)} maxLength={200} />
      </Label>
      <Label className="grid gap-1 text-xs font-normal text-muted">
        {t("familyBriefLearningSummary")}
        <Textarea value={learningSummary} onChange={(event) => setLearningSummary(event.target.value)} maxLength={2000} />
      </Label>
      <Label className="grid gap-1 text-xs font-normal text-muted">
        {t("familyBriefHomeworkSummary")}
        <Textarea value={homeworkSummary} onChange={(event) => setHomeworkSummary(event.target.value)} maxLength={2000} />
      </Label>
      <Label className="grid gap-1 text-xs font-normal text-muted">
        {t("familyBriefMaterialsNote")}
        <Textarea value={materialsNote} onChange={(event) => setMaterialsNote(event.target.value)} maxLength={2000} />
      </Label>
      <Label className="grid gap-1 text-xs font-normal text-muted">
        {t("familyBriefTeacherComment")}
        <Textarea value={teacherPublicComment} onChange={(event) => setTeacherPublicComment(event.target.value)} maxLength={2000} />
      </Label>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => saveRun.run(fields)}>
          {t("familyBriefSaveDraft")}
        </Button>
        <Button size="sm" disabled={pending || !lessonTitle.trim()} onClick={() => publishRun.run(sessionId)}>
          {t("familyBriefPublish")}
        </Button>
      </div>
    </div>
  );
}
