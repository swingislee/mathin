"use client";

import { Check } from "lucide-react";
import { useId } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { LeadInterestLevel } from "./lead-contract";

const interestColors = {
  A: "bg-leaf/15 hover:bg-leaf/25 data-[state=on]:border-leaf-deep data-[state=on]:bg-leaf/35",
  B: "bg-moon/20 hover:bg-moon/30 data-[state=on]:border-[var(--followup-outline)] data-[state=on]:bg-moon/35",
  C: "bg-rose/10 hover:bg-rose/20 data-[state=on]:border-rose data-[state=on]:bg-rose/25",
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
  return <div data-followup-contact-facts className="flex min-w-0 flex-wrap items-center gap-x-7 gap-y-2">
    <div className="flex min-h-8 flex-wrap items-center gap-2">
      <Label htmlFor={`${id}-wechat`} className="mr-1 text-xs text-muted">{entryT("wechatLabel")}</Label>
      <Switch id={`${id}-wechat`} checked={wechat === true} onCheckedChange={onWechatChange} disabled={disabled}
        aria-describedby={wechat === null ? `${id}-unknown` : undefined}
        className={cn("data-[state=checked]:bg-leaf-deep", wechat === null ? "data-[state=unchecked]:bg-muted/40" : "data-[state=unchecked]:bg-rose")} />
      <Label htmlFor={`${id}-wechat`} className="text-xs">{entryT(wechat === null ? "wechatUnknown" : wechat ? "wechatYes" : "wechatNo")}</Label>
      {wechat === null ? <>
        <span id={`${id}-unknown`} className="sr-only">{entryT("wechatUnknownHint")}</span>
        <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onWechatChange(false)}
          className="h-8 px-1 text-[11px] text-muted underline decoration-line underline-offset-4">{entryT("wechatConfirmNo")}</Button>
      </> : null}
    </div>
    <div className="flex min-h-8 items-center gap-3">
      <p id={`${id}-interest`} className="text-xs font-medium text-muted">{t("interestLevel")}</p>
      <TooltipProvider delayDuration={200}>
        <ToggleGroup type="single" value={interest} onValueChange={(value) => onInterestChange(value as LeadInterestLevel | "")}
          disabled={disabled} aria-labelledby={`${id}-interest`} size="sm" className="justify-start gap-1.5">
          {(["A", "B", "C"] as const).map((level) => <Tooltip key={level}>
            <TooltipTrigger asChild><ToggleGroupItem value={level} aria-label={t(`interest_${level}`)}
              className={cn("min-w-11 gap-1 border border-transparent text-xs text-ink", interestColors[level])}>
              {interest === level ? <Check aria-hidden className="size-3" /> : null}{level}
            </ToggleGroupItem></TooltipTrigger>
            <TooltipContent>{t(`interest_${level}`)}</TooltipContent>
          </Tooltip>)}
        </ToggleGroup>
      </TooltipProvider>
    </div>
  </div>;
}
