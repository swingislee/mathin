"use client";

import { useTranslations } from "next-intl";
import { useAction } from "@/components/action-form";
import { useRouter } from "@/i18n/navigation";
import { completeSupportTaskAction } from "./actions/support-tasks";
import type { SupportTaskRow } from "./support-tasks";
import { EmptyBody } from "./home/shared";

export function SupportTaskList({ tasks }: { tasks: SupportTaskRow[] }) {
  const t = useTranslations("school.classes");
  const router = useRouter();

  const completeRun = useAction(completeSupportTaskAction, {
    successMessage: t("supportTaskUpdated"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => router.refresh(),
  });

  if (tasks.length === 0) {
    return <EmptyBody text={t("supportTaskEmpty")} href="/dashboard/classes?scope=support" linkLabel={t("openSupport")} />;
  }

  return (
    <ul className="min-h-0 flex-1 divide-y overflow-hidden">
      {tasks.map((task) => (
        <li key={task.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium">{task.classroomName}</span>
            {" · "}
            <span className="text-muted">{t(`supportTaskKind_${task.kind}`)}</span>
          </span>
          {task.dueAt && <time className="shrink-0 text-xs text-muted">{new Date(task.dueAt).toLocaleDateString()}</time>}
          <button
            type="button"
            disabled={completeRun.pending}
            onClick={() => completeRun.run(task.id, "done", "")}
            className="shrink-0 text-xs text-muted underline underline-offset-2 hover:text-ink disabled:opacity-40"
          >
            {t("supportTaskDone")}
          </button>
          <button
            type="button"
            disabled={completeRun.pending}
            onClick={() => completeRun.run(task.id, "skipped", "")}
            className="shrink-0 text-xs text-muted underline underline-offset-2 hover:text-ink disabled:opacity-40"
          >
            {t("supportTaskSkip")}
          </button>
        </li>
      ))}
    </ul>
  );
}
