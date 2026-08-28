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
    <section id="schedule-defaults" className="scroll-mt-40 border-y border-line py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl"><h2 className="font-medium text-ink">{t("classDefaultsTitle")}</h2><p className="mt-1 text-sm text-muted">{t("classDefaultsIntro")}</p></div>
        <Badge variant="outline">{t("newClassesOnly")}</Badge>
      </div>
      <div className="mt-5 divide-y divide-line border-t border-line">
        <div className="grid gap-3 py-4 sm:grid-cols-[minmax(12rem,16rem)_minmax(0,1fr)] sm:items-center">
          <Label htmlFor="default-session-duration" className="text-sm font-normal text-muted">{t("duration")}</Label>
          <Input
            id="default-session-duration"
            className="max-w-48"
            type="number"
            min={15}
            max={300}
            step={5}
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
          />
        </div>
        <div className="grid gap-3 py-4 sm:grid-cols-[minmax(12rem,16rem)_minmax(0,1fr)]">
          <p className="text-sm text-muted">{t("conflictPolicyTitle")}</p>
          <div>
            <p className="text-sm font-medium text-ink">{t("conflictPolicyWarn")}</p>
            <p className="mt-1 text-xs leading-5 text-muted">{t("conflictPolicyHint")}</p>
          </div>
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <Button type="button" disabled={!valid || run.pending || value === defaults.defaultDurationMinutes} onClick={() => run.run(value)}>
          {run.pending && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />}{t("save")}
        </Button>
      </div>
    </section>
  );
}
