"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import type { CoursewareTrack } from "./data";
import { deleteCoursewarePageAction } from "./actions";

export function CoursewarePageDeleteButton({
  lectureId,
  pageId,
  nextPageId,
  track,
}: {
  lectureId: string;
  pageId: string;
  nextPageId: string | null;
  track: CoursewareTrack;
}) {
  const t = useTranslations("coursewareStudio");
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  const remove = () => startTransition(async () => {
    const result = await deleteCoursewarePageAction(pageId);
    if (!result.ok) {
      setMessage(t("deleteFailed", { code: result.code }));
      return;
    }
    const destinationTrack = nextPageId ? track : "native-16x9";
    const page = nextPageId ? `&page=${nextPageId}` : "";
    router.push(`/studio/courseware/${lectureId}?track=${destinationTrack}${page}`);
  });

  return (
    <>
      <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={remove}>
        <Trash2 className="size-4" />
        {t("deletePage")}
      </Button>
      <span className="sr-only" role="status" aria-live="polite">{message}</span>
    </>
  );
}
