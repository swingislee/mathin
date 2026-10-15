"use client";
import type { ReactNode } from "react";
import {
  BarChart3, BookOpen, CalendarCheck, CalendarDays, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, ClipboardList, Compass, FileText, ImageIcon, Music, Pause, Play,
  Search, Shield, SkipBack, SkipForward, Sparkles, Star, Ticket, UploadCloud, UserRound, Users, Video, XCircle, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { RuntimeBlockView, RuntimeField, RuntimeItem, RuntimeListTemplate, RuntimeTab } from "../../../../contracts/participant-api/runtime";

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

type Select = { selected: string; onSelect?: (id: string) => void; inCard?: boolean;
  /** The tab shown for each tabs block; choosing a tab on the canvas also chooses where new blocks go. */
  openTabs?: Record<string, string>; onOpenTab?: (block: string, tab: string) => void };
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
function Row({ item, template }: { item: RuntimeItem; template: RuntimeListTemplate }) {
  if (template === "timeline") return <div className="flex gap-2 border-b border-[#efece2] py-2.5 last:border-0">
    <div className="w-12 shrink-0 text-[10px] text-[#766f65]">{item.date.slice(5)}<div className="text-xs font-semibold text-[#29251f]">{item.start}</div></div>
    <div className="mt-1.5 size-2.5 shrink-0 rounded-full bg-[#6f8b48]" />
    <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{item.title}</p>{item.subtitle && <p className="text-xs text-[#766f65]">{item.subtitle}</p>}{item.summary && <p className="line-clamp-2 text-xs text-[#766f65]">{item.summary}</p>}
      <div className="mt-1 flex gap-1">{item.status && <span className="rounded-full bg-[#f1efe8] px-2 text-[10px] text-[#766f65]">{item.status.label}</span>}{item.stamp && <span className="rounded border border-[#c94a4f] px-1 text-[10px] text-[#c94a4f]">{item.stamp}</span>}</div></div>
  </div>;
  if (template === "message") return <div className={cn("my-2 flex", item.side === "end" && "justify-end")}><div className={cn("max-w-[78%] rounded-2xl px-3 py-2 text-xs", item.side === "end" ? "bg-[#eef2e4]" : "bg-[#f1efe8]")}>
    {item.title && <p className="font-semibold">{item.title}</p>}{item.summary && <p className="whitespace-pre-wrap">{item.summary}</p>}<p className="mt-0.5 text-[10px] text-[#766f65]">{item.subtitle}{item.status ? ` · ${item.status.label}` : ""}</p></div></div>;
  if (template === "tile" || template === "carousel") return <div className={cn("shrink-0 rounded-xl bg-white p-2 shadow-sm", template === "carousel" ? "w-32" : "")}>
    <div className="mb-1 h-16 overflow-hidden rounded-lg bg-[#eef2e4]">{item.image ? <img src={item.image} alt="" className="size-full object-cover" /> /* eslint-disable-line @next/next/no-img-element */ : <Sparkles className="m-5 size-5 text-[#6f8b48]" />}</div>
    <p className="line-clamp-2 text-xs font-semibold">{item.title}</p>{(item.subtitle || item.meta.length > 0) && <p className="text-[10px] text-[#766f65]">{item.subtitle || item.meta.join(" · ")}</p>}</div>;
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

/** One question drawn as on the phone; values are not entered on the canvas. */
function FieldPreview({ field }: { field: RuntimeField }) {
  const box = "mt-1 flex min-h-8 items-center justify-between rounded-lg border border-[#e4e0d4] bg-[#f6f4ee] px-2.5 text-xs text-[#a29b8f]";
  return <div className="mt-2.5"><p className="text-xs">{field.label}{field.required && <span className="text-[#c94a4f]"> *</span>}</p>
    {field.kind === "textarea" ? <div className={cn(box, "h-14 items-start pt-1.5")}>{field.placeholder}</div>
      : (field.kind === "select" || field.kind === "multiselect") && (field.display === "pills" || field.kind === "multiselect")
        ? <div className="mt-1 flex flex-wrap gap-1.5">{field.options.map(option => <span key={option.value} className={cn("rounded-full border border-[#e4e0d4] px-2.5 py-1 text-[11px]", option.disabled && "opacity-40")}>{option.label}</span>)}</div>
      : field.kind === "rating" ? <div className="mt-1 flex gap-1 text-[#e4e0d4]">{Array.from({ length: field.max || 5 }, (_, i) => <Star key={i} className="size-5" />)}</div>
      : field.kind === "media" ? <div className="mt-1 flex size-16 flex-col items-center justify-center rounded-lg border border-dashed border-[#d9d4c6] text-[10px] text-[#a29b8f]"><UploadCloud className="size-4" />{field.accept.includes("file") ? "文件" : "照片"}</div>
      : field.kind === "consent" ? <label className="mt-1 flex items-center gap-1.5 text-xs"><span className="size-3.5 rounded border border-[#a29b8f]" />{field.placeholder || "我已确认"}</label>
      : <div className={box}>{field.placeholder || (["select", "date", "time", "address"].includes(field.kind) ? "请选择" : "")}{["select", "date", "time", "address"].includes(field.kind) && <ChevronDown className="size-3" />}</div>}
    {field.help && <p className="mt-1 text-[10px] text-[#766f65]">{field.help}</p>}</div>;
}
function DataState({ state, message, signIn }: { state: string; message: string; signIn: string }) {
  return state === "ready" ? null : <State state={state} message={message} empty="" signIn={signIn} />;
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
    case "list": return frame(<div className={block.template === "tile" || block.template === "carousel" ? "" : card}><Heading title={block.title} more={block.more} />
      {block.facets.some(facet => facet.kind === "search") && <div className="mb-1.5 flex items-center gap-1.5 rounded-full bg-[#f1efe8] px-3 py-1.5 text-xs text-[#a29b8f]"><Search className="size-3.5" />{block.facets.find(facet => facet.kind === "search")?.hint}</div>}
      {block.facets.some(facet => facet.kind !== "search") && <div className="mb-1 flex gap-4 text-xs font-medium">{block.facets.filter(facet => facet.kind !== "search").map(facet => <span key={facet.id} className="flex items-center gap-0.5">{facet.value ? facet.valueLabel : facet.label}<ChevronDown className="size-3" /></span>)}</div>}
      {block.state === "ready" && block.items.length
        ? <div className={block.template === "tile" ? "grid grid-cols-2 gap-2" : block.template === "carousel" ? "flex gap-2 overflow-x-auto" : ""}>{block.items.map(item => <Row key={item.id} item={item} template={block.template} />)}</div>
        : <State state={block.state} message={block.message} empty={block.empty} signIn={strings.signIn} />}
      {block.next && <p className="py-1.5 text-center text-xs text-[#6f8b48]">{strings.more || "加载更多"}</p>}</div>);
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
    case "tabs": {
      const open = block.tabs.find(tab => tab.id === select.openTabs?.[block.id]) ?? block.tabs[0];
      return frame(<div><div className="mb-2 flex gap-1 rounded-full bg-[#ece9df] p-1">{block.tabs.map(tab => <button type="button" key={tab.id}
        onClick={event => { event.stopPropagation(); select.onOpenTab?.(block.id, tab.id); select.onSelect?.(block.id); }}
        className={cn("flex-1 rounded-full py-1 text-xs", tab.id === open?.id ? "bg-white font-semibold shadow-sm" : "text-[#766f65]")}>{tab.label}</button>)}</div>
        {open && <Blocks blocks={open.blocks} strings={strings} {...select} />}</div>);
    }
    case "collapse": return frame(<div className={card}><div className="flex items-center justify-between py-1"><span><p className="text-sm font-semibold">{block.title}</p>{block.summary && <p className="text-xs text-[#766f65]">{block.summary}</p>}</span>{block.open ? <ChevronUp className="size-4 text-[#a29b8f]" /> : <ChevronDown className="size-4 text-[#a29b8f]" />}</div>
      <div className="mt-2 border-t border-[#efece2] pt-2"><Blocks blocks={block.blocks} strings={strings} {...select} inCard /></div></div>);
    case "video": return frame(<div>{block.title && <Heading title={block.title} />}<div className="flex aspect-video items-center justify-center rounded-2xl bg-[#29251f] text-white">{block.poster ? <img src={block.poster.includes("preview=1") ? block.poster : block.poster + "&preview=1"} alt="" className="size-full rounded-2xl object-cover opacity-80" /> /* eslint-disable-line @next/next/no-img-element */ : <Video className="size-8" />}</div></div>);
    case "audio": return frame(<div className={card}><Heading title={block.title} />{block.tracks.length ? block.tracks.map((track, i) => <div key={track.id} className="flex items-center gap-2 border-b border-[#efece2] py-2 last:border-0">
      <span className={cn("flex size-7 items-center justify-center rounded-full", i ? "bg-[#eef2e4] text-[#6f8b48]" : "bg-[#6f8b48] text-white")}>{i ? <Play className="size-3" /> : <Pause className="size-3" />}</span><span className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{track.title}</p>{track.subtitle && <p className="text-[11px] text-[#766f65]">{track.subtitle}</p>}</span></div>)
      : <p className="flex items-center gap-1.5 py-3 text-xs text-[#8a9a6a]"><Music className="size-4" />{block.state === "ready" ? "还没有音频" : block.message}</p>}
      {block.tracks.length > 0 && <div className="flex items-center justify-center gap-6 pt-2 text-[#766f65]"><SkipBack className="size-4" /><span className="flex size-9 items-center justify-center rounded-full bg-[#6f8b48] text-white"><Pause className="size-4" /></span><SkipForward className="size-4" /></div>}</div>);
    case "card": return frame(<div className={cn("rounded-2xl p-4", block.style === "credential" ? "bg-gradient-to-br from-[#6f8b48] to-[#4f6a31] text-white" : block.style === "certificate" ? "border-4 border-double border-[#d6b45a] bg-gradient-to-b from-[#fffaf0] to-[#f7ecd2] text-center" : "bg-white")}>
      {block.state !== "ready" ? <DataState state={block.state} message={block.message} signIn={strings.signIn} /> : <>
        <div className={cn("flex items-start justify-between gap-2", block.style === "certificate" && "flex-col items-center")}><span><p className={cn("text-lg font-bold", block.style === "certificate" && "tracking-widest text-[#8a6a1f]")}>{block.title}</p>{block.subtitle && <p className="text-xs opacity-80">{block.subtitle}</p>}</span>
          {block.stamp && <span className={cn("-rotate-6 rounded border-2 px-2 text-xs", block.style === "certificate" ? "border-[#c94a4f] text-[#c94a4f]" : "border-current")}>{block.stamp}</span>}</div>
        {block.fields.length > 0 && <div className={cn("mt-3 grid grid-cols-2 gap-2", block.style === "certificate" && "text-left")}>{block.fields.map(row => <div key={row.label}><p className="text-[10px] opacity-75">{row.label}</p><p className="text-sm font-semibold">{row.value}</p></div>)}</div>}
        {block.image && <Picture value={block.image} className="mx-auto mt-3 size-28 bg-white" />}</>}</div>);
    case "metrics": return frame(<div className={card}><Heading title={block.title} />{block.state !== "ready" ? <DataState state={block.state} message={block.message} signIn={strings.signIn} />
      : <div className={cn("grid gap-2", block.columns === 3 ? "grid-cols-3" : block.columns === 4 ? "grid-cols-4" : "grid-cols-2")}>{block.items.map(item => <div key={item.label} className="rounded-xl bg-[#f1efe8] p-2"><p className="text-lg font-bold text-[#6f8b48]">{item.value}<span className="ml-0.5 text-[10px] font-normal text-[#766f65]">{item.unit}</span></p><p className="text-[11px]">{item.label}</p></div>)}
        {!block.items.length && <p className="col-span-full py-3 text-center text-xs text-[#8a9a6a]">由 Mathin 按账号读取</p>}</div>}</div>);
    case "chart": return frame(<div className={card}><Heading title={block.title} />{block.state !== "ready" ? <DataState state={block.state} message={block.message} signIn={strings.signIn} /> : <>
      <img src={block.image} alt="" className="w-full" /> {/* eslint-disable-line @next/next/no-img-element */}
      {block.legend.length > 0 && <div className="flex flex-wrap justify-center gap-3 text-[11px] text-[#766f65]">{block.legend.map(item => <span key={item.label} className="flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: item.color }} />{item.label}</span>)}</div>}
      {block.caption && <p className="mt-2 text-xs text-[#766f65]">{block.caption}</p>}</>}</div>);
    case "progress": return frame(<div className={card}><Heading title={block.title} />{block.state !== "ready" ? <DataState state={block.state} message={block.message} signIn={strings.signIn} />
      : block.items.length ? block.items.map(item => <div key={item.label} className="mt-2"><div className="flex justify-between text-xs"><span>{item.label}</span><span className="text-[#766f65]">{item.caption || item.percent + "%"}</span></div><div className="mt-1 h-2 overflow-hidden rounded-full bg-[#f1efe8]"><div className="h-full rounded-full bg-[#6f8b48]" style={{ width: item.percent + "%" }} /></div></div>)
      : <p className="py-3 text-center text-xs text-[#8a9a6a]">由 Mathin 按账号读取</p>}</div>);
    case "badges": return frame(<div className={card}><Heading title={block.title} />{block.state !== "ready" ? <DataState state={block.state} message={block.message} signIn={strings.signIn} />
      : <div className={cn("grid gap-2", block.columns === 3 ? "grid-cols-3" : block.columns === 5 ? "grid-cols-5" : "grid-cols-4")}>{block.items.map(item => <div key={item.id} className={cn("flex flex-col items-center gap-1 text-center text-[11px]", !item.earned && "opacity-35 grayscale")}><RuntimeIcon value={item.image} className="size-9 text-[#d6b45a]" />{item.label}</div>)}</div>}</div>);
    case "table": return frame(<div className={card}><Heading title={block.title} />{block.state !== "ready" ? <DataState state={block.state} message={block.message} signIn={strings.signIn} />
      : <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="bg-[#f1efe8]">{block.columns.map(column => <th key={column} className="px-2 py-1.5 text-left font-semibold">{column}</th>)}</tr></thead>
        <tbody>{block.rows.map((row, i) => <tr key={i} className="border-b border-[#efece2]">{row.map((cell, j) => <td key={j} className="px-2 py-1.5">{cell}</td>)}</tr>)}</tbody></table></div>}</div>);
    case "form": return frame(<div className={card}>{block.title && <Heading title={block.title} />}{block.intro && <p className="text-xs text-[#766f65]">{block.intro}</p>}
      {block.state === "signedOut" ? <State state="signedOut" message={block.message} empty="" signIn={strings.signIn} /> : <>
        {block.groups.map(group => <div key={group.id}>{group.title && <p className="mt-3 text-sm font-semibold">{group.title}</p>}{group.fields.map(field => <FieldPreview key={field.id} field={field} />)}</div>)}
        <div className="mt-4 rounded-full bg-[#6f8b48] py-2 text-center text-sm text-white">{block.submitLabel}</div></>}</div>);
    case "bar": return frame(<div className="flex gap-2 rounded-2xl border border-dashed border-[#d9d4c6] bg-white p-2">{block.buttons.map(button => <span key={button.id} className={cn("flex-1 rounded-full py-2 text-center text-sm", button.appearance === "primary" ? "bg-[#6f8b48] text-white" : "bg-[#eef2e4] text-[#6f8b48]")}>{button.label}</span>)}</div>);
    default: return block.fallback ? frame(<p className="text-xs text-[#766f65]">{block.fallback}</p>) : null;
  }
}

export function RuntimePhone({ title, brand, blocks, tabs, activeScreen, strings, selected, onSelect, onTab, onTitle, openTabs, onOpenTab }: Select & {
  title: string; brand: boolean; blocks: RuntimeBlockView[]; tabs: RuntimeTab[]; activeScreen: string; strings: Record<string, string>; onTab?: (screen: string) => void;
  /** Clicking the brand name opens its settings. */
  onTitle?: () => void;
}) {
  return <div className="mx-auto flex h-full max-h-[760px] w-[375px] max-w-full flex-col overflow-hidden rounded-[36px] border border-[#d9d4c6] bg-gradient-to-br from-[#e7ecd9] via-[#f4f2e7] to-[#f6efdc] text-[#29251f] shadow-sm">
    <div className={cn("flex h-14 shrink-0 items-end px-4 pb-2 text-base font-semibold", brand ? "justify-start" : "justify-center")}>
      {brand && onTitle ? <button type="button" onClick={onTitle} title={strings.brandSettings} className="-mx-1 rounded-md px-1 hover:bg-[#6f8b48]/10 hover:text-[#6f8b48]">{title}</button> : title}</div>
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4" onClick={() => onSelect?.("")}>
      <Blocks blocks={blocks} strings={strings} selected={selected} onSelect={onSelect} openTabs={openTabs} onOpenTab={onOpenTab} />
    </div>
    {tabs.length > 0 && <div className="flex h-14 shrink-0 border-t border-[#ece8dc] bg-white">{tabs.map(tab => <button type="button" key={tab.slot} onClick={() => onTab?.(tab.screen)}
      className={cn("flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px]", tab.screen === activeScreen ? "text-[#6f8b48]" : "text-[#766f65]")}><RuntimeIcon value={tab.icon} className="size-5" />{tab.label}</button>)}</div>}
  </div>;
}
