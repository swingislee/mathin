"use client";
import { useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { newId } from "@/lib/uuid";
import { runtimeText, type RuntimeBlockSpec, type RuntimeScreenSpec, type RuntimeText } from "../../../../contracts/participant-api/runtime";
import { uploadMiniappMedia } from "./actions";
import { ActionField, Field, ImageField, SettingsLink, TextField, type InspectorMeta } from "./Inspector";
import type { Locale } from "./model";

const select = "h-9 w-full rounded-md border border-line bg-paper px-2 text-sm";
const L = (locale: Locale, zh: string, en: string) => locale === "zh" ? zh : en;
const id = (prefix: string) => `${prefix}-${newId().slice(0, 8)}`;
const local = (value: RuntimeText, locale: Locale) => value[locale] || value.zh || value.en;

/** A list of small objects edited one at a time: open, reorder, remove, add. */
function Rows<T extends object>({ label, rows, locale, title, onChange, create, children }: {
  label: string; rows: T[]; locale: Locale; title: (row: T, index: number) => string; onChange: (rows: T[]) => void; create: () => T;
  children: (row: T, change: (next: T) => void) => ReactNode;
}) {
  const [open, setOpen] = useState(0);
  const move = (index: number, offset: number) => { const next = [...rows]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; onChange(next); setOpen(index + offset); };
  return <div className="space-y-2"><span className="text-xs font-medium text-muted">{label}</span>
    {rows.map((row, index) => <div key={(row as { id?: string }).id ?? index} className="rounded-lg border border-line">
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button type="button" className="min-w-0 flex-1 truncate text-left text-sm" onClick={() => setOpen(open === index ? -1 : index)}>{title(row, index) || L(locale, "未命名", "Untitled")}</button>
        <Button type="button" size="sm" variant="ghost" className="size-7 p-0" disabled={!index} onClick={() => move(index, -1)} aria-label="up"><ArrowUp className="size-3.5" /></Button>
        <Button type="button" size="sm" variant="ghost" className="size-7 p-0" disabled={index === rows.length - 1} onClick={() => move(index, 1)} aria-label="down"><ArrowDown className="size-3.5" /></Button>
        <Button type="button" size="sm" variant="ghost" className="size-7 p-0" onClick={() => onChange(rows.filter((_, i) => i !== index))} aria-label="remove"><Trash2 className="size-3.5" /></Button>
      </div>
      {open === index && <div className="space-y-3 border-t border-line p-3">{children(row, next => onChange(rows.map((item, i) => i === index ? next : item)))}</div>}
    </div>)}
    <Button type="button" size="sm" variant="secondary" onClick={() => { onChange([...rows, create()]); setOpen(rows.length); }}><Plus className="size-4" />{L(locale, "添加", "Add")}</Button>
  </div>;
}

/** Uploaded audio or video, or an HTTPS address. */
function MediaField({ label, value, locale, accept, onChange }: { label: string; value: string; locale: Locale; accept: string; onChange: (value: string) => void }) {
  const input = useRef<HTMLInputElement>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const upload = async (file: File) => {
    setBusy(true); setError("");
    const form = new FormData(); form.set("media", file);
    const result = await uploadMiniappMedia(form);
    setBusy(false);
    if (result.ok) onChange(result.data.path); else setError(L(locale, "未能上传：请使用 16MB 以内的 MP3、M4A 或 MP4。", "Upload failed: use MP3, M4A or MP4 up to 16 MB."));
  };
  return <Field label={label} hint={L(locale, "上传文件，或填写以 https:// 开头的地址。", "Upload a file, or enter an https:// address.")}><div className="space-y-2">
    <div className="flex gap-2"><Input value={value} placeholder="https://" onChange={event => onChange(event.target.value.trim())} />
      <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => input.current?.click()}><Upload className="size-4" />{busy ? L(locale, "上传中…", "Uploading…") : L(locale, "上传", "Upload")}</Button></div>
    <input ref={input} type="file" accept={accept} hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} />
    {error && <p className="text-xs text-rose">{error}</p>}</div></Field>;
}

/** Data a display block can read for the current account and child. Without one, the block shows its own content. */
const displaySources: Record<string, { value: string; zh: string; en: string }[]> = {
  card: [{ value: "account.participant", zh: "当前孩子（姓名、阶段、下次上课、星星）", en: "Current child" }],
  metrics: [{ value: "account.summary", zh: "学习概况（星星、本周课次、待完成、出勤）", en: "Learning summary" }],
  progress: [{ value: "account.checkins", zh: "打卡进度（本周、近 30 天）", en: "Check-ins" }],
};
function SourceField({ type, value, locale, onChange }: { type: string; value?: string; locale: Locale; onChange: (value: string | undefined) => void }) {
  const options = displaySources[type] ?? [];
  if (!options.length && !value) return null;
  return <Field label={L(locale, "数据来源", "Data")} hint={L(locale, "选择后由 Mathin 按当前账号和孩子读取，下面填写的内容不再显示。", "Mathin reads it for the current account; the content below is then not shown.")}>
    <select className={select} value={value ?? ""} onChange={event => onChange(event.target.value || undefined)}>
      <option value="">{L(locale, "不读取，显示下面填写的内容", "None: show the content below")}</option>
      {options.map(row => <option key={row.value} value={row.value}>{row[locale]}</option>)}
      {value && !options.some(row => row.value === value) && <option value={value}>{value}</option>}</select></Field>;
}
const list = (value: string) => value.split(/[,，]/).map(part => part.trim()).filter(Boolean);

/** Fields for the block types added with the full runtime block set. */
export function MoreBlockFields({ block, screens, meta, locale, set, optional }: {
  block: RuntimeBlockSpec; screens: RuntimeScreenSpec[]; meta: InspectorMeta; locale: Locale;
  set: (change: Partial<RuntimeBlockSpec>) => void; optional: (key: "action" | "source" | "after", value: unknown) => void;
}): ReactNode[] {
  const title = "title" in block ? <TextField key="title" label={L(locale, "标题", "Title")} value={block.title} locale={locale} onChange={value => set({ title: value } as Partial<RuntimeBlockSpec>)} /> : null;
  switch (block.type) {
    case "tabs": return [
      <Field key="style" label={L(locale, "样式", "Style")}><select className={select} value={block.style} onChange={event => set({ style: event.target.value as "segmented" | "underline" })}>
        <option value="segmented">{L(locale, "分段按钮", "Segmented")}</option><option value="underline">{L(locale, "下划线", "Underline")}</option></select></Field>,
      <p key="hint" className="text-xs text-muted">{L(locale, "在画布上点标签切换；插入的组件会放进当前显示的标签。", "Switch tabs on the canvas; inserted blocks go into the tab shown.")}</p>,
      <Rows key="tabs" label={L(locale, "标签", "Tabs")} rows={block.tabs} locale={locale} title={tab => local(tab.label, locale)}
        create={() => ({ id: id("tab"), label: runtimeText("新标签", "New tab"), blocks: [] })} onChange={tabs => tabs.length >= 2 && set({ tabs })}>
        {(tab, change) => <TextField label={L(locale, "标签名称", "Label")} value={tab.label} locale={locale} onChange={label => change({ ...tab, label })} />}</Rows>];
    case "collapse": return [title,
      <TextField key="summary" label={L(locale, "说明", "Summary")} value={block.summary} locale={locale} onChange={summary => set({ summary })} />,
      <label key="open" className="flex items-center gap-2 text-sm"><input type="checkbox" checked={block.open} onChange={event => set({ open: event.target.checked })} />{L(locale, "默认展开", "Open by default")}</label>];
    case "video": return [title,
      <MediaField key="src" label={L(locale, "视频", "Video")} value={block.src} locale={locale} accept="video/mp4" onChange={src => set({ src })} />,
      <ImageField key="poster" label={L(locale, "封面", "Poster")} value={block.poster} locale={locale} onChange={poster => set({ poster })} />];
    case "audio": return [title,
      <label key="loop" className="flex items-center gap-2 text-sm"><input type="checkbox" checked={block.loop} onChange={event => set({ loop: event.target.checked })} />{L(locale, "列表循环播放", "Repeat the list")}</label>,
      <p key="hint" className="text-xs text-muted">{L(locale, "离开页面或锁屏后继续播放。", "Keeps playing after leaving the page or locking the phone.")}</p>,
      <Rows key="tracks" label={L(locale, "音频", "Tracks")} rows={block.tracks} locale={locale} title={track => local(track.title, locale)}
        create={() => ({ id: id("track"), title: runtimeText("新音频", "New track"), subtitle: runtimeText(), src: "" })} onChange={tracks => set({ tracks })}>
        {(track, change) => <>
          <TextField label={L(locale, "名称", "Title")} value={track.title} locale={locale} onChange={value => change({ ...track, title: value })} />
          <TextField label={L(locale, "说明", "Subtitle")} value={track.subtitle} locale={locale} onChange={subtitle => change({ ...track, subtitle })} />
          <MediaField label={L(locale, "音频文件", "Audio")} value={track.src} locale={locale} accept="audio/mpeg,audio/mp4,audio/x-m4a" onChange={src => change({ ...track, src })} /></>}</Rows>];
    case "card": return [
      <Field key="style" label={L(locale, "样式", "Style")}><select className={select} value={block.style} onChange={event => set({ style: event.target.value as "certificate" | "credential" | "plain" })}>
        <option value="credential">{L(locale, "凭证（学员卡、听课证）", "Credential")}</option><option value="certificate">{L(locale, "证书", "Certificate")}</option><option value="plain">{L(locale, "信息卡", "Info card")}</option></select></Field>,
      <SourceField key="source" type="card" value={block.source} locale={locale} onChange={value => optional("source", value)} />,
      title, <TextField key="subtitle" label={L(locale, "副标题", "Subtitle")} value={block.subtitle} locale={locale} onChange={subtitle => set({ subtitle })} />,
      <TextField key="stamp" label={L(locale, "印章文字", "Stamp")} value={block.stamp} locale={locale} onChange={stamp => set({ stamp })} />,
      <Rows key="fields" label={L(locale, "信息行", "Fields")} rows={block.fields} locale={locale} title={row => `${local(row.label, locale)}：${local(row.value, locale)}`}
        create={() => ({ label: runtimeText("项目", "Item"), value: runtimeText() })} onChange={fields => set({ fields })}>
        {(row, change) => <><TextField label={L(locale, "名称", "Label")} value={row.label} locale={locale} onChange={label => change({ ...row, label })} />
          <TextField label={L(locale, "内容", "Value")} value={row.value} locale={locale} onChange={value => change({ ...row, value })} /></>}</Rows>,
      <ImageField key="image" label={L(locale, "图片或二维码", "Image or code")} value={block.image} locale={locale} onChange={image => set({ image })} />,
      <Field key="refresh" label={L(locale, "自动刷新（秒，0 为不刷新）", "Refresh every (seconds, 0 = never)")}><Input type="number" min={0} max={3600} value={block.refreshSeconds ?? 0}
        onChange={event => set({ refreshSeconds: Math.max(0, Math.min(3600, Number(event.target.value) || 0)) })} /></Field>,
      <ActionField key="action" label={L(locale, "点击后", "On tap")} value={block.action} screens={screens} locale={locale} onChange={value => optional("action", value)} />];
    case "metrics": return [title,
      <Field key="columns" label={L(locale, "每行个数", "Per row")}><select className={select} value={block.columns} onChange={event => set({ columns: Number(event.target.value) as 2 | 3 | 4 })}>
        {[2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}</select></Field>,
      <SourceField key="source" type="metrics" value={block.source} locale={locale} onChange={value => optional("source", value)} />,
      ...(block.source ? [] : [<Rows key="items" label={L(locale, "指标", "Metrics")} rows={block.items} locale={locale} title={row => `${local(row.label, locale)} ${row.value}`}
        create={() => ({ label: runtimeText("指标", "Metric"), value: "0", unit: runtimeText(), hint: runtimeText() })} onChange={items => set({ items })}>
        {(row, change) => <><TextField label={L(locale, "名称", "Label")} value={row.label} locale={locale} onChange={label => change({ ...row, label })} />
          <Field label={L(locale, "数值", "Value")}><Input value={row.value} onChange={event => change({ ...row, value: event.target.value.slice(0, 20) })} /></Field>
          <TextField label={L(locale, "单位", "Unit")} value={row.unit} locale={locale} onChange={unit => change({ ...row, unit })} /></>}</Rows>])];
    case "chart": return [title,
      <Field key="kind" label={L(locale, "图表", "Chart")}><select className={select} value={block.kind} onChange={event => set({ kind: event.target.value as typeof block.kind })}>
        <option value="radar">{L(locale, "雷达图", "Radar")}</option><option value="bar">{L(locale, "条形图", "Bars")}</option><option value="trend">{L(locale, "趋势图", "Trend")}</option><option value="ring">{L(locale, "环形图", "Ring")}</option></select></Field>,
      <Field key="labels" label={L(locale, "项目（用逗号分隔）", "Items (comma separated)")}><Input value={block.labels.map(row => local(row, locale)).join("，")}
        onChange={event => set({ labels: list(event.target.value).slice(0, 12).map(value => locale === "zh" ? runtimeText(value, "") : runtimeText("", value)) })} /></Field>,
      <Rows key="series" label={L(locale, "数据组（最多 3 组，可对比班级平均）", "Series (up to 3)")} rows={block.series} locale={locale} title={row => local(row.name, locale)}
        create={() => ({ name: runtimeText("班级平均", "Class average"), values: block.labels.map(() => 60) })} onChange={series => set({ series: series.slice(0, 3) })}>
        {(row, change) => <><TextField label={L(locale, "名称", "Name")} value={row.name} locale={locale} onChange={name => change({ ...row, name })} />
          <Field label={L(locale, "数值（与项目一一对应）", "Values (one per item)")}><Input value={row.values.join(", ")} onChange={event => change({ ...row, values: list(event.target.value).map(Number).filter(Number.isFinite).slice(0, 12) })} /></Field></>}</Rows>,
      <Field key="max" label={L(locale, "满分（0 为按数据最大值）", "Maximum (0 = largest value)")}><Input type="number" min={0} value={block.max} onChange={event => set({ max: Math.max(0, Number(event.target.value) || 0) })} /></Field>,
      <TextField key="caption" multiline label={L(locale, "说明", "Caption")} value={block.caption} locale={locale} onChange={caption => set({ caption })} />];
    case "progress": return [title,
      <SourceField key="source" type="progress" value={block.source} locale={locale} onChange={value => optional("source", value)} />,
      ...(block.source ? [] : [<Rows key="items" label={L(locale, "进度", "Items")} rows={block.items} locale={locale} title={row => `${local(row.label, locale)} ${row.value}/${row.max}`}
        create={() => ({ label: runtimeText("进度", "Progress"), value: 1, max: 10, caption: runtimeText() })} onChange={items => set({ items })}>
        {(row, change) => <><TextField label={L(locale, "名称", "Label")} value={row.label} locale={locale} onChange={label => change({ ...row, label })} />
          <div className="grid grid-cols-2 gap-2"><Field label={L(locale, "完成", "Done")}><Input type="number" min={0} value={row.value} onChange={event => change({ ...row, value: Math.max(0, Number(event.target.value) || 0) })} /></Field>
            <Field label={L(locale, "总数", "Total")}><Input type="number" min={1} value={row.max} onChange={event => change({ ...row, max: Math.max(1, Number(event.target.value) || 1) })} /></Field></div></>}</Rows>])];
    case "badges": return [title,
      <Field key="columns" label={L(locale, "每行个数", "Per row")}><select className={select} value={block.columns} onChange={event => set({ columns: Number(event.target.value) as 3 | 4 | 5 })}>
        {[3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}</select></Field>,
      <Rows key="items" label={L(locale, "徽章", "Badges")} rows={block.items} locale={locale} title={row => local(row.label, locale)}
        create={() => ({ id: id("badge"), label: runtimeText("新徽章", "New badge"), image: "asset:icons/complete", earned: false, caption: runtimeText() })} onChange={items => set({ items })}>
        {(row, change) => <><TextField label={L(locale, "名称", "Label")} value={row.label} locale={locale} onChange={label => change({ ...row, label })} />
          <ImageField label={L(locale, "图案", "Image")} value={row.image} locale={locale} onChange={image => change({ ...row, image })} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={row.earned} onChange={event => change({ ...row, earned: event.target.checked })} />{L(locale, "已获得（未获得显示为灰色）", "Earned (others are grey)")}</label>
          <TextField label={L(locale, "说明", "Caption")} value={row.caption} locale={locale} onChange={caption => change({ ...row, caption })} /></>}</Rows>];
    case "table": return [title,
      <Field key="columns" label={L(locale, "表头（用逗号分隔）", "Columns (comma separated)")}><Input value={block.columns.map(row => local(row, locale)).join("，")}
        onChange={event => { const columns = list(event.target.value).slice(0, 6); if (columns.length) set({ columns: columns.map(value => locale === "zh" ? runtimeText(value, "") : runtimeText("", value)) }); }} /></Field>,
      <Field key="rows" label={L(locale, "内容（每行一条，单元格用 | 分隔）", "Rows (one per line, cells split by |)")}>
        <Textarea rows={5} value={block.rows.map(row => row.map(cell => local(cell, locale)).join(" | ")).join("\n")}
          onChange={event => set({ rows: event.target.value.split("\n").filter(line => line.trim()).slice(0, 60).map(line => line.split("|").slice(0, 6).map(cell => locale === "zh" ? runtimeText(cell.trim(), "") : runtimeText("", cell.trim()))) })} /></Field>];
    case "form": return [
      <Field key="form" label={L(locale, "表单", "Form")} hint={L(locale, "提交后在“服务申请受理”中处理，家长可在申请记录中查看回复。", "Handled in service requests; families see the reply in their requests.")}>
        <select className={select} value={block.formId} onChange={event => set({ formId: event.target.value })}>
          <option value="">{L(locale, "选择表单", "Choose a form")}</option>
          {meta.forms.map(form => <option key={form.id} value={form.id}>{form.title}</option>)}</select></Field>,
      <SettingsLink key="open" label={L(locale, "编辑表单的问题", "Edit the form's questions")} target={{ kind: "forms", id: block.formId || undefined }} locale={locale} />,
      <SettingsLink key="requests" label={L(locale, "查看提交（服务申请受理）", "See submissions")} href="/dashboard/miniapp-settings?tab=requests" locale={locale} />,
      <TextField key="title" label={L(locale, "标题（留空用表单名称）", "Title (blank uses the form name)")} value={block.title} locale={locale} onChange={value => set({ title: value })} />,
      <TextField key="submit" label={L(locale, "提交按钮文字（留空用表单设置）", "Submit label")} value={block.submitLabel} locale={locale} onChange={submitLabel => set({ submitLabel })} />,
      <ActionField key="after" label={L(locale, "提交成功后", "After submitting")} value={block.after} screens={screens} locale={locale} onChange={value => optional("after", value)} />];
    case "bar": return [
      <p key="hint" className="text-xs text-muted">{L(locale, "固定在页面底部，适合“提交订正”“请假”等主要操作。", "Pinned to the bottom of the page for the main actions.")}</p>,
      <Rows key="buttons" label={L(locale, "按钮（最多 3 个）", "Buttons (up to 3)")} rows={block.buttons} locale={locale} title={row => local(row.label, locale)}
        create={() => ({ id: id("button"), label: runtimeText("按钮", "Button"), appearance: "secondary" as const, action: { type: "login" as const } })} onChange={buttons => buttons.length && set({ buttons: buttons.slice(0, 3) })}>
        {(row, change) => <><TextField label={L(locale, "文字", "Label")} value={row.label} locale={locale} onChange={label => change({ ...row, label })} />
          <Field label={L(locale, "样式", "Style")}><select className={select} value={row.appearance} onChange={event => change({ ...row, appearance: event.target.value as "primary" | "secondary" })}>
            <option value="primary">{L(locale, "主按钮", "Primary")}</option><option value="secondary">{L(locale, "次按钮", "Secondary")}</option></select></Field>
          <ActionField label={L(locale, "点击后", "On tap")} value={row.action} screens={screens} locale={locale} allowNone={false} onChange={action => action && change({ ...row, action })} /></>}</Rows>];
    default: return [];
  }
}
