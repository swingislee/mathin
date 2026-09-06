"use client";

import { useId } from "react";
import { HeartPulse } from "lucide-react";
import { useTranslations } from "next-intl";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { LeadInterestLevel } from "./lead-contract";
import { WechatStatusControl } from "./WechatStatusControl";
import { FollowupFieldIcon } from "./FollowupFieldIcon";

const interestColors = {
  A: "hover:bg-leaf/20 data-[state=on]:border-leaf-deep/40 data-[state=on]:bg-leaf",
  B: "hover:bg-moon/25 data-[state=on]:border-[var(--followup-outline)]/40 data-[state=on]:bg-moon",
  C: "hover:bg-rose/15 data-[state=on]:border-rose-deep/40 data-[state=on]:bg-rose/85",
};

export function FollowupContactFacts({ wechat, onWechatChange, interest, onInterestChange, disabled }: {
  wechat: boolean | null;
  onWechatChange: (value: boolean | null) => void;
  interest: LeadInterestLevel | "";
  onInterestChange: (value: LeadInterestLevel | "") => void;
  disabled?: boolean;
}) {
  const t = useTranslations("school.leads");
  const entryT = useTranslations("school.followupEntry");
  const id = useId();
  return <div data-followup-contact-facts className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2">
    <WechatStatusControl value={wechat} onChange={onWechatChange} disabled={disabled}
      labels={{ name: entryT("wechatLabel"), unknown: entryT("wechatUnknown"), yes: entryT("wechatYes"), no: entryT("wechatNo") }} />
    <div className="flex min-h-8 items-center gap-2">
      <FollowupFieldIcon id={`${id}-interest`} icon={HeartPulse} label={t("interestLevel")}
        className="text-[color:color-mix(in_srgb,var(--rose)_55%,var(--muted))] [&>path:first-child]:fill-rose/25" />
      <TooltipProvider delayDuration={200}>
        <ToggleGroup type="single" value={interest} onValueChange={(value) => onInterestChange(value as LeadInterestLevel | "")}
          disabled={disabled} aria-labelledby={`${id}-interest`} size="sm" className="justify-start gap-1">
          {(["A", "B", "C"] as const).map((level) => <Tooltip key={level}>
            <ToggleGroupItem value={level} asChild
              className={cn("size-8 min-w-8 cursor-pointer border border-transparent bg-muted/6 p-0 text-xs text-muted data-[state=on]:font-semibold data-[state=on]:text-[var(--followup-choice-ink)]", interestColors[level])}>
              <TooltipTrigger aria-label={t(`interest_${level}`)}>{level}</TooltipTrigger>
            </ToggleGroupItem>
            <TooltipContent>{t(`interest_${level}`)}</TooltipContent>
          </Tooltip>)}
        </ToggleGroup>
      </TooltipProvider>
    </div>
  </div>;
}
