"use client";

import { LoaderCircle, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useAction } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "@/i18n/navigation";
import { updateOrganizationProfileV2Action } from "./actions/organization-locations";
import { inputClass } from "./controls";
import { DashboardCard } from "./dashboard-page";
import type { OrganizationProfileV2 } from "./organization-locations";

export function OrganizationProfileForm({ profile }: { profile: OrganizationProfileV2 }) {
  const t = useTranslations("school.organizationProfile");
  const router = useRouter();
  const [name, setName] = useState(profile.name);
  const [timezone, setTimezone] = useState(profile.timezone);
  const { run, pending } = useAction(updateOrganizationProfileV2Action, {
    successMessage: t("saved"),
    errorMessage: {
      INVALID_ORGANIZATION: t("invalid"),
      FORBIDDEN: t("forbidden"),
      default: t("actionFailed"),
    },
    onSuccess: () => router.refresh(),
  });

  return (
    <DashboardCard title={t("cardTitle")} description={t("cardIntro")}>
      <div className="grid max-w-2xl gap-5 sm:grid-cols-2">
        <Label className="grid gap-1.5 text-sm font-normal text-muted">
          {t("name")}
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
            className={inputClass}
          />
        </Label>
        <Label className="grid gap-1.5 text-sm font-normal text-muted">
          {t("timezone")}
          <Input
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            maxLength={64}
            placeholder="Asia/Shanghai"
            className={inputClass}
          />
        </Label>
      </div>
      <div className="mt-3 text-xs text-muted">
        <p>{t("timezoneHint")}</p>
        <p className="mt-1">{t("languageFixed")}</p>
      </div>
      <div className="mt-5 flex justify-end">
        <Button
          type="button"
          size="sm"
          className="gap-1.5"
          disabled={pending || !name.trim() || !timezone.trim()}
          onClick={() => run({ name, timezone })}
        >
          {pending ? <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" /> : <Save size={15} />}
          {t("save")}
        </Button>
      </div>
    </DashboardCard>
  );
}
