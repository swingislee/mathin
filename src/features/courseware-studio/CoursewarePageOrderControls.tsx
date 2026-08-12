"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { reorderCoursewarePagesAction } from "./actions";

export function CoursewarePageOrderControls({
  lectureId,
  pageId,
  pageIds,
}: {
  lectureId: string;
  pageId: string;
  pageIds: readonly string[];
}) {
  const t = useTranslations("coursewareStudio");
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const index = pageIds.indexOf(pageId);

  const move = (direction: -1 | 1) => startTransition(async () => {
    const target = index + direction;
    if (index < 0 || target < 0 || target >= pageIds.length) return;
    const ordered = [...pageIds];
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    const result = await reorderCoursewarePagesAction({ lectureId, pageIds: ordered });
    setMessage(result.ok ? t("pageOrderUpdated") : t("orderFailed", { code: result.code }));
    if (result.ok) router.refresh();
  });

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button type="button" variant="secondary" size="sm" disabled={pending || index <= 0} onClick={() => move(-1)}>
        {t("moveUp")}
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={pending || index < 0 || index >= pageIds.length - 1}
        onClick={() => move(1)}
      >
        {t("moveDown")}
      </Button>
      <span className="sr-only" role="status" aria-live="polite">{message}</span>
    </div>
  );
}

