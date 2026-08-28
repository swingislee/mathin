"use client";

import { LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "@/i18n/navigation";
import { updateScheduleDefaultsAction } from "./actions/academic-calendar";
import type { ScheduleDefaultsV2 } from "./organization-locations";

export function ScheduleDefaultsForm({ defaults }: { defaults: ScheduleDefaultsV2 }) {
  const t = useTranslations("school.scheduleDefaults");
  const router = useRouter();
  const [duration, setDuration] = useState(String(defaults.defaultDurationMinutes));
  const value = Number(duration);
  const valid = Number.isInteger(value) && value >= 15 && value <= 300;
  const run = useAction(updateScheduleDefaultsAction, {
    successMessage: t("saved"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => router.refresh(),
  });

  return (
    <section className="max-w-2xl rounded-2xl border border-line bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="font-medium text-ink">{t("classDefaultsTitle")}</h2><p className="mt-1 text-sm text-muted">{t("classDefaultsIntro")}</p></div>
        <Badge variant="outline">{t("newClassesOnly")}</Badge>
      </div>
      <Label className="mt-5 grid max-w-xs gap-1 text-xs font-normal text-muted">
        {t("duration")}
        <Input type="number" min={15} max={300} step={5} value={duration} onChange={(event) => setDuration(event.target.value)} />
      </Label>
      <div className="mt-5 rounded-xl bg-moon/25 px-3 py-2 text-sm text-muted">
        <p className="font-medium text-ink">{t("conflictPolicyTitle")}: {t("conflictPolicyWarn")}</p>
        <p className="mt-1 text-xs">{t("conflictPolicyHint")}</p>
      </div>
      <Button type="button" className="mt-5" disabled={!valid || run.pending || value === defaults.defaultDurationMinutes} onClick={() => run.run(value)}>
        {run.pending && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />}{t("save")}
      </Button>
    </section>
  );
}
