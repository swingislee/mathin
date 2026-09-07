"use client";

import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export function StaffOverviewRefreshButton() {
  const router = useRouter();
  const t = useTranslations("school.home.overview");
  const [pending, startTransition] = useTransition();
  return <Button type="button" variant="ghost" size="sm" className="size-8 p-0" disabled={pending}
    aria-label={t("refreshData")} title={t("refreshData")} onClick={() => startTransition(() => router.refresh())}>
    <RefreshCw className={cn("size-4", pending && "motion-safe:animate-spin")} aria-hidden />
  </Button>;
}
