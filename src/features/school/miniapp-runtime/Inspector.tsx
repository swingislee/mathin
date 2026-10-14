"use client";
import { useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { newId } from "@/lib/uuid";
import { uploadMiniappImage } from "@/features/school/miniapp-settings/actions";
import {
  runtimeIcons, runtimeRoutes, runtimeSources, runtimeTabSlots,
  type RuntimeAction, type RuntimeBlockSpec, type RuntimeEntrySpec, type RuntimeLinkSpec, type RuntimeRule, type RuntimeScreenSpec, type RuntimeTabSpec, type RuntimeText,
} from "../../../../contracts/participant-api/runtime";
import { blockNames, canHideTab, defaultAction, presetRule, rulePreset, withHidden, type ActionKind, type Locale, type RulePreset } from "./model";
import { RuntimeIcon } from "./RuntimeRenderer";

export type InspectorMeta = { contentPages: { id: string; title: string }[]; stages: { stageNumber: number; label: string; group: string }[] };
const select = "h-9 w-full rounded-md border border-line bg-paper px-2 text-sm";
const L = (locale: Locale, zh: string, en: string) => locale === "zh" ? zh : en;

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="block space-y-1.5"><span className="text-xs font-medium text-muted">{label}</span>{children}{hint && <span className="block text-[11px] text-muted">{hint}</span>}</label>;
}
/** Edits one language at a time; the other language appears as a reference. */
export function TextField({ label, value, locale, onChange, multiline = false }: { label: string; value: RuntimeText; locale: Locale; onChange: (value: RuntimeText) => void; multiline?: boolean }) {
  const other = locale === "zh" ? value.en : value.zh;
  const props = { value: value[locale], placeholder: other, onChange: (event: { target: { value: string } }) => onChange({ ...value, [locale]: event.target.value }) };
  return <Field label={label} hint={other && value[locale] ? `${locale === "zh" ? "English" : "中文"}：${other}` : !value[locale] && other ? L(locale, "尚未填写，将显示中文", "Missing; Chinese will be shown") : undefined}>
    {multiline ? <Textarea rows={4} {...props} /> : <Input {...props} />}</Field>;
}

const routeNames: Record<string, string> = { assessment: "诊断预约", "activity-catalog": "公益活动目录", "activity-detail": "活动详情", "activity-requests": "活动报名记录", agenda: "全部安排",
  reservations: "我的预约", reflections: "思考回顾 / 报告", records: "活动记录", register: "参与登记", "guardian-binding": "关联已有孩子", service: "联系服务", document: "文档",
  experience: "图文页（旧）", "service-catalog": "服务目录", "service-detail": "服务详情", "experience-form": "服务申请表", "experience-requests": "服务申请记录",
  "provider-bookings": "服务预约记录", "experience-notifications": "服务消息", task: "任务详情", web: "网页" };
const actionKinds: { kind: ActionKind; zh: string; en: string }[] = [
  { kind: "none", zh: "无", en: "None" }, { kind: "screen", zh: "打开页面", en: "Open page" }, { kind: "tab", zh: "切换底部导航", en: "Switch tab" },
  { kind: "route", zh: "打开现有功能", en: "Open feature" }, { kind: "phone", zh: "拨打电话", en: "Call" }, { kind: "copy", zh: "复制文字", en: "Copy text" },
  { kind: "login", zh: "登录", en: "Sign in" }, { kind: "logout", zh: "退出登录", en: "Sign out" }, { kind: "back", zh: "返回", en: "Back" }, { kind: "refresh", zh: "刷新", en: "Refresh" },
];
export function ActionField({ label, value, screens, locale, onChange, allowNone = true }: { label: string; value?: RuntimeAction; screens: RuntimeScreenSpec[]; locale: Locale; onChange: (value: RuntimeAction | undefined) => void; allowNone?: boolean }) {
  const kind: ActionKind = value?.type ?? "none";
  return <Field label={label}><div className="space-y-2">
    <select className={select} value={kind} onChange={event => onChange(defaultAction(event.target.value as ActionKind, screens))}>
      {actionKinds.filter(row => allowNone || row.kind !== "none").map(row => <option key={row.kind} value={row.kind}>{row[locale]}</option>)}</select>
    {value?.type === "screen" && <select className={select} value={value.screen} onChange={event => onChange({ type: "screen", screen: event.target.value })}>
      {screens.map(screen => <option key={screen.id} value={screen.id}>{screen.title[locale] || screen.title.zh || screen.id}</option>)}</select>}
    {value?.type === "tab" && <select className={select} value={value.slot} onChange={event => onChange({ type: "tab", slot: Number(event.target.value) as RuntimeTabSpec["slot"] })}>
      {runtimeTabSlots.map(slot => <option key={slot} value={slot}>{L(locale, `第 ${slot} 项`, `Tab ${slot}`)}</option>)}</select>}
    {value?.type === "route" && <>
      <select className={select} value={value.route} onChange={event => onChange({ type: "route", route: event.target.value as typeof value.route })}>
        {runtimeRoutes.map(route => <option key={route} value={route}>{routeNames[route] || route}</option>)}</select>
      {["document", "experience", "service-detail", "experience-form", "web", "activity-detail", "service-catalog"].includes(value.route) &&
        <Input placeholder={L(locale, "对象标识，例如 privacy", "Target id, e.g. privacy")} value={value.query?.id ?? value.query?.category ?? ""}
          onChange={event => onChange({ ...value, query: event.target.value ? { [value.route === "service-catalog" ? "category" : "id"]: event.target.value } : undefined })} />}
    </>}
    {value?.type === "phone" && <Input value={value.number} onChange={event => onChange({ type: "phone", number: event.target.value })} />}
    {value?.type === "copy" && <Input value={value.text} onChange={event => onChange({ type: "copy", text: event.target.value })} />}
  </div></Field>;
}

const rulePresets: { preset: RulePreset; zh: string; en: string }[] = [
  { preset: "all", zh: "所有人", en: "Everyone" }, { preset: "signedIn", zh: "仅已登录", en: "Signed in" }, { preset: "signedOut", zh: "仅未登录访客", en: "Visitors only" },
  { preset: "hasParticipants", zh: "已关联孩子的家庭", en: "Families with a linked child" }, { preset: "stage", zh: "指定学习阶段", en: "Selected stages" },
  { preset: "between", zh: "指定日期范围", en: "Date range" },
];
export function RuleField({ value, meta, locale, onChange }: { value?: RuntimeRule; meta: InspectorMeta; locale: Locale; onChange: (value: RuntimeRule | undefined) => void }) {
  const preset = rulePreset(value);
  return <Field label={L(locale, "谁能看到", "Visible to")} hint={L(locale, "由 Mathin 按账号判断，未满足条件的人不会收到这部分内容。", "Mathin checks each account; others do not receive it.")}><div className="space-y-2">
    <select className={select} value={preset} onChange={event => onChange(presetRule(event.target.value as RulePreset, value))}>
      {rulePresets.map(row => <option key={row.preset} value={row.preset}>{row[locale]}</option>)}
      {preset === "custom" && <option value="custom">{L(locale, "组合条件（保留）", "Combined rule (kept)")}</option>}</select>
    {value?.kind === "stage" && <div className="flex flex-wrap gap-1.5">{meta.stages.map(stage => {
      const on = value.stages.includes(stage.stageNumber);
      return <button type="button" key={stage.stageNumber} onClick={() => { const stages = on ? value.stages.filter(n => n !== stage.stageNumber) : [...value.stages, stage.stageNumber]; if (stages.length) onChange({ kind: "stage", stages }); }}
        className={cn("rounded-full border px-2 py-0.5 text-xs", on ? "border-crater bg-crater/15" : "border-line")}>{stage.label}</button>;
    })}</div>}
    {value?.kind === "between" && <div className="grid grid-cols-2 gap-2"><Input type="date" value={value.from} onChange={event => onChange({ ...value, from: event.target.value })} />
      <Input type="date" value={value.to} onChange={event => onChange({ ...value, to: event.target.value })} /></div>}
  </div></Field>;
}

/** Unchecking keeps the object here and stops sending it to the Mini Program. */
export function ShownField({ label, hidden, locale, disabledReason, onChange }: { label: string; hidden: boolean; locale: Locale; disabledReason?: string; onChange: (hidden: boolean) => void }) {
  return <div className={cn("rounded-lg border p-3", hidden ? "border-dashed border-line bg-moon/10" : "border-line")}>
    <label className="flex items-center gap-2 text-sm"><Checkbox checked={!hidden} disabled={!!disabledReason && !hidden} onCheckedChange={value => onChange(value !== true)} />{label}</label>
    <p className="mt-1.5 text-[11px] text-muted">{disabledReason && !hidden ? disabledReason
      : hidden ? L(locale, "已隐藏：设置都保留在这里，小程序里不显示。重新勾选并发布即可恢复。", "Hidden: settings are kept here and the Mini Program does not show it. Check it and publish to show it again.")
      : L(locale, "取消勾选可暂时隐藏，不需要删除。", "Uncheck to hide it without deleting.")}</p>
  </div>;
}

function ImageField({ label, value, locale, onChange }: { label: string; value: string; locale: Locale; onChange: (value: string) => void }) {
  const input = useRef<HTMLInputElement>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const upload = async (file: File) => {
    setBusy(true); setError("");
    const form = new FormData(); form.set("image", file);
    const result = await uploadMiniappImage(form);
    setBusy(false);
    if (result.ok) onChange(result.data.path); else setError(L(locale, "图片未能上传，请换一张 JPG/PNG 重试。", "Upload failed. Try another JPG/PNG."));
  };
  return <Field label={label}><div className="flex items-center gap-2">
    <div className="flex size-12 items-center justify-center overflow-hidden rounded-lg bg-moon/20">
      {/^[0-9a-f-]{36}\.webp$/.test(value) ? <img src={`/api/v1/participant/settings/image?preview=1&path=${encodeURIComponent(value)}`} alt="" className="size-full object-cover" /> /* eslint-disable-line @next/next/no-img-element */
        : <RuntimeIcon value={value || "asset:activity"} className="size-6" />}</div>
    <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => input.current?.click()}><Upload className="size-4" />{busy ? L(locale, "上传中…", "Uploading…") : L(locale, "上传图片", "Upload")}</Button>
    {value && <Button type="button" size="sm" variant="ghost" onClick={() => onChange("asset:appointment")}>{L(locale, "用默认图", "Default")}</Button>}
    <input ref={input} type="file" accept="image/*" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} />
  </div>{error && <p className="text-xs text-rose">{error}</p>}</Field>;
}
function IconField({ value, locale, onChange }: { value: string; locale: Locale; onChange: (value: string) => void }) {
  return <Field label={L(locale, "图标", "Icon")}><div className="flex flex-wrap gap-1">{runtimeIcons.map(icon =>
    <button type="button" key={icon} title={icon} onClick={() => onChange(icon)} className={cn("flex size-8 items-center justify-center rounded-md border", value === icon ? "border-crater bg-crater/15" : "border-transparent hover:border-line")}>
      <RuntimeIcon value={`asset:icons/${icon}`} className="size-4" /></button>)}</div></Field>;
}
function LinkField({ label, value, screens, locale, onChange }: { label: string; value?: RuntimeLinkSpec; screens: RuntimeScreenSpec[]; locale: Locale; onChange: (value: RuntimeLinkSpec | undefined) => void }) {
  return <div className="space-y-2 rounded-lg border border-line p-3">
    <ActionField label={label} value={value?.action} screens={screens} locale={locale} onChange={action => onChange(action ? { label: value?.label ?? { zh: "查看全部", en: "View all" }, action } : undefined)} />
    {value && <TextField label={L(locale, "链接文字", "Link label")} value={value.label} locale={locale} onChange={labelText => onChange({ ...value, label: labelText })} />}
  </div>;
}
function EntriesField({ items, screens, meta, locale, onChange }: { items: RuntimeEntrySpec[]; screens: RuntimeScreenSpec[]; meta: InspectorMeta; locale: Locale; onChange: (items: RuntimeEntrySpec[]) => void }) {
  const [open, setOpen] = useState(items[0]?.id ?? "");
  const set = (id: string, change: Partial<RuntimeEntrySpec>) => onChange(items.map(item => item.id === id ? { ...item, ...change } : item));
  const move = (index: number, offset: number) => { const next = [...items]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; onChange(next); };
  return <div className="space-y-2"><span className="text-xs font-medium text-muted">{L(locale, "入口项", "Entries")}</span>
    {items.map((item, index) => <div key={item.id} className="rounded-lg border border-line">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <Checkbox checked={!item.hidden} aria-label={L(locale, "在小程序中显示", "Show in the Mini Program")} title={L(locale, "取消勾选即隐藏，不删除", "Uncheck to hide without deleting")}
          onCheckedChange={value => onChange(items.map(row => row.id === item.id ? withHidden(row, value !== true) : row))} />
        <button type="button" className={cn("flex min-w-0 flex-1 items-center gap-2 text-left text-sm", item.hidden && "opacity-45")} onClick={() => setOpen(open === item.id ? "" : item.id)}>
        <RuntimeIcon value={`asset:icons/${item.icon}`} className="size-4 shrink-0" /><span className="truncate">{item.label[locale] || item.label.zh}</span></button>
        <Button type="button" size="sm" variant="ghost" className="size-7 p-0" disabled={!index} onClick={() => move(index, -1)} aria-label="up"><ArrowUp className="size-3.5" /></Button>
        <Button type="button" size="sm" variant="ghost" className="size-7 p-0" disabled={index === items.length - 1} onClick={() => move(index, 1)} aria-label="down"><ArrowDown className="size-3.5" /></Button>
        <Button type="button" size="sm" variant="ghost" className="size-7 p-0" disabled={items.length === 1} onClick={() => onChange(items.filter(row => row.id !== item.id))} aria-label="remove"><Trash2 className="size-3.5" /></Button></div>
      {open === item.id && <div className="space-y-3 border-t border-line p-3">
        <TextField label={L(locale, "名称", "Label")} value={item.label} locale={locale} onChange={label => set(item.id, { label })} />
        <IconField value={item.icon} locale={locale} onChange={icon => set(item.id, { icon })} />
        <ActionField label={L(locale, "点击后", "On tap")} value={item.action} screens={screens} locale={locale} allowNone={false} onChange={action => action && set(item.id, { action })} />
        <RuleField value={item.visibleWhen} meta={meta} locale={locale} onChange={visibleWhen => onChange(items.map(row => { if (row.id !== item.id) return row; const next = { ...row }; if (visibleWhen) next.visibleWhen = visibleWhen; else delete next.visibleWhen; return next; }))} />
      </div>}
    </div>)}
    <Button type="button" size="sm" variant="secondary" onClick={() => { const id = `entry-${newId().slice(0, 8)}`; onChange([...items, { id, label: { zh: "新入口", en: "New entry" }, icon: "activity", action: { type: "route", route: "assessment" } }]); setOpen(id); }}>
      <Plus className="size-4" />{L(locale, "添加入口", "Add entry")}</Button>
  </div>;
}

const sourceNames: Record<string, { zh: string; en: string }> = {
  "activities.catalog": { zh: "公开活动（公开）", en: "Public activities" }, "account.bookings": { zh: "我的预约（需登录）", en: "My bookings (signed in)" },
  "account.tasks": { zh: "我的任务（需登录）", en: "My tasks (signed in)" }, "account.reports": { zh: "学习报告（需登录）", en: "Reports (signed in)" },
};
/** Fields for the selected block. Every change returns a complete block to the caller. */
export function BlockInspector({ block, screens, meta, locale, onChange }: { block: RuntimeBlockSpec; screens: RuntimeScreenSpec[]; meta: InspectorMeta; locale: Locale; onChange: (block: RuntimeBlockSpec) => void }) {
  const set = (change: Partial<RuntimeBlockSpec>) => onChange({ ...block, ...change } as RuntimeBlockSpec);
  const omit = (key: string) => { const next = { ...block } as Record<string, unknown>; delete next[key]; onChange(next as RuntimeBlockSpec); };
  const optional = (key: "action" | "more" | "trailing", value: unknown) => value ? set({ [key]: value } as Partial<RuntimeBlockSpec>) : omit(key);
  const fields: ReactNode[] = [];
  switch (block.type) {
    case "section":
      fields.push(<TextField key="title" label={L(locale, "标题", "Title")} value={block.title} locale={locale} onChange={title => set({ title })} />,
        <Field key="style" label={L(locale, "样式", "Style")}><select className={select} value={block.style} onChange={event => set({ style: event.target.value as "card" | "plain" | "row" })}><option value="card">{L(locale, "白色卡片", "Card")}</option><option value="plain">{L(locale, "无底色", "Plain")}</option><option value="row">{L(locale, "左右并排", "Side by side")}</option></select></Field>,
        <LinkField key="more" label={L(locale, "标题右侧链接", "Heading link")} value={block.more} screens={screens} locale={locale} onChange={value => optional("more", value)} />);
      break;
    case "text":
      fields.push(<TextField key="text" multiline label={L(locale, "文字", "Text")} value={block.text} locale={locale} onChange={text => set({ text })} />,
        <Field key="tone" label={L(locale, "样式", "Style")}><select className={select} value={block.tone} onChange={event => set({ tone: event.target.value as "body" | "muted" | "notice" })}><option value="body">{L(locale, "正文", "Body")}</option><option value="muted">{L(locale, "说明", "Muted")}</option><option value="notice">{L(locale, "提示条", "Notice")}</option></select></Field>);
      break;
    case "image":
      fields.push(<ImageField key="image" label={L(locale, "图片", "Image")} value={block.image} locale={locale} onChange={image => set({ image })} />,
        <Field key="fit" label={L(locale, "显示", "Fit")}><select className={select} value={block.fit} onChange={event => set({ fit: event.target.value as "width" | "cover" })}><option value="width">{L(locale, "完整显示", "Full width")}</option><option value="cover">{L(locale, "裁成横幅", "Banner crop")}</option></select></Field>,
        <ActionField key="action" label={L(locale, "点击后", "On tap")} value={block.action} screens={screens} locale={locale} onChange={value => optional("action", value)} />);
      break;
    case "feature":
      fields.push(<TextField key="title" label={L(locale, "标题", "Title")} value={block.title} locale={locale} onChange={title => set({ title })} />,
        <Field key="style" label={L(locale, "样式", "Style")}><select className={select} value={block.style ?? "card"} onChange={event => set({ style: event.target.value as "card" | "tile" })}><option value="card">{L(locale, "横向功能卡", "Card")}</option><option value="tile">{L(locale, "彩色磁贴", "Tile")}</option></select></Field>,
        <TextField key="body" label={L(locale, "按钮文字", "Badge")} value={block.body} locale={locale} onChange={body => set({ body })} />,
        <ImageField key="image" label={L(locale, "配图", "Image")} value={block.image} locale={locale} onChange={image => set({ image })} />,
        <ActionField key="action" label={L(locale, "点击后", "On tap")} value={block.action} screens={screens} locale={locale} onChange={value => optional("action", value)} />);
      break;
    case "entries":
      fields.push(<TextField key="title" label={L(locale, "标题", "Title")} value={block.title} locale={locale} onChange={title => set({ title })} />,
        <Field key="style" label={L(locale, "样式", "Style")}><select className={select} value={block.style} onChange={event => set({ style: event.target.value as "grid" | "floating" })}><option value="grid">{L(locale, "宫格", "Grid")}</option><option value="floating">{L(locale, "右下悬浮", "Floating")}</option></select></Field>,
        <EntriesField key="items" items={block.items} screens={screens} meta={meta} locale={locale} onChange={items => set({ items })} />);
      break;
    case "list":
      fields.push(<TextField key="title" label={L(locale, "标题", "Title")} value={block.title} locale={locale} onChange={title => set({ title })} />,
        <Field key="source" label={L(locale, "数据来源", "Data")} hint={L(locale, "数据由 Mathin 按当前账号和所选孩子读取。", "Mathin reads it for the current account and child.")}><select className={select} value={block.source} onChange={event => set({ source: event.target.value as typeof block.source, facets: event.target.value === "activities.catalog" ? block.facets : [] })}>
          {runtimeSources.map(source => <option key={source} value={source}>{sourceNames[source][locale]}</option>)}</select></Field>,
        <Field key="template" label={L(locale, "条目样式", "Item style")}><select className={select} value={block.template} onChange={event => set({ template: event.target.value as "card" | "row" })}><option value="card">{L(locale, "图文卡片", "Card")}</option><option value="row">{L(locale, "简洁行", "Row")}</option></select></Field>,
        <Field key="limit" label={L(locale, "最多显示", "Show at most")}><Input type="number" min={1} max={30} value={block.limit} onChange={event => set({ limit: Math.max(1, Math.min(30, Number(event.target.value) || 1)) })} /></Field>,
        ...(block.source === "activities.catalog" ? [<Field key="facets" label={L(locale, "筛选", "Filters")}><div className="flex gap-3 text-sm">{(["stage", "topic"] as const).map(facet =>
          <label key={facet} className="flex items-center gap-1.5"><input type="checkbox" checked={block.facets.includes(facet)} onChange={event => set({ facets: event.target.checked ? [...block.facets, facet] : block.facets.filter(row => row !== facet) })} />{facet === "stage" ? L(locale, "参与者阶段", "Stage") : L(locale, "活动标签", "Tag")}</label>)}</div></Field>] : []),
        <TextField key="action" label={L(locale, "条目按钮文字", "Item button")} value={block.actionLabel} locale={locale} onChange={actionLabel => set({ actionLabel })} />,
        <TextField key="empty" label={L(locale, "没有内容时", "When empty")} value={block.empty} locale={locale} onChange={empty => set({ empty })} />,
        <LinkField key="more" label={L(locale, "标题右侧链接", "Heading link")} value={block.more} screens={screens} locale={locale} onChange={value => optional("more", value)} />);
      break;
    case "participants":
      fields.push(<Field key="style" label={L(locale, "样式", "Style")}><select className={select} value={block.style ?? "chips"} onChange={event => set({ style: event.target.value as "chips" | "picker" | "tile" })}>
          <option value="picker">{L(locale, "下拉选择行", "Picker row")}</option><option value="tile">{L(locale, "头像磁贴", "Avatar tile")}</option><option value="chips">{L(locale, "横向标签", "Chips")}</option></select></Field>,
        <TextField key="title" label={L(locale, "标题", "Title")} value={block.title} locale={locale} onChange={title => set({ title })} />,
        <TextField key="empty" label={L(locale, "没有关联孩子时", "When none linked")} value={block.empty} locale={locale} onChange={empty => set({ empty })} />);
      break;
    case "calendar":
      fields.push(<TextField key="title" label={L(locale, "标题", "Title")} value={block.title} locale={locale} onChange={title => set({ title })} />,
        <TextField key="empty" label={L(locale, "当天没有安排时", "When empty")} value={block.empty} locale={locale} onChange={empty => set({ empty })} />,
        <TextField key="signin" label={L(locale, "未登录时的按钮文字", "Signed-out button")} value={block.signInLabel ?? { zh: "", en: "" }} locale={locale} onChange={signInLabel => set({ signInLabel })} />,
        <label key="nav" className="flex items-center gap-2 text-sm"><input type="checkbox" checked={block.weekNavigation === true} onChange={event => set({ weekNavigation: event.target.checked })} />{L(locale, "显示上一周 / 下一周切换", "Show week switching")}</label>,
        <LinkField key="more" label={L(locale, "标题右侧链接", "Heading link")} value={block.more} screens={screens} locale={locale} onChange={value => optional("more", value)} />);
      break;
    case "account":
      fields.push(<LinkField key="trailing" label={L(locale, "右侧按钮", "Trailing button")} value={block.trailing} screens={screens} locale={locale} onChange={value => optional("trailing", value)} />);
      break;
    case "content":
      fields.push(<Field key="page" label={L(locale, "图文页", "Content page")} hint={L(locale, "图文页正文在“小程序设置 · 内容”中编写。", "Write content pages in Mini Program settings.")}>
        <select className={select} value={block.pageId} onChange={event => set({ pageId: event.target.value })}>
          {!meta.contentPages.some(page => page.id === block.pageId) && <option value={block.pageId}>{block.pageId}</option>}
          {meta.contentPages.map(page => <option key={page.id} value={page.id}>{page.title}</option>)}</select></Field>);
      break;
    case "button":
      fields.push(<TextField key="label" label={L(locale, "按钮文字", "Label")} value={block.label} locale={locale} onChange={label => set({ label })} />,
        <Field key="appearance" label={L(locale, "样式", "Style")}><select className={select} value={block.appearance} onChange={event => set({ appearance: event.target.value as "primary" | "secondary" | "link" })}><option value="primary">{L(locale, "主按钮", "Primary")}</option><option value="secondary">{L(locale, "次按钮", "Secondary")}</option><option value="link">{L(locale, "文字链接", "Link")}</option></select></Field>,
        <ActionField key="action" label={L(locale, "点击后", "On tap")} value={block.action} screens={screens} locale={locale} allowNone={false} onChange={value => value && set({ action: value })} />);
      break;
    case "filters":
      fields.push(<p key="hint" className="text-xs text-muted">{L(locale, "显示本页数据列表中开启的筛选（参与者阶段、活动标签），选择后整页列表一起更新。隐藏筛选条后，筛选会回到列表卡片里；完全不要筛选时，在数据列表里取消勾选筛选项。",
        "Shows the filters enabled on this page's lists; choosing one updates every list. When this bar is hidden the filters return to the list card; turn them off on the list to remove them.")}</p>,
        <TextField key="clear" label={L(locale, "重置按钮文字", "Reset label")} value={block.clearLabel} locale={locale} onChange={clearLabel => set({ clearLabel })} />);
      break;
    case "divider": break;
  }
  return <div className="space-y-4">
    <p className="text-xs text-muted">{blockNames[block.type][locale]} · <span className="font-mono">{block.id}</span></p>
    <ShownField label={L(locale, "在小程序中显示", "Show in the Mini Program")} hidden={!!block.hidden} locale={locale} onChange={hidden => onChange(withHidden(block, hidden))} />
    {fields}
    <RuleField value={block.visibleWhen} meta={meta} locale={locale} onChange={rule => rule ? set({ visibleWhen: rule }) : omit("visibleWhen")} />
  </div>;
}

export function ScreenInspector({ screen, tab, tabs, screens, meta, locale, onScreen, onTab }: {
  screen: RuntimeScreenSpec; tab?: RuntimeTabSpec; tabs: RuntimeTabSpec[]; screens: RuntimeScreenSpec[]; meta: InspectorMeta; locale: Locale;
  onScreen: (screen: RuntimeScreenSpec) => void; onTab: (tab: RuntimeTabSpec) => void;
}) {
  return <div className="space-y-4">
    <p className="text-xs text-muted">{L(locale, "页面", "Page")} · <span className="font-mono">{screen.id}</span></p>
    <TextField label={L(locale, "页面标题", "Page title")} value={screen.title} locale={locale} onChange={title => onScreen({ ...screen, title })} />
    <Field label={L(locale, "顶部标题", "Top bar")}><select className={select} value={screen.navigation} onChange={event => onScreen({ ...screen, navigation: event.target.value as "brand" | "title" })}>
      <option value="title">{L(locale, "居中显示页面标题", "Centered page title")}</option><option value="brand">{L(locale, "左侧显示机构名称", "Brand name at left")}</option></select></Field>
    {tab && <div className="space-y-3 rounded-lg border border-line p-3">
      <p className="text-xs font-medium">{L(locale, `底部导航第 ${tab.slot} 项`, `Tab ${tab.slot}`)}</p>
      <ShownField label={L(locale, "在底部导航显示", "Show in the tab bar")} hidden={!!tab.hidden} locale={locale} onChange={hidden => onTab(withHidden(tab, hidden))}
        disabledReason={canHideTab(tabs, tab.slot) ? undefined : tab.slot === 1 ? L(locale, "第 1 项是打开小程序时的首页，不能隐藏。", "Tab 1 opens first and cannot be hidden.") : L(locale, "底部导航至少要显示两项。", "At least two tabs must stay shown.")} />
      <TextField label={L(locale, "导航名称（最多 4 字）", "Tab label")} value={tab.label} locale={locale} onChange={label => onTab({ ...tab, label: { zh: label.zh.slice(0, 8), en: label.en.slice(0, 8) } })} />
      <IconField value={tab.icon} locale={locale} onChange={icon => onTab({ ...tab, icon })} />
      <RuleField value={tab.visibleWhen} meta={meta} locale={locale} onChange={rule => { const next = { ...tab }; if (rule) next.visibleWhen = rule; else delete next.visibleWhen; onTab(next); }} />
    </div>}
    {!tab && <p className="text-xs text-muted">{L(locale, "其他页面可通过按钮、入口或链接的“打开页面”到达。", "Reach this page from a button, entry or link.")}</p>}
    <p className="text-[11px] text-muted">{L(locale, `共 ${screens.length} 个页面`, `${screens.length} pages`)}</p>
  </div>;
}
