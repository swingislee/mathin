"use client";
import type { ReactNode } from "react";
import {
  BarChart3, BookOpen, CalendarCheck, CalendarDays, CheckCircle2, ChevronDown, ChevronRight, ClipboardList, Compass, FileText, ImageIcon,
  Shield, Sparkles, Ticket, UserRound, Users, XCircle, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { RuntimeBlockView, RuntimeItem, RuntimeTab } from "../../../../contracts/participant-api/runtime";

/** Bundled Mini Program icons drawn with the matching line icons on the web canvas. */
const icons: Record<string, LucideIcon> = {
  discover: Compass, calendar: CalendarDays, account: UserRound, activity: Sparkles, book: BookOpen, report: BarChart3, task: ClipboardList,
  participants: Users, form: FileText, privacy: Shield, reservations: CalendarCheck, complete: CheckCircle2, ticket: Ticket, cancel: XCircle, appointment: BarChart3,
};
export function RuntimeIcon({ value, className }: { value: string; className?: string }) {
  if (value.startsWith("/api/")) return <img src={value} alt="" className={cn("object-contain", className)} />; // eslint-disable-line @next/next/no-img-element
  const name = value.replace(/^asset:/, "").split("/").pop()?.replace(/-active$/, "") || "";
  const Icon = icons[name] ?? ImageIcon;
  return <Icon className={className} aria-hidden />;
}
function Picture({ value, className, fit = "width" }: { value: string; className?: string; fit?: "width" | "cover" }) {
  if (value.startsWith("/api/")) return <img src={value.includes("preview=1") ? value : value + "&preview=1"} alt="" className={cn("block w-full rounded-2xl", fit === "cover" ? "h-40 object-cover" : "h-auto", className)} />; // eslint-disable-line @next/next/no-img-element
  return <div className={cn("flex items-center justify-center rounded-2xl bg-[#e6ecd8] text-[#6f8b48]", fit === "cover" ? "h-40" : "h-28", className)}><RuntimeIcon value={value || "asset:activity"} className="size-10" /></div>;
}

type Select = { selected: string; onSelect?: (id: string) => void; inCard?: boolean };
function Frame({ id, selected, onSelect, children, className }: Select & { id: string; children: ReactNode; className?: string }) {
  const active = selected === id;
  return <div data-runtime-block={id} onClick={event => { if (!onSelect) return; event.stopPropagation(); onSelect(id); }}
    className={cn("relative mb-3 rounded-2xl transition-shadow", onSelect && "cursor-pointer hover:ring-2 hover:ring-[#6f8b48]/30",
      active && "ring-2 ring-[#6f8b48] ring-offset-2 ring-offset-[#f1efe3]", className)}>{children}</div>;
}
const card = "rounded-2xl bg-white px-4 py-3 shadow-[0_1px_0_rgba(41,37,31,0.04)]";
function Heading({ title, more }: { title: string; more?: { label: string } | null }) {
  if (!title && !more) return null;
  return <div className="mb-2 flex items-center justify-between gap-2">
    <span className="flex items-center gap-2 text-[15px] font-semibold text-[#29251f]">{title && <span className="h-3.5 w-1 rounded-full bg-[#d6b45a]" />}{title}</span>
    {more && <span className="flex items-center text-xs text-[#6f8b48]">{more.label}<ChevronRight className="size-3.5" /></span>}
  </div>;
}
function State({ state, message, empty, signIn }: { state: string; message: string; empty: string; signIn: string }) {
  if (state === "signedOut") return <div className="flex items-center justify-between gap-3 py-2 text-xs text-[#766f65]">{message}<span className="shrink-0 rounded-full bg-[#6f8b48] px-3 py-1 text-white">{signIn}</span></div>;
  if (state === "error") return <p className="py-2 text-xs text-[#a34854]">{message}</p>;
  return <p className="py-6 text-center text-xs text-[#8a9a6a]">{empty}</p>;
}
function Row({ item, template }: { item: RuntimeItem; template: "card" | "row" }) {
  if (template === "card") return <div className="flex gap-3 border-b border-[#efece2] py-3 last:border-0">
    <div className="size-16 shrink-0 overflow-hidden rounded-xl bg-[#eef2e4]">{item.image ? <img src={item.image} alt="" className="size-full object-cover" /> /* eslint-disable-line @next/next/no-img-element */ : <Sparkles className="m-5 size-6 text-[#6f8b48]" />}</div>
    <div className="min-w-0 flex-1"><p className="line-clamp-2 text-sm font-semibold">{item.title}</p>{item.summary && <p className="line-clamp-2 text-xs text-[#766f65]">{item.summary}</p>}
      {item.meta.length > 0 && <p className="mt-1 text-xs text-[#766f65]">{item.meta.join(" · ")}</p>}
      <div className="mt-1 flex flex-wrap gap-1">{item.tags.map(tag => <span key={tag} className="rounded-full bg-[#eef2e4] px-2 text-[10px] text-[#6f8b48]">{tag}</span>)}</div>
      {item.actionLabel && <div className="mt-1 flex justify-end"><span className="rounded-full bg-[#eef2e4] px-2 py-0.5 text-[11px] text-[#6f8b48]">{item.actionLabel}</span></div>}</div>
  </div>;
  return <div className="flex items-center gap-2 border-b border-[#efece2] py-2.5 last:border-0">
    <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{item.title}</p>{item.subtitle && <p className="text-xs text-[#766f65]">{item.subtitle}</p>}
      {item.meta.length > 0 && <p className="text-xs text-[#766f65]">{item.meta.join(" · ")}</p>}{item.summary && <p className="line-clamp-2 text-xs text-[#766f65]">{item.summary}</p>}</div>
    {item.status && <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px]", item.status.tone === "positive" ? "bg-[#eef2e4] text-[#6f8b48]" : item.status.tone === "warning" ? "bg-[#f8e5e6] text-[#a34854]" : "bg-[#f1efe8] text-[#766f65]")}>{item.status.label}</span>}
    {item.action && <ChevronRight className="size-3.5 shrink-0 text-[#a29b8f]" />}
  </div>;
}

function Blocks({ blocks, strings, ...select }: Select & { blocks: RuntimeBlockView[]; strings: Record<string, string> }) {
  return <>{blocks.map((block, index) => <Block key={block.id} block={block} index={index} strings={strings} {...select} />)}</>;
}
function Block({ block, strings, index, inCard, ...select }: Select & { block: RuntimeBlockView; strings: Record<string, string>; index: number }) {
  const frame = (children: ReactNode, className?: string) => <Frame id={block.id} {...select} className={className}>{children}</Frame>;
  switch (block.type) {
    case "section": return block.style === "row"
      ? frame(<div className="flex items-stretch gap-2.5 [&>*]:mb-0">{block.blocks.map((row, rowIndex) => <div key={row.id} className={row.type === "feature" ? "w-[39%] shrink-0" : "min-w-0 flex-1"}><Block block={row} index={rowIndex} strings={strings} {...select} /></div>)}</div>)
      : frame(<div className={block.style === "card" ? card : ""}><Heading title={block.title} more={block.more} /><Blocks blocks={block.blocks} strings={strings} {...select} inCard={block.style === "card"} /></div>);
    case "filters": return frame(<div className="flex items-center gap-2">{block.facets.map(facet => <span key={facet.id} className="flex flex-1 items-center justify-center gap-0.5 rounded-full bg-white py-2 text-xs font-medium">{facet.value ? facet.valueLabel : facet.label}<ChevronDown className="size-3" /></span>)}
      {block.active && <span className="shrink-0 text-xs text-[#6f8b48]">{block.clearLabel}</span>}</div>);
    case "text": return frame(<p className={cn("whitespace-pre-wrap px-1 text-sm leading-relaxed", block.tone === "muted" && "text-xs text-[#766f65]", block.tone === "notice" && "rounded-xl bg-[#eef2e4] px-3 py-2")}>{block.text}</p>);
    case "image": return frame(<Picture value={block.image} fit={block.fit} />);
    case "feature": return block.style === "tile"
      ? frame(<div className="relative h-full min-h-[106px] overflow-hidden rounded-2xl bg-gradient-to-br from-[#d7e6c7] to-white p-3.5"><p className="mb-3 text-xl font-semibold text-[#6f8b48]">{block.title}</p>{block.body && <span className="rounded-full bg-[#6f8b48] px-2.5 py-0.5 text-xs text-white">{block.body}</span>}<RuntimeIcon value={block.image} className="absolute -bottom-3 -right-3 size-16 rotate-[-12deg] opacity-10" /></div>, "h-full")
      : frame(<div className={cn(card, "flex items-center gap-3")}><Picture value={block.image} className="size-16 shrink-0" />
      <div className="min-w-0 flex-1"><p className="text-[15px] font-semibold">{block.title}</p>{block.body && <span className="mt-1 inline-block rounded-full bg-[#6f8b48] px-2.5 py-0.5 text-xs text-white">{block.body}</span>}</div>
      {block.action && <ChevronRight className="size-4 text-[#a29b8f]" />}</div>);
    case "entries": return block.style === "floating"
      ? frame(<div className="ml-auto w-16 rounded-xl bg-white py-1 shadow-md">{block.items.map(item => <div key={item.id} className="flex flex-col items-center gap-1 border-b border-[#efece2] px-1 py-2 text-center text-[10px] text-[#766f65] last:border-0"><RuntimeIcon value={item.icon} className="size-5" />{item.label}</div>)}</div>, "flex justify-end")
      : frame(<div className={inCard ? (index ? "mt-4" : "") : card}><Heading title={block.title} /><div className="grid grid-cols-4 gap-y-3">{block.items.map(item => <div key={item.id} className="flex flex-col items-center gap-1.5 text-center text-xs"><RuntimeIcon value={item.icon} className="size-6 text-[#5a5248]" />{item.label}</div>)}</div></div>);
    case "list": return frame(<div className={card}><Heading title={block.title} more={block.more} />
      {block.facets.length > 0 && <div className="mb-1 flex gap-4 text-xs font-medium">{block.facets.map(facet => <span key={facet.id} className="flex items-center gap-0.5">{facet.value ? facet.valueLabel : facet.label}<ChevronDown className="size-3" /></span>)}</div>}
      {block.state === "ready" && block.items.length ? block.items.map(item => <Row key={item.id} item={item} template={block.template} />) : <State state={block.state} message={block.message} empty={block.empty} signIn={strings.signIn} />}</div>);
    case "participants": if (block.style === "picker") return frame(<div className="flex items-center gap-2 px-1 text-sm"><span className="flex size-8 items-center justify-center rounded-full bg-[#fbecc0]"><Users className="size-4 text-[#b88a2a]" /></span>
      <span className="flex flex-col"><span>{block.participants.find(row => row.id === block.selected)?.name || strings.chooseParticipant || "选择参与人"}</span>{block.participants.find(row => row.id === block.selected)?.detail && <span className="text-[11px] text-[#766f65]">{block.participants.find(row => row.id === block.selected)?.detail}</span>}</span><ChevronDown className="ml-auto size-3.5 text-[#a29b8f]" /></div>);
      if (block.style === "tile") return frame(<div className={cn(card, "h-full min-h-[106px]")}><div className="flex items-center justify-between text-sm font-semibold">{block.title}<span className="flex items-center text-[11px] font-normal text-[#6f8b48]">{strings.view || "查看"}<ChevronRight className="size-3" /></span></div>
        <div className="mt-2 flex justify-around">{block.participants.length ? block.participants.slice(0, 2).map(row => <span key={row.id} className="flex flex-col items-center gap-1 text-xs"><span className="flex size-9 items-center justify-center rounded-full bg-[#fbecc0]"><Users className="size-4 text-[#b88a2a]" /></span>{row.name}</span>)
          : <span className="flex flex-col items-center gap-1 text-xs text-[#766f65]"><span className="flex size-9 items-center justify-center rounded-full bg-[#fbecc0]"><Users className="size-4 text-[#b88a2a]" /></span>{block.state === "signedOut" ? strings.signInNow || "点击登录" : block.empty}</span>}</div></div>, "h-full");
      return frame(<div className={card}>{block.title && <Heading title={block.title} />}
      {block.state === "signedOut" ? <State state="signedOut" message={block.message} empty="" signIn={strings.signIn} /> : block.participants.length
        ? <div className="flex gap-2">{block.participants.map(row => <span key={row.id} className={cn("rounded-full border px-3 py-1 text-xs", row.id === block.selected ? "border-[#6f8b48] bg-[#eef2e4] text-[#6f8b48]" : "border-[#e4e0d4]")}>{row.name}</span>)}</div>
        : <p className="text-xs text-[#766f65]">{block.empty}</p>}</div>);
    case "calendar": {
      const today = block.days.find(day => day.today)?.date || block.days[0]?.date, weekdays = (strings.weekdays || "").split(",");
      const items = block.items.filter(item => item.date === today);
      return frame(<div className={card}><Heading title={block.title} more={block.more} />
        <div className="grid grid-cols-7 text-center text-[11px]">{block.days.map(day => <div key={day.date} className={cn("rounded-lg py-1", day.date === today && "bg-[#fbecc0]")}><div className="text-[#a29b8f]">{weekdays[day.weekday]}</div><div>{day.today ? strings.today : day.day}</div>{day.count > 0 && <div className="mx-auto size-1 rounded-full bg-[#6f8b48]" />}</div>)}</div>
        {block.state === "signedOut" ? <div className="mt-3 rounded-full bg-[#6f8b48] py-2 text-center text-sm text-white">{block.signInLabel}</div> : block.state !== "ready" ? <State state={block.state} message={block.message} empty="" signIn={strings.signIn} />
          : items.length ? items.map(item => <div key={item.id} className="mt-2 flex gap-3 rounded-xl bg-[#eef2e4] p-2.5 text-xs"><div className="w-14 shrink-0 text-[#6f8b48]"><div>{item.status?.label}</div><div className="text-sm font-semibold">{item.start}</div>{item.end && <div>~{item.end}</div>}</div><div><p className="text-sm font-semibold">{item.title}</p><p className="text-[#766f65]">{item.meta.join(" · ")}</p></div></div>)
          : <p className="py-4 text-center text-xs text-[#8a9a6a]">{block.empty}</p>}</div>);
    }
    case "account": return frame(<div className="flex items-center justify-between py-1"><span className="flex items-center gap-3 text-base font-semibold"><span className="flex size-11 items-center justify-center rounded-full bg-[#e6ecd8]"><UserRound className="size-6 text-[#6f8b48]" /></span>{block.signedIn ? block.name : block.prompt}<ChevronRight className="size-4 text-[#a29b8f]" /></span>
      {block.trailing && <span className="rounded-full bg-[#6f8b48] px-3 py-1 text-xs text-white">{block.trailing.label}</span>}</div>);
    case "content": return frame(<div className={cn(card, "flex items-center gap-2 text-xs text-[#766f65]")}><FileText className="size-4" />{block.pageId}</div>);
    case "button": return frame(<div className={cn("w-full rounded-full py-2.5 text-center text-sm", block.appearance === "primary" ? "bg-[#6f8b48] text-white" : block.appearance === "secondary" ? "border border-[#e4e0d4] bg-white" : "text-[#766f65]")}>{block.label}</div>);
    case "divider": return frame(<div className="my-2 h-px bg-[#e4e0d4]" />);
    default: return block.fallback ? frame(<p className="text-xs text-[#766f65]">{block.fallback}</p>) : null;
  }
}

export function RuntimePhone({ title, brand, blocks, tabs, activeScreen, strings, selected, onSelect, onTab, onTitle }: Select & {
  title: string; brand: boolean; blocks: RuntimeBlockView[]; tabs: RuntimeTab[]; activeScreen: string; strings: Record<string, string>; onTab?: (screen: string) => void;
  /** Clicking the brand name opens its settings. */
  onTitle?: () => void;
}) {
  return <div className="mx-auto flex h-full max-h-[760px] w-[375px] max-w-full flex-col overflow-hidden rounded-[36px] border border-[#d9d4c6] bg-gradient-to-br from-[#e7ecd9] via-[#f4f2e7] to-[#f6efdc] text-[#29251f] shadow-sm">
    <div className={cn("flex h-14 shrink-0 items-end px-4 pb-2 text-base font-semibold", brand ? "justify-start" : "justify-center")}>
      {brand && onTitle ? <button type="button" onClick={onTitle} title={strings.brandSettings} className="-mx-1 rounded-md px-1 hover:bg-[#6f8b48]/10 hover:text-[#6f8b48]">{title}</button> : title}</div>
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4" onClick={() => onSelect?.("")}>
      <Blocks blocks={blocks} strings={strings} selected={selected} onSelect={onSelect} />
    </div>
    {tabs.length > 0 && <div className="flex h-14 shrink-0 border-t border-[#ece8dc] bg-white">{tabs.map(tab => <button type="button" key={tab.slot} onClick={() => onTab?.(tab.screen)}
      className={cn("flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px]", tab.screen === activeScreen ? "text-[#6f8b48]" : "text-[#766f65]")}><RuntimeIcon value={tab.icon} className="size-5" />{tab.label}</button>)}</div>}
  </div>;
}
