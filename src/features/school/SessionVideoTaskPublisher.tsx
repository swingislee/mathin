"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Video } from "lucide-react";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "@/i18n/navigation";
import { publishSessionVideoTaskAction, saveSessionVideoTaskAction } from "./actions/classes";
import type { SessionVideoTask } from "./classes";

export function SessionVideoTaskPublisher({
  sessionId,
  task,
}: {
  sessionId: string;
  task: SessionVideoTask | null;
}) {
  const t = useTranslations("school.session");
  const router = useRouter();
  const [title, setTitle] = useState(task?.title ?? "");
  const [instructions, setInstructions] = useState(task?.instructions ?? "");
  const [dueAt, setDueAt] = useState(task?.dueAt ? task.dueAt.slice(0, 16) : "");
  const save = useAction(saveSessionVideoTaskAction, {
    successMessage: t("videoTaskSaved"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => router.refresh(),
  });
  const publish = useAction(publishSessionVideoTaskAction, {
    successMessage: t("videoTaskPublishedToast"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => router.refresh(),
  });
  const pending = save.pending || publish.pending;
  const fields = {
    sessionId,
    title,
    instructions,
    dueAt: dueAt ? new Date(dueAt).toISOString() : null,
  };

  return (
    <section className="rounded-2xl border border-line bg-card p-4 text-sm">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-medium text-ink">
          <Video size={17} />
          {t("videoTaskTitle")}
        </h3>
        <Badge variant={task?.publishedAt ? "default" : "outline"}>
          {task?.publishedAt ? t("published") : task ? t("draft") : t("notCreated")}
        </Badge>
      </div>
      <p className="mt-1 text-xs text-muted">{t("videoTaskHint")}</p>
      <div className="mt-4 grid gap-3">
        <Label className="grid gap-1 text-xs font-normal text-muted">
          {t("videoTaskNameLabel")}
          <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} />
        </Label>
        <Label className="grid gap-1 text-xs font-normal text-muted">
          {t("videoTaskInstructionsLabel")}
          <Textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} maxLength={5000} rows={4} />
        </Label>
        <Label className="grid gap-1 text-xs font-normal text-muted sm:max-w-xs">
          {t("videoTaskDueLabel")}
          <Input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
        </Label>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => save.run(fields)}>
            {t("saveDraft")}
          </Button>
          <Button size="sm" disabled={pending || !task || !title.trim()} onClick={() => publish.run(sessionId)}>
            {task?.publishedAt ? t("republish") : t("publishVideoTask")}
          </Button>
        </div>
        {!task && title.trim() && <p className="text-right text-xs text-muted">{t("saveBeforePublish")}</p>}
      </div>
    </section>
  );
}
