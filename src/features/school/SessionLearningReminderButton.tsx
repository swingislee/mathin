"use client";

import { Check, ClipboardCheck, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ClassroomLearningReminder } from "./classroom-learning-reminder";

/** 复用登记入口呈现页级提醒，普通页保留原来的圆形工具按钮。 */
export function SessionLearningReminderButton({
  reminder, rail = false, className, ...props
}: Omit<ComponentProps<typeof Button>, "children" | "variant" | "size"> & {
  reminder: ClassroomLearningReminder | null;
  rail?: boolean;
}) {
  const t = useTranslations("school.session");
  const state = reminder?.state;
  const label = reminder ? t("learningReminder_" + reminder.state) : t("learningPanelOpen");
  const progress = reminder
    ? reminder.total === 0 ? t("learningReminderNoStudents")
      : t("learningReminderProgress", { recorded: reminder.recorded, total: reminder.total })
    : "";
  const accessibleLabel = reminder ? `${label}. ${progress}. ${t("learningReminderOpen")}` : label;
  const Icon = state === "complete" ? Check : state === "saving" ? LoaderCircle : ClipboardCheck;

  return (
    <Button
      {...props}
      type="button"
      variant="ghost"
      size="sm"
      title={accessibleLabel}
      aria-label={accessibleLabel}
      aria-busy={state === "saving" || undefined}
      data-classroom-rail-button={rail ? "learning" : undefined}
      data-classroom-learning-reminder={state}
      data-learning-reminder-recorded={reminder?.recorded}
      data-learning-reminder-total={reminder?.total}
      className={cn(
        reminder
          ? "h-11 w-auto shrink-0 gap-1.5 rounded-full border px-2 py-1 transition-colors motion-reduce:transition-none lg:gap-2 lg:px-3"
          : rail
            ? "grid size-11 shrink-0 place-items-center rounded-full p-0 font-normal text-muted transition-colors hover:bg-moon/30 hover:text-ink"
            : "inline-flex min-h-11 items-center gap-1.5 rounded-full bg-ink px-3 py-0 text-xs font-normal text-paper hover:text-paper",
        reminder && (state === "complete"
          ? "border-leaf/45 bg-leaf/15 text-leaf-deep hover:bg-leaf/25 hover:text-leaf-deep"
          : state === "empty"
            ? "border-line bg-paper/60 text-muted hover:bg-paper/80"
            : "border-crater bg-moon text-ink hover:bg-moon/80 dark:border-moon/50 dark:bg-moon/25 dark:hover:bg-moon/35"),
        className,
      )}
    >
      <Icon aria-hidden size={rail ? 18 : 16} className={cn("shrink-0", state === "saving" && "animate-spin motion-reduce:animate-none")} />
      {reminder ? (
        <span className="min-w-0 text-left leading-tight" aria-live="polite" aria-atomic="true">
          <span className="block whitespace-nowrap text-[11px] font-medium lg:text-xs">
            <span className="lg:hidden">{t("learningReminderShort_" + reminder.state)}</span>
            <span className="hidden lg:inline">{label}</span>
          </span>
          <span className="block whitespace-nowrap text-[10px] font-normal tabular-nums lg:text-[11px]">
            {reminder.total === 0 ? t("learningReminderNoStudents") : (
              <><span className="lg:hidden">{reminder.recorded} / {reminder.total}</span><span className="hidden lg:inline">{progress}</span></>
            )}
          </span>
        </span>
      ) : <span className={rail ? "sr-only" : undefined}>{label}</span>}
    </Button>
  );
}
