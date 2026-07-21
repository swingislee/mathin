"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/components/action-form";
import { useRouter } from "@/i18n/navigation";
import { addStudentFollowUp } from "./actions/followups";
import { completeSessionTaskAction } from "./actions/classes";
import type { SessionRosterRow } from "./classes";

/**
 * 课后"跟进"任务的精简表单（P4I-15）：不复用 FollowUpForm——那是 P4C 时代的招生漏斗
 * CRM 表单（statusAfter 是报名阶段流转），对已在读学生的课堂跟进没有意义。这里只传
 * content/kind="class"/nextFollowUpAt，复用同一个 addStudentFollowUp，零后端改动。
 */
export function SessionFollowUpQuickForm({ taskId, roster }: { taskId: string; roster: SessionRosterRow[] }) {
  const t = useTranslations("school.session");
  const router = useRouter();
  const [studentId, setStudentId] = useState("");
  const [content, setContent] = useState("");

  const run = useAction(
    async (studentId: string, content: string) => {
      const saved = await addStudentFollowUp(studentId, { content, kind: "class", nextFollowUpAt: null, statusAfter: null });
      if (!saved.ok) return saved;
      return completeSessionTaskAction(taskId, "done", "");
    },
    {
      successMessage: t("followupRecorded"),
      errorMessage: { default: t("actionFailed") },
      onSuccess: () => {
        setStudentId("");
        setContent("");
        router.refresh();
      },
    },
  );

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-card p-3">
      <Select value={studentId} onValueChange={setStudentId}>
        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t("followupSelectStudent")} /></SelectTrigger>
        <SelectContent>
          {roster.map((row) => (
            <SelectItem key={row.studentId} value={row.studentId}>{row.studentName}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder={t("followupContentPlaceholder")}
        maxLength={2000}
      />
      <Button
        size="sm"
        className="self-end"
        disabled={!studentId || !content.trim() || run.pending}
        onClick={() => run.run(studentId, content)}
      >
        {t("followupSubmit")}
      </Button>
    </div>
  );
}
