"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { BookOpenCheck } from "lucide-react";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "@/i18n/navigation";
import { publishSessionAssignmentAction } from "./actions/classes";
import type { SessionPublishedAssignment } from "./classes";

export function SessionAssignmentPublisher({
  sessionId,
  assignments,
}: {
  sessionId: string;
  assignments: SessionPublishedAssignment[];
}) {
  const t = useTranslations("school.session");
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [dueAt, setDueAt] = useState("");
  const publish = useAction(publishSessionAssignmentAction, {
    successMessage: t("assignmentPublishedToast"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => {
      setTitle("");
      setContent("");
      setDueAt("");
      router.refresh();
    },
  });

  return (
    <section className="rounded-2xl border border-line bg-card p-4 text-sm">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-medium text-ink">
          <BookOpenCheck size={17} />
          {t("assignmentPublishTitle")}
        </h3>
        <Badge variant={assignments.length > 0 ? "default" : "outline"}>
          {t("publishedCount", { count: assignments.length })}
        </Badge>
      </div>
      <p className="mt-1 text-xs text-muted">{t("assignmentPublishHint")}</p>
      <div className="mt-4 grid gap-3">
        <Label className="grid gap-1 text-xs font-normal text-muted">
          {t("assignmentTitleLabel")}
          <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} />
        </Label>
        <Label className="grid gap-1 text-xs font-normal text-muted">
          {t("assignmentInstructionsLabel")}
          <Textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength={20000} rows={4} />
        </Label>
        <Label className="grid gap-1 text-xs font-normal text-muted sm:max-w-xs">
          {t("assignmentDueLabel")}
          <DateTimePicker mode="datetime" value={dueAt} onValueChange={setDueAt} />
        </Label>
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={publish.pending || !title.trim()}
            onClick={() => publish.run({
              sessionId,
              title,
              content,
              dueAt: dueAt ? new Date(dueAt).toISOString() : null,
            })}
          >
            {t("publishAssignment")}
          </Button>
        </div>
      </div>
      {assignments.length > 0 && (
        <ul className="mt-4 divide-y divide-line border-t border-line">
          {assignments.map((assignment) => (
            <li key={assignment.id} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1 truncate">{assignment.title}</span>
              {assignment.dueAt && (
                <time className="text-xs text-muted">{new Date(assignment.dueAt).toLocaleString()}</time>
              )}
              <Badge variant="outline">{t("published")}</Badge>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
