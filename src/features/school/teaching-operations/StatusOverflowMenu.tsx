"use client";

import { Ellipsis, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAction } from "@/components/action-form";
import { useRouter } from "@/i18n/navigation";
import type { ActionResult } from "@/lib/action-result";
import type { CourseStatus } from "./types";

const ALL_STATUSES: CourseStatus[] = ["draft", "enabled", "disabled"];

/** 家族/版本启停共用的溢出菜单；两个 action 签名相同（id, target）=> ActionResult。 */
export function StatusOverflowMenu({
  id,
  status,
  action,
  ariaLabel,
}: {
  id: string;
  status: CourseStatus;
  action: (id: string, target: CourseStatus) => Promise<ActionResult>;
  ariaLabel: string;
}) {
  const t = useTranslations("school.courses");
  const router = useRouter();
  const run = useAction(action, {
    successMessage: t("statusUpdated"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => router.refresh(),
  });
  const targets = ALL_STATUSES.filter((value) => value !== status);

  return <Popover>
    <PopoverTrigger asChild>
      <Button type="button" variant="ghost" size="sm" className="px-2" aria-label={ariaLabel}><Ellipsis size={16} /></Button>
    </PopoverTrigger>
    <PopoverContent className="w-44 p-2">
      <div className="grid gap-1">
        {targets.map((target) => <Button key={target} type="button" size="sm" variant="ghost" className="justify-start" disabled={run.pending} onClick={() => run.run(id, target)}>
          {run.pending && <LoaderCircle size={14} className="animate-spin" />}
          {t(`transitionTo_${target}`)}
        </Button>)}
      </div>
    </PopoverContent>
  </Popover>;
}
