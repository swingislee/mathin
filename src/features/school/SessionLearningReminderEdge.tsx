"use client";

import { Bookmark, BookmarkCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ClassroomLearningReminder } from "./classroom-learning-reminder";

/** 外缘描边不接收指针，页边书签与原入口打开同一份学情记录。 */
export function SessionLearningReminderEdge({ reminder, onOpen }: {
  reminder: ClassroomLearningReminder | null;
  onOpen: () => void;
}) {
  const t = useTranslations("school.session");
  if (!reminder) return null;
  const complete = reminder.state === "complete";
  const empty = reminder.state === "empty";
  const Icon = complete ? BookmarkCheck : Bookmark;
  const label = `${t("learningReminder_" + reminder.state)}. ${t("learningReminderOpen")}`;

  return (
    <>
      <div
        aria-hidden="true"
        data-classroom-learning-edge={reminder.state}
        className={cn(
          "pointer-events-none absolute inset-0 rounded-[inherit] border-2 transition-colors motion-reduce:transition-none",
          complete ? "border-leaf/50" : empty ? "border-line" : "border-rose",
        )}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        title={label}
        aria-label={label}
        onClick={onOpen}
        data-classroom-input="native"
        data-classroom-learning-bookmark={reminder.state}
        className={cn(
          "pointer-events-auto absolute right-0 top-3 size-11 rounded-l-lg rounded-r-none p-1 transition-colors",
          complete ? "hover:bg-leaf/15" : empty ? "hover:bg-paper/80" : "hover:bg-rose/10",
        )}
      >
        <Icon aria-hidden className={cn(
          "!size-8 stroke-[1.5]",
          complete ? "fill-leaf/25 text-leaf-deep" : empty ? "fill-paper text-muted" : "fill-rose/15 text-rose",
        )} />
      </Button>
    </>
  );
}
