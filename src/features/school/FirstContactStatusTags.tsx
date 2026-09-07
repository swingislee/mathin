import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { LeadPoolRow } from "./lead-contract";
import { firstContactRowMessages } from "./first-contact-row-messages";
import type { FollowupTone } from "./dashboard-page/FollowupChoice";

export type FirstContactFacts = Pick<LeadPoolRow, "wechatAdded" | "interestLevel" | "visitCommitted">;
const tones: Record<FollowupTone, string> = {
  healthy: "border-leaf-deep/35 bg-leaf/20 text-leaf-deep",
  neutral: "border-line bg-line/20 text-muted",
  attention: "border-crater/40 bg-moon/30 text-ink",
  unhealthy: "border-rose/35 bg-cheek/25 text-rose",
};
const tagClass = "max-w-full whitespace-nowrap rounded-md px-1.5 py-0 text-[11px] leading-[18px]";

/** 主状态与已保存的联系事实分两层展示，草稿继续由登记区管理。 */
export function FirstContactStatusTags({ label, tone, facts, locale, dirty = false }: {
  label: string; tone: FollowupTone; facts?: FirstContactFacts; locale: string; dirty?: boolean;
}) {
  const m = firstContactRowMessages(locale);
  const tags = [
    ...(facts?.wechatAdded != null ? [{ key: "wechat", label: facts.wechatAdded ? m.wechatAdded : m.wechatMissing, tone: facts.wechatAdded ? "healthy" : "neutral" }] : []),
    ...(facts?.interestLevel ? [{ key: "interest", label: `${m.interest} ${facts.interestLevel}`, tone: facts.interestLevel === "A" ? "healthy" : facts.interestLevel === "B" ? "attention" : "neutral" }] : []),
    ...(facts?.visitCommitted ? [{ key: "visit", label: m.visitCommitted, tone: "attention" }] : []),
  ];
  return <div data-first-contact-status-tags className="min-w-0 space-y-0.5">
    <div className="flex min-w-0 items-center gap-1"><Badge variant="outline" className={cn(tagClass, tones[tone])} title={label}><span className="truncate">{label}</span></Badge>
      {dirty ? <span className="size-1.5 shrink-0 rounded-full bg-crater" role="img" aria-label={m.unsaved} title={m.unsaved} /> : null}
    </div>
    {tags.length ? <div className="flex min-w-0 items-center gap-1">{tags.map(tag => <Badge key={tag.key} variant="outline"
      data-first-contact-fact={tag.key} title={tag.label} className={cn(tagClass, "min-w-0 font-normal", tones[tag.tone as FollowupTone])}>
      <span className="truncate">{tag.label}</span>
    </Badge>)}</div> : null}
  </div>;
}
