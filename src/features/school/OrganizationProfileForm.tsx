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
    <section className="max-w-5xl border-y border-line">
      <header className="py-5">
        <h2 className="text-base font-medium text-ink">{t("cardTitle")}</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">{t("cardIntro")}</p>
      </header>
      <div className="divide-y divide-line border-t border-line">
        <div className="grid gap-3 py-4 sm:grid-cols-[minmax(11rem,15rem)_minmax(0,1fr)] sm:items-center">
          <Label htmlFor="organization-name" className="text-sm font-normal text-muted">{t("name")}</Label>
          <Input
            id="organization-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
            className={`${inputClass} max-w-xl`}
          />
        </div>
        <div className="grid gap-3 py-4 sm:grid-cols-[minmax(11rem,15rem)_minmax(0,1fr)]">
          <Label htmlFor="organization-timezone" className="pt-2 text-sm font-normal text-muted">{t("timezone")}</Label>
          <div className="max-w-xl">
            <Input
              id="organization-timezone"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              maxLength={64}
              placeholder="Asia/Shanghai"
              className={inputClass}
            />
            <p className="mt-2 text-xs leading-5 text-muted">{t("timezoneHint")}</p>
          </div>
        </div>
        <div className="grid gap-3 py-4 sm:grid-cols-[minmax(11rem,15rem)_minmax(0,1fr)]">
          <p className="text-sm text-muted">中文 / English</p>
          <p className="text-sm text-ink">{t("languageFixed")}</p>
        </div>
      </div>
      <div className="flex justify-end border-t border-line py-4">
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
    </section>
  );
}
