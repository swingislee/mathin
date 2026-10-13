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

export function FollowupContactOutcome({ value, onChange, disabled, locale, compact = false }: {
  value: LeadContactOutcome | ""; onChange: (value: LeadContactOutcome | "") => void; disabled?: boolean; locale: string; compact?: boolean;
}) {
  const t = useTranslations("school.leads");
  const entryT = useTranslations("school.followupEntry");
  return <div className="space-y-1.5">
    {!compact ? <p className="text-xs font-medium text-ink">{entryT("outcome")}</p> : null}
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <FollowupChoice presentation="buttons" label={entryT("outcome")} value={value} disabled={disabled}
        className={compact ? "gap-1 [&>button]:min-h-7 [&>button]:gap-1 [&>button]:px-1.5 [&>button]:py-0.5 [&>button]:text-[11px] [&>button>span:first-child]:hidden" : undefined}
        onValueChange={outcome => onChange(outcome as LeadContactOutcome)}
        options={CONTACT_OUTCOME_SHORTCUTS.map(({ key, outcome }) => ({ value: outcome, label: `${t(`contactOutcome_${outcome}`)} · ${key}`, shortcut: key,
          selectedClassName: selectedClasses[outcome] }))} />
      {!compact || value ? <Button type="button" size="sm" variant="ghost" className={compact ? "h-7 rounded-md px-1 text-[11px]" : "h-9 rounded-md px-2 text-xs"}
        disabled={disabled || !value} aria-keyshortcuts="0" onClick={() => onChange("")}>
        {firstContactRowMessages(locale).clearOutcome}<kbd className="text-[10px]">0</kbd>
      </Button> : null}
    </div>
  </div>;
}
