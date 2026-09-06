"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { LeadInterestLevel } from "./lead-contract";
import { WechatStatusControl } from "./WechatStatusControl";

const interestColors = {
  A: "bg-leaf/10 hover:bg-leaf/25 data-[state=on]:border-leaf-deep data-[state=on]:bg-leaf",
  B: "bg-moon/15 hover:bg-moon/30 data-[state=on]:border-[var(--followup-outline)] data-[state=on]:bg-moon",
  C: "bg-rose/5 hover:bg-rose/20 data-[state=on]:border-rose-deep data-[state=on]:bg-rose/85",
};

export function FollowupContactFacts({ wechat, onWechatChange, interest, onInterestChange, disabled }: {
  wechat: boolean | null;
  onWechatChange: (value: boolean) => void;
  interest: LeadInterestLevel | "";
  onInterestChange: (value: LeadInterestLevel | "") => void;
  disabled?: boolean;
}) {
  const t = useTranslations("school.leads");
  const entryT = useTranslations("school.followupEntry");
  const id = useId();
  return <div data-followup-contact-facts className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-2">
    <WechatStatusControl value={wechat} onChange={onWechatChange} disabled={disabled}
      labels={{ name: entryT("wechatLabel"), unknown: entryT("wechatUnknown"), yes: entryT("wechatYes"), no: entryT("wechatNo") }} />
    <div className="flex min-h-8 items-center gap-3">
      <p id={`${id}-interest`} className="text-xs font-medium text-muted">{t("interestLevel")}</p>
      <TooltipProvider delayDuration={200}>
        <ToggleGroup type="single" value={interest} onValueChange={(value) => onInterestChange(value as LeadInterestLevel | "")}
          disabled={disabled} aria-labelledby={`${id}-interest`} size="sm" className="justify-start gap-1">
          {(["A", "B", "C"] as const).map((level) => <Tooltip key={level}>
            <TooltipTrigger asChild><ToggleGroupItem value={level} aria-label={t(`interest_${level}`)}
              className={cn("size-8 min-w-8 border border-transparent p-0 text-xs text-muted data-[state=on]:font-semibold data-[state=on]:text-[var(--followup-choice-ink)]", interestColors[level])}>
              {level}
            </ToggleGroupItem></TooltipTrigger>
            <TooltipContent>{t(`interest_${level}`)}</TooltipContent>
          </Tooltip>)}
        </ToggleGroup>
      </TooltipProvider>
    </div>
  </div>;
}
