"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FollowupChoice } from "./dashboard-page/FollowupChoice";
import { CONTACT_OUTCOME_SHORTCUTS } from "./followup-keyboard";
import { firstContactRowMessages } from "./first-contact-row-messages";
import type { LeadContactOutcome } from "./lead-contract";

const selectedClasses: Record<LeadContactOutcome, string> = {
  unreachable: "border-crater bg-moon/80 font-semibold text-ink hover:bg-moon",
  connected: "border-leaf-deep/60 bg-leaf/70 font-semibold text-ink hover:bg-leaf/85",
  declined: "border-blue/55 bg-blue/15 font-semibold text-blue hover:bg-blue/20",
  invalid_number: "border-rose/60 bg-rose/15 font-semibold text-rose-deep hover:bg-rose/20",
};

export function FollowupContactOutcome({ value, onChange, disabled, locale }: {
  value: LeadContactOutcome | ""; onChange: (value: LeadContactOutcome | "") => void; disabled?: boolean; locale: string;
}) {
  const t = useTranslations("school.leads");
  const entryT = useTranslations("school.followupEntry");
  return <div className="space-y-1.5">
    <p className="text-xs font-medium text-ink">{entryT("outcome")}</p>
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <FollowupChoice presentation="buttons" label={entryT("outcome")} value={value} disabled={disabled}
        onValueChange={outcome => onChange(outcome as LeadContactOutcome)}
        options={CONTACT_OUTCOME_SHORTCUTS.map(({ key, outcome }) => ({ value: outcome, label: `${t(`contactOutcome_${outcome}`)} · ${key}`, shortcut: key,
          selectedClassName: selectedClasses[outcome] }))} />
      <Button type="button" size="sm" variant="ghost" className="h-9 rounded-md px-2 text-xs"
        disabled={disabled || !value} aria-keyshortcuts="0" onClick={() => onChange("")}>
        {firstContactRowMessages(locale).clearOutcome}<kbd className="text-[10px]">0</kbd>
      </Button>
    </div>
  </div>;
}
