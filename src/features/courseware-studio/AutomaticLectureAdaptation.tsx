"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { prepareLectureAdaptedDraftsAction } from "./automatic-adaptation-actions";

/** 首次进入整讲时自动补齐粗版，再挂载编辑器，避免刷新打断正在编辑的草稿。 */
export function AutomaticLectureAdaptation({ lectureId, missingCount, children }: { lectureId: string; missingCount: number; children: ReactNode }) {
  const t = useTranslations("coursewareWorkspace.automaticAdaptation");
  const router = useRouter();
  const [remaining, setRemaining] = useState(missingCount);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!missingCount) return;
    let active = true;
    async function prepare() {
      setError(false);
      try {
        let count = missingCount;
        while (count > 0 && active) {
          const result = await prepareLectureAdaptedDraftsAction({ lectureId });
          if (!result.ok) throw new Error(result.code);
          count = result.data.remaining;
          if (active) setRemaining(count);
        }
        if (active) router.refresh();
      } catch { if (active) setError(true); }
    }
    void prepare();
    return () => { active = false; };
  }, [attempt, lectureId, missingCount, router]);
  if (!missingCount) return children;
  return <div className="space-y-3 px-4 py-8" role={error ? "alert" : "status"} data-courseware-auto-adaptation>
    <p className="text-sm text-ink">{t(error ? "failed" : "preparing", { remaining })}</p>
    <p className="text-xs text-muted">{t("hint")}</p>
    {error ? <Button size="sm" onClick={() => setAttempt((value) => value + 1)}>{t("retry")}</Button> : null}
  </div>;
}
