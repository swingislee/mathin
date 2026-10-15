"use client";
/* eslint-disable @next/next/no-img-element -- Staff previews read authenticated image responses. */
import { useState, type ReactNode } from "react";
import { ChevronRight, ExternalLink, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { newId } from "@/lib/uuid";
import { localText, type ContentBlockKind, type ExperienceField } from "../../../../contracts/participant-api/miniapp-experience";
import { defaultBookingPolicy } from "../../../../contracts/participant-api/booking-policy";
import { moduleGroups } from "../../../../contracts/participant-api/miniapp-experience-catalog";
import { contentKindNames, newContentBlock } from "../../../../contracts/participant-api/miniapp-experience-templates";
import { miniappText, type MiniappContact, type MiniappSettings } from "../../../../contracts/participant-api/miniapp-settings";
import { addAssemblyField, assemblyNodes, documentNodes } from "@/features/school/miniapp-settings/assembly-model";
import { BookingPolicyEditor } from "@/features/school/miniapp-settings/BookingPolicyEditor";
import { ContactsEditor } from "@/features/school/miniapp-settings/ContactsEditor";
import { ExperienceContext } from "@/features/school/miniapp-settings/ExperienceContext";
import { ExperienceWorkbench } from "@/features/school/miniapp-settings/ExperienceWorkbench";
import { ReportTemplatesEditor } from "@/features/school/miniapp-settings/ReportTemplatesEditor";
import { StagesEditor } from "@/features/school/miniapp-settings/StagesEditor";
import { WorkbenchContext } from "@/features/school/miniapp-settings/WorkbenchContext";
import { NativePhonePreview } from "@/features/school/miniapp-settings/WorkspacePhonePreview";
import { LocalizedField, settingsField } from "@/features/school/miniapp-settings/fields";
import styles from "@/features/school/miniapp-settings/workbench.module.css";
import { libraryItems, libraryNames, moreSettings, type LibraryKind, type LibraryTarget, type Locale } from "./model";

export type LibraryUpload = (file: File, accept: (path: string) => void, qr?: boolean) => void;
export type ContactOptions = { campuses: { id: string; name: string }[]; legacy: MiniappContact[] };
type Change = (change: (value: MiniappSettings) => MiniappSettings) => void;
const L = (locale: Locale, zh: string, en: string) => locale === "zh" ? zh : en;
const groups: { zh: string; en: string; kinds: LibraryKind[] }[] = [
  { zh: "基础", en: "Basics", kinds: ["brand", "stages", "contacts"] },
  { zh: "预约", en: "Booking", kinds: ["booking"] },
  { zh: "内容", en: "Content", kinds: ["pages", "forms", "reports"] },
];
/** Library objects whose editor takes a selected part (`part`) on the preview. */
const withItems = (kind: LibraryKind) => kind === "pages" || kind === "forms" || kind === "reports";
const contactsOf = (settings: MiniappSettings, options?: ContactOptions) => settings.contacts ?? options?.legacy ?? [];
const qrImage = (path: string) => path.includes("/") ? `/api/v1/parent/advisors/qr?preview=1&path=${encodeURIComponent(path)}` : `/api/v1/participant/settings/image?preview=1&path=${encodeURIComponent(path)}`;

type Part = { part: string; label: string; kind: string; depth: number; visible?: boolean };
/** The selectable parts of an open library object, shown under it like the blocks of a page. */
export function libraryParts(settings: MiniappSettings, target: LibraryTarget, options: ContactOptions | undefined, locale: Locale): Part[] {
  const x = settings.experience!;
  switch (target.kind) {
    case "pages": case "reports": {
      const page = x.pages.find(row => row.id === target.id);
      return page ? documentNodes(page, locale).map(node => ({ part: node.part, label: node.label, kind: node.kind, depth: 0, visible: node.visible })) : [];
    }
    case "forms":
      return target.id ? assemblyNodes(settings, { kind: "form", id: target.id }, locale).flatMap(node => [
        { part: node.part, label: node.label, kind: node.kind, depth: 0 }, ...(node.children ?? []).map(child => ({ part: child.part, label: child.label, kind: child.kind, depth: 1 }))]) : [];
    case "contacts":
      return contactsOf(settings, options).map(row => ({ part: `contact:${row.id}`, label: miniappText(row.name, locale) || L(locale, "未命名联系人", "Unnamed contact"), kind: L(locale, "联系人", "Contact"), depth: 0, visible: row.visible }));
    case "stages":
      return settings.stages.flatMap(group => [{ part: `group:${group.id}`, label: miniappText(group.label, locale), kind: L(locale, "分组", "Group"), depth: 0 },
        ...group.stages.map(stage => ({ part: `stage:${stage.id}`, label: miniappText(stage.label, locale), kind: L(locale, "阶段", "Stage"), depth: 1, visible: stage.visible }))]);
    default: return [];
  }
}
/** Shows or hides one part; parts without a visibility switch are left unchanged. */
function setPartVisible(settings: MiniappSettings, target: LibraryTarget, part: string, visible: boolean, options?: ContactOptions): MiniappSettings {
  const [kind, id] = part.split(":");
  if (kind === "block") return { ...settings, experience: { ...settings.experience!, pages: settings.experience!.pages.map(page => page.id !== target.id ? page
    : { ...page, blocks: page.blocks.map(block => block.id === id ? { ...block, visible } : block) }) } };
  if (kind === "contact") return { ...settings, contacts: contactsOf(settings, options).map(row => row.id === id ? { ...row, visible } : row) };
  if (kind === "stage") return { ...settings, stages: settings.stages.map(group => ({ ...group, stages: group.stages.map(stage => stage.id === id ? { ...stage, visible } : stage) })) };
  return settings;
}

/** Left column of the library: the settings pages use, and the parts of the one that is open. */
export function LibraryList({ settings, target, part, options, locale, onOpen, onPart, onChange }: {
  settings: MiniappSettings; target: LibraryTarget | null; part: string; options?: ContactOptions; locale: Locale;
  onOpen: (target: LibraryTarget) => void; onPart: (part: string) => void; onChange: Change;
}) {
  const row = (key: string, label: ReactNode, active: boolean, onClick: () => void, depth = 0) =>
    <button type="button" key={key} onClick={onClick} style={{ paddingLeft: 12 + depth * 14 }}
      className={cn("flex w-full items-center gap-2 py-1.5 pr-3 text-left text-sm hover:bg-moon/20", active && "bg-moon/30 font-medium", depth && "text-xs")}>{label}</button>;
  const parts = target ? libraryParts(settings, target, options, locale) : [];
  return <div className="py-2">
    {groups.map(group => <div key={group.zh} className="pb-2">
      <p className="px-3 pb-1 text-[11px] font-medium text-muted">{group[locale]}</p>
      {group.kinds.map(kind => {
        const items = libraryItems(settings, kind), open = target?.kind === kind;
        return <div key={kind}>
          {row(kind, <><span className="min-w-0 flex-1 truncate">{libraryNames[kind][locale]}</span>{items && <span className="text-[11px] text-muted">{items.length}</span>}</>,
            open && !items && !part, () => onOpen({ kind }))}
          {open && items?.map(item => row(item.id, <span className={cn("min-w-0 flex-1 truncate", !item.enabled && "text-muted")}>{localText(item.title, locale) || L(locale, "未命名", "Untitled")}{!item.enabled && L(locale, "（未启用）", " (off)")}</span>,
            target?.id === item.id && !part, () => onOpen({ kind, id: item.id }), 1))}
        </div>;
      })}
    </div>)}
    {target && parts.length > 0 && <div className="border-t border-line pt-2">
      <p className="px-3 pb-1 text-[11px] font-medium text-muted">{L(locale, "组成", "Parts")} · {libraryNames[target.kind][locale]}</p>
      {parts.map(row => <div key={row.part} style={{ paddingLeft: 12 + row.depth * 14 }} className={cn("flex items-center gap-1 hover:bg-moon/20", part === row.part && "bg-crater/15 font-medium")}>
        {row.visible !== undefined && <Checkbox checked={row.visible} className="shrink-0" aria-label={L(locale, "显示", "Shown")}
          onCheckedChange={value => onChange(current => setPartVisible(current, target, row.part, value === true, options))} />}
        <button type="button" onClick={() => onPart(row.part)} className={cn("flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-1 pr-3 text-left text-xs", row.visible === false && "opacity-45")}>
          <span className="shrink-0 text-muted">{row.kind}</span><span className="truncate">{row.label}</span></button></div>)}
    </div>}
    <details className="border-t border-line pt-2">
      <summary className="cursor-pointer px-3 pb-1 text-[11px] font-medium text-muted">{L(locale, "更多设置（在原设置页打开）", "More settings (original page)")}</summary>
      {moreSettings.map(item => <Link key={item.tab} href={item.href ?? `/dashboard/miniapp-settings?tab=${item.tab}`}
        className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted hover:bg-moon/20 hover:text-ink"><span className="min-w-0 flex-1 truncate">{item[locale]}</span><ExternalLink className="size-3.5 shrink-0" /></Link>)}
    </details>
  </div>;
}

const fieldTypes: [ExperienceField["type"], string, string][] = [["text", "单行文字", "Short text"], ["textarea", "多行说明", "Long text"], ["select", "单项选择", "Single choice"],
  ["multiselect", "多项选择", "Multiple choice"], ["number", "数字", "Number"], ["date", "日期", "Date"], ["time", "时间", "Time"], ["phone", "联系电话", "Phone"], ["email", "电子邮箱", "Email"],
  ["rating", "评分", "Rating"], ["address", "收货地址", "Address"], ["media", "照片 / 文件", "Photos / files"], ["consent", "确认同意", "Confirmation"]];
/** Insert controls above the preview; new parts are placed after the selected one and selected. */
export function LibraryInsert({ target, settings, part, options, locale, onChange, onPart }: {
  target: LibraryTarget; settings: MiniappSettings; part: string; options?: ContactOptions; locale: Locale; onChange: Change; onPart: (part: string) => void;
}) {
  const hint = (text: string) => <span className="text-xs text-muted">{text}</span>;
  const menu = (label: string, body: (close: () => void) => ReactNode) => <InsertMenu label={label}>{body}</InsertMenu>;
  switch (target.kind) {
    case "pages": case "reports": {
      const page = settings.experience!.pages.find(row => row.id === target.id), report = target.kind === "reports";
      if (!page) return hint(L(locale, "在左侧选择或新建一页", "Choose or create a page on the left"));
      const add = (kind: ContentBlockKind) => {
        const block = newContentBlock(kind, newId()), after = part.startsWith("block:") ? page.blocks.findIndex(row => row.id === part.slice(6)) : -1;
        const blocks = [...page.blocks]; blocks.splice(after >= 0 ? after + 1 : blocks.length, 0, block);
        onChange(value => ({ ...value, experience: { ...value.experience!, pages: value.experience!.pages.map(row => row.id === page.id ? { ...row, blocks } : row) } }));
        onPart(`block:${block.id}`);
      };
      return <>{menu(L(locale, "插入模块", "Insert module"), close => moduleGroups.filter(group => group.id !== "report" || report).map(group => <div key={group.id} className="pb-1">
        <p className="px-2 py-1 text-[11px] text-muted">{localText(group.name, locale)}</p>
        <div className="grid grid-cols-2 gap-1">{group.kinds.filter(kind => !report || kind !== "accountRecords").map(kind =>
          <button type="button" key={kind} disabled={page.blocks.length >= 80} onClick={() => { add(kind); close(); }} className="rounded-md px-2 py-1.5 text-left text-xs hover:bg-moon/30">{localText(contentKindNames[kind], locale)}</button>)}</div></div>))}
        {hint(L(locale, "点预览里的模块即可修改", "Click a module on the preview to edit it"))}</>;
    }
    case "forms": {
      if (!target.id) return hint(L(locale, "在左侧选择或新建表单", "Choose or create a form on the left"));
      const group = part.split(":")[1];
      return <>{menu(L(locale, "插入问题", "Insert question"), close => <div className="grid grid-cols-2 gap-1">{fieldTypes.map(([type, zh, en]) =>
        <button type="button" key={type} className="rounded-md px-2 py-1.5 text-left text-xs hover:bg-moon/30" onClick={() => {
          try { const result = addAssemblyField(settings, target.id!, type, { zh, en }, group); onChange(() => result.config); onPart(result.focus.part); } catch { /* the group is full */ }
          close();
        }}>{locale === "zh" ? zh : en}</button>)}</div>)}
        {hint(L(locale, "点预览里的问题即可修改", "Click a question on the preview to edit it"))}</>;
    }
    case "contacts":
      return <><Button size="sm" variant="secondary" onClick={() => {
        const contact: MiniappContact = { id: newId(), name: { zh: "", en: "" }, service: { zh: "", en: "" }, phone: "", qrImage: "", stageNumbers: [], campusId: "", hours: { zh: "", en: "" }, address: { zh: "", en: "" }, visible: true };
        onChange(value => ({ ...value, contacts: [...contactsOf(value, options), contact] })); onPart(`contact:${contact.id}`);
      }}><Plus className="size-4" />{L(locale, "添加联系人", "Add contact")}</Button>{hint(L(locale, "点联系人卡片即可修改", "Click a contact card to edit it"))}</>;
    case "stages": return hint(L(locale, "点分组名或阶段即可修改名称和可见范围", "Click a group or stage to rename it or change availability"));
    case "brand": return hint(L(locale, "修改后中间立即显示", "Changes appear on the preview right away"));
    case "booking": return hint(L(locale, "规则对新的诊断预约生效", "Rules apply to new assessment bookings"));
  }
}

export function InsertMenu({ label, children, wide = false }: { label: string; children: (close: () => void) => ReactNode; wide?: boolean }) {
  const [open, setOpen] = useState(false);
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild>
    <Button size="sm" variant="secondary"><Plus className="size-4" />{label}</Button></PopoverTrigger>
    <PopoverContent align="start" className={cn(wide ? "w-[34rem]" : "w-64", "p-2")}>{children(() => setOpen(false))}</PopoverContent></Popover>;
}

function Phone({ title, children }: { title: string; children: ReactNode }) {
  return <div className="mx-auto flex w-[375px] max-w-full flex-col overflow-hidden rounded-[36px] border border-[#d9d4c6] bg-gradient-to-br from-[#e7ecd9] via-[#f4f2e7] to-[#f6efdc] text-[#29251f] shadow-sm">
    {title ? <div className="flex h-14 shrink-0 items-end justify-center px-4 pb-2 text-base font-semibold">{title}</div> : <div className="h-6 shrink-0" />}
    <div className="min-h-[28rem]">{children}</div>
  </div>;
}
const selectable = (selected: boolean, shown = true) => cn("cursor-pointer outline-none transition-shadow hover:ring-2 hover:ring-[#6f8b48]/40", selected && "ring-2 ring-[#6f8b48]", !shown && "opacity-45");

/** The open library object as the Mini Program shows it; its parts are selected by clicking. */
export function LibraryCanvas({ target, settings, part, options, locale, canvas, onPart, previewHost }: {
  target: LibraryTarget; settings: MiniappSettings; part: string; options?: ContactOptions; locale: Locale; canvas: ReactNode;
  onPart: (part: string) => void; previewHost: (element: HTMLDivElement | null) => void;
}) {
  switch (target.kind) {
    case "brand": return <>{canvas}</>;
    // Content and form previews carry their own title.
    case "pages": case "forms": case "reports":
      return <Phone title=""><div ref={previewHost} className="bg-paper" onClick={event => { if (event.target === event.currentTarget) onPart(""); }} /></Phone>;
    case "contacts": {
      const rows = contactsOf(settings, options), stages = settings.stages.flatMap(group => group.stages);
      return <Phone title={L(locale, "联系服务", "Contact us")}><div className="space-y-3 p-3" onClick={event => { if (event.target === event.currentTarget) onPart(""); }}>
        {rows.map(row => <div key={row.id} role="button" tabIndex={0} onClick={() => onPart(`contact:${row.id}`)} onKeyDown={event => { if (event.key === "Enter") onPart(`contact:${row.id}`); }}
          className={cn("flex gap-3 rounded-2xl bg-white p-4 shadow-sm", selectable(part === `contact:${row.id}`, row.visible))}>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="font-semibold">{miniappText(row.name, locale) || L(locale, "未命名联系人", "Unnamed contact")}</p>
            {miniappText(row.service, locale) && <p className="text-xs text-[#766f65]">{miniappText(row.service, locale)}</p>}
            <p className="text-sm">{row.phone || <span className="text-xs text-rose">{L(locale, "未填电话", "No phone")}</span>}</p>
            {miniappText(row.hours, locale) && <p className="text-xs text-[#766f65]">{miniappText(row.hours, locale)}</p>}
            <div className="flex flex-wrap gap-1 pt-1">{row.stageNumbers.length ? row.stageNumbers.map(n => <span key={n} className="rounded-full bg-[#eef2e4] px-2 py-0.5 text-[11px]">{miniappText(stages.find(stage => stage.stageNumber === n)?.label ?? { zh: String(n), en: String(n) }, locale)}</span>)
              : <span className="rounded-full bg-[#eef2e4] px-2 py-0.5 text-[11px]">{L(locale, "所有阶段", "All stages")}</span>}
              {row.campusId && <span className="rounded-full bg-[#f1ece0] px-2 py-0.5 text-[11px]">{options?.campuses.find(campus => campus.id === row.campusId)?.name}</span>}</div>
          </div>
          {row.qrImage && <img src={qrImage(row.qrImage)} alt="" className="size-20 shrink-0 rounded-lg object-contain" />}
        </div>)}
        {!rows.length && <p className="py-16 text-center text-sm text-[#766f65]">{L(locale, "还没有联系人，用上方“添加联系人”开始。", "No contacts yet. Use “Add contact” above.")}</p>}
      </div></Phone>;
    }
    case "stages":
      return <Phone title={L(locale, "参与者阶段", "Participant stage")}><div className="space-y-4 rounded-t-3xl bg-white p-4">
        <p className="text-xs text-[#766f65]">{L(locale, "家长在“参与者阶段”筛选和孩子资料里看到这些名称。", "Families see these labels in stage filters and participant details.")}</p>
        {settings.stages.map(group => <div key={group.id} className="space-y-2">
          <button type="button" onClick={() => onPart(`group:${group.id}`)} className={cn("rounded-md px-1 text-sm font-medium", selectable(part === `group:${group.id}`))}>{miniappText(group.label, locale)}</button>
          <div className="grid grid-cols-3 gap-2">{group.stages.map(stage => <button type="button" key={stage.id} onClick={() => onPart(`stage:${stage.id}`)}
            className={cn("rounded-full border border-[#e2ddcf] px-2 py-1.5 text-xs", selectable(part === `stage:${stage.id}`, stage.visible))}>{miniappText(stage.label, locale)}</button>)}</div>
        </div>)}
      </div></Phone>;
    case "booking": {
      // Rules are not drawn on the booking page itself, so they are summarized above it.
      const policy = settings.booking ?? defaultBookingPolicy();
      return <div className="mx-auto w-[375px] max-w-full space-y-3">
        <div className="space-y-1 rounded-2xl border border-dashed border-line bg-paper p-4 text-xs leading-5 text-muted">
          <p className="font-medium text-ink">{L(locale, "当前规则", "Current rules")}</p>
          <p>{L(locale, `可预约未来 ${policy.windowDays} 天内的时段，方式：${policy.modes.map(mode => mode === "campus" ? "到校" : "线上").join("、")}。`, `Book up to ${policy.windowDays} days ahead.`)}</p>
          <p>{policy.selfCancellation ? L(locale, "家长可在截止前自行取消。", "Families may cancel before the cutoff.") : L(locale, "家长不能自行取消。", "Families cannot cancel themselves.")}</p>
          {miniappText(policy.instructions, locale) && <p className="whitespace-pre-wrap text-ink">{miniappText(policy.instructions, locale)}</p>}
        </div>
        <Phone title=""><div className="bg-paper"><NativePhonePreview screenId="assessment" config={settings} locale={locale} /></div></Phone>
      </div>;
    }
  }
}

/** Right column of the library: the selected part's settings, or the object's own settings when nothing is selected. */
export function LibraryInspector({ target, part, settings, options, activities, locale, previewHost, upload, onChange, onOpen, onPart }: {
  target: LibraryTarget; part: string; settings: MiniappSettings; options?: ContactOptions; activities: { id: string; title: string }[]; locale: Locale;
  previewHost: HTMLElement | null; upload: LibraryUpload; onChange: Change; onOpen: (target: LibraryTarget) => void; onPart: (part: string) => void;
}) {
  const en = locale === "en", experience = settings.experience!;
  const context = {
    previewHost, selectedId: target.id ?? "", select: (id: string) => onOpen({ kind: target.kind, id }), config: settings, tab: target.kind, activities,
    assembly: withItems(target.kind), selectedPart: part, selectPart: onPart,
    // References inside the editors open library objects here and everything else in the original settings page.
    navigate: (tab: string, id = "") => {
      const kind = ({ pages: "pages", reports: "reports", forms: "forms", contacts: "contacts", stages: "stages", booking: "booking", brand: "brand" } as Record<string, LibraryKind>)[tab];
      if (kind) onOpen({ kind, id: id || undefined }); else window.location.assign(`/${locale}/dashboard/miniapp-settings?tab=${tab}`);
    },
  };
  const empty = (text: string) => <p className="text-sm leading-6 text-muted">{text}</p>;
  const [partKind, partId] = part.split(":");
  let body: ReactNode = null;
  switch (target.kind) {
    case "brand":
      body = <div className="space-y-5">
        <LocalizedField label={L(locale, "小程序里显示的机构名称", "Name shown in the Mini Program")} value={settings.brand.name} max={60} onChange={name => onChange(v => ({ ...v, brand: { ...v.brand, name } }))} />
        <label className="grid gap-1 text-sm">{L(locale, "主题颜色", "Theme")}<select className={settingsField} value={settings.brand.theme}
          onChange={e => onChange(v => ({ ...v, brand: { ...v.brand, theme: e.target.value as MiniappSettings["brand"]["theme"] } }))}>
          <option value="paper">{L(locale, "纸色", "Paper")}</option><option value="leaf">{L(locale, "叶绿", "Leaf")}</option><option value="rose">{L(locale, "玫瑰", "Rose")}</option></select></label>
        <p className="text-xs text-muted">{L(locale, "页面顶部选择“左侧显示机构名称”时显示这里的名称。", "Pages with the brand top bar show this name.")}</p>
      </div>;
      break;
    case "stages":
      body = partKind === "group" || partKind === "stage"
        ? <StagesEditor value={settings.stages} locale={locale} focus={{ kind: partKind, id: partId }} onChange={stages => onChange(v => ({ ...v, stages }))} />
        : empty(L(locale, "点中间的分组名或阶段修改名称；取消“新选择中可见”后，家长新选择时不再出现该阶段，已有资料不受影响。", "Click a group or stage in the middle to edit it."));
      break;
    case "contacts":
      body = !options ? empty(L(locale, "联系服务选项暂未载入，请刷新后编辑。", "Contact options could not be loaded. Reload to edit."))
        : partKind === "contact" ? <ContactsEditor value={settings.contacts} legacy={options.legacy} campuses={options.campuses} stages={settings.stages} locale={locale} focusId={partId}
          onChange={contacts => onChange(v => ({ ...v, contacts }))} upload={(file, accept) => upload(file, accept, true)} />
        : empty(L(locale, "点中间的联系人卡片修改。家长在“联系服务”里按孩子的阶段和校区看到对应联系人；不选阶段的联系人是该校区的默认联系人。", "Click a contact card to edit it."));
      break;
    case "booking":
      body = <BookingPolicyEditor value={settings.booking} en={en} onChange={booking => onChange(v => ({ ...v, booking }))} />;
      break;
    case "pages": case "forms": case "reports":
      body = <>
        <ExperienceWorkbench key={target.kind} tab={target.kind} value={experience} locale={locale} activities={activities} upload={upload}
          onChange={next => onChange(v => ({ ...v, experience: next }))} />
        {target.kind === "reports" && !part && <details className="mt-6 border-t border-line pt-5"><summary className="cursor-pointer text-sm">{L(locale, "原报告与旧客户端兼容栏目", "Compatible sections for original reports and clients")}</summary>
          <div className="mt-4"><ReportTemplatesEditor value={settings.reports} en={en} onChange={reports => onChange(v => ({ ...v, reports }))} /></div></details>}
      </>;
      break;
  }
  return <ExperienceContext.Provider value={experience}><WorkbenchContext.Provider value={context}>
    <div className={styles.fields}>{body}</div>
  </WorkbenchContext.Provider></ExperienceContext.Provider>;
}

/** Name of the selected part for the inspector heading. */
export function partTitle(settings: MiniappSettings, target: LibraryTarget, part: string, options: ContactOptions | undefined, locale: Locale) {
  if (!part) return libraryNames[target.kind][locale];
  const found = libraryParts(settings, target, options, locale).find(row => row.part === part);
  return found ? `${found.kind} · ${found.label}` : libraryNames[target.kind][locale];
}

export function Breadcrumb({ trail, locale, onBack }: { trail: string[]; locale: Locale; onBack: () => void }) {
  return <div className="flex min-w-0 flex-1 items-center gap-1 text-sm">
    <button type="button" onClick={onBack} className="shrink-0 text-muted hover:text-ink">{L(locale, "画布", "Canvas")}</button>
    {trail.map((part, index) => <span key={index} className={cn("flex min-w-0 items-center gap-1", index === trail.length - 1 ? "font-medium" : "text-muted")}>
      <ChevronRight className="size-3.5 shrink-0 text-muted" /><span className="truncate">{part}</span></span>)}
  </div>;
}
