"use client";

import { Check } from "lucide-react";
import { useId } from "react";
import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { LeadInterestLevel } from "./lead-contract";

const interestColors = {
  A: "border-leaf-deep/50 bg-leaf/15 data-[state=on]:border-leaf-deep data-[state=on]:bg-leaf/35",
  B: "border-[var(--followup-outline)]/50 bg-moon/20 data-[state=on]:border-[var(--followup-outline)] data-[state=on]:bg-moon/35",
  C: "border-rose/50 bg-rose/10 data-[state=on]:border-rose data-[state=on]:bg-rose/25",
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
  return <div data-followup-contact-facts className="flex min-w-0 flex-wrap items-start gap-x-8 gap-y-3">
    <div className="space-y-1.5">
      <Label htmlFor={`${id}-wechat`} className="text-xs">{t("wechatFact")}</Label>
      <div className="flex min-h-9 items-center gap-2">
        <Switch id={`${id}-wechat`} checked={wechat === true} onCheckedChange={onWechatChange} disabled={disabled}
          aria-describedby={wechat === null ? `${id}-unknown` : undefined}
          className={cn("data-[state=checked]:bg-leaf-deep", wechat === null ? "data-[state=unchecked]:bg-muted/40" : "data-[state=unchecked]:bg-rose")} />
        <Label htmlFor={`${id}-wechat`} className="text-xs">{entryT(wechat === null ? "wechatUnknown" : wechat ? "wechatYes" : "wechatNo")}</Label>
      </div>
      {wechat === null ? <p id={`${id}-unknown`} className="max-w-56 text-[11px] text-muted">{entryT("wechatUnknownHint")}
        <button type="button" disabled={disabled} onClick={() => onWechatChange(false)} className="ml-1 text-rose underline underline-offset-2 disabled:opacity-50">{entryT("wechatConfirmNo")}</button>
      </p> : null}
    </div>
    <div className="space-y-1.5">
      <p id={`${id}-interest`} className="text-xs font-medium">{t("interestLevel")}</p>
      <TooltipProvider delayDuration={200}>
        <ToggleGroup type="single" value={interest} onValueChange={(value) => onInterestChange(value as LeadInterestLevel | "")}
          disabled={disabled} aria-labelledby={`${id}-interest`} className="justify-start gap-2">
          {(["A", "B", "C"] as const).map((level) => <Tooltip key={level}>
            <TooltipTrigger asChild><ToggleGroupItem value={level} aria-label={t(`interest_${level}`)}
              className={cn("h-9 min-w-14 gap-1 border text-ink data-[state=on]:ring-1 data-[state=on]:ring-current", interestColors[level])}>
              {interest === level ? <Check aria-hidden className="size-3" /> : null}{level}
            </ToggleGroupItem></TooltipTrigger>
            <TooltipContent>{t(`interest_${level}`)}</TooltipContent>
          </Tooltip>)}
        </ToggleGroup>
      </TooltipProvider>
    </div>
  </div>;
}
