"use client";
import { useContext } from "react";
import { Button } from "@/components/ui/button";
import { nativeScreens, nativeScreenConfig, nativeReorderGroups, type NativeScreenConfig } from "../../../../contracts/participant-api/miniapp-native";
import { localText } from "../../../../contracts/participant-api/miniapp-experience";
import type { MiniappSettings } from "../../../../contracts/participant-api/miniapp-settings";
import { LocalizedField, MoveControls, moveItem, settingsField } from "./fields";
import { PhonePreview, WorkbenchContext } from "./WorkbenchContext";
import { ExperiencePreview } from "./ExperiencePreview";
import { workbenchItems } from "./workbench-model";

export function NativeScreenEditor({ config, locale, onChange }: { config: MiniappSettings; locale: "zh" | "en"; onChange: (config: MiniappSettings) => void }) {
  const context = useContext(WorkbenchContext)!, en = locale === "en", x = config.experience!;
  const selected = nativeScreens.find(s => s.id === context.selectedId) || nativeScreens[0], value = nativeScreenConfig(x.screens, selected.id);
  const groups = [...new Set(nativeScreens.map(s => localText(s.group, locale)))];
  const change = (patch: Partial<NativeScreenConfig>) => onChange({ ...config, experience: { ...x, screens: [...(x.screens || []).filter(s => s.id !== value.id), { ...value, ...patch }] } });
  const content = x.pages.filter(p => p.purpose !== "report" && p.audience === "all");
  return <div className="space-y-6"><label className="grid gap-2 text-sm">{en ? "Existing screen" : "选择原生页面"}<select className={settingsField} value={selected.id} onChange={e => context.select(e.target.value)}>{groups.map(group => <optgroup key={group} label={group}>{nativeScreens.filter(s => localText(s.group, locale) === group).map(s => <option key={s.id} value={s.id}>{localText(s.title, locale)}</option>)}</optgroup>)}</select></label>
    <p className="text-sm leading-6 text-muted">{localText(selected.feature, locale)}</p>
    {selected.id === "web" && <p className="text-xs leading-5 text-muted">{en ? "Content settings apply to the copy-link and return screen. The embedded website maintains its own content." : "内容设置用于复制链接及失败返回页面；嵌入网页的内容由对应网站维护。"}</p>}
    {selected.redirect ? <div className="space-y-3"><p className="text-sm">{en ? "This route redirects old activity links. It has no independent content or modules." : "此路由只兼容旧活动链接，没有独立正文或模块。"}</p><Button type="button" variant="secondary" size="sm" onClick={() => context.select(selected.redirect!)}>{en ? "Edit destination page" : "编辑目标页面"}</Button></div> : <>
    <LocalizedField label={en ? "Page title (blank follows the business record)" : "页面标题（留空沿用业务名称）"} value={value.title} max={120} onChange={title => change({ title })} />
    {value.tabLabel && <LocalizedField label={en ? "Bottom navigation label (blank uses the default)" : "底部导航名称（留空沿用默认）"} value={value.tabLabel} max={10} onChange={tabLabel => change({ tabLabel })} />}
    <LocalizedField label={en ? "Page introduction" : "页面说明"} value={value.description} max={1000} multiline onChange={description => change({ description })} />
    <section className="space-y-3 border-t border-line pt-5"><h3 className="text-sm font-semibold">{en ? "Shared content before and after the business area" : "业务区域前后的共用内容"}</h3><p className="text-xs leading-5 text-muted">{en ? "Reference a public composed page to reuse its images, charts, lists and entry buttons. Content is loaded from its published version." : "引用公开组合页面即可复用其中的图文、图表、列表与入口按钮，客户端读取该页面的发布版本。"}</p>{(["beforePageId", "afterPageId"] as const).map(key => <div key={key} className="space-y-2"><label className="grid gap-2 text-sm">{key === "beforePageId" ? (en ? "Before business content" : "业务区域之前") : (en ? "After business content" : "业务区域之后")}<select className={settingsField} value={value[key]} onChange={e => change({ [key]: e.target.value })}><option value="">{en ? "No additional content" : "不添加内容"}</option>{content.map(page => <option key={page.id} value={page.id}>{localText(page.title, locale)}{page.enabled ? "" : (en ? " · disabled" : " · 未启用")}</option>)}</select></label>{value[key] && <button type="button" className="text-xs underline" onClick={() => context.navigate("pages", value[key])}>{en ? "Edit referenced content" : "编辑引用内容"}</button>}</div>)}</section>
    <section className="divide-y divide-line border-t border-line"><h3 className="py-4 text-sm font-semibold">{en ? "Modules rendered on this screen" : "本页实际渲染的模块"}</h3>{value.modules.map(instance => {
      const module = selected.modules.find(m => m.id === instance.id)!;
      const movable = value.modules.filter(m => (nativeReorderGroups[selected.id] || []).includes(m.id)), moveIndex = movable.findIndex(m => m.id === module.id);
      const patch = (next: Partial<typeof instance>) => change({ modules: value.modules.map(v => v.id === module.id ? { ...v, ...next } : v) });
      return <div key={module.id} className="space-y-3 py-5"><div className="flex flex-wrap items-center justify-between gap-3"><strong className="text-sm font-medium">{localText(module.title, locale)}</strong>{module.required ? <span className="text-xs text-muted">{en ? "Required by this feature" : "业务必需"}</span> : <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={instance.visible} onChange={e => patch({ visible: e.target.checked })} />{en ? "Visible" : "显示"}</label>}</div>
      <LocalizedField label={en ? "Section heading (optional)" : "模块标题（可留空）"} max={120} value={instance.title} onChange={title => patch({ title })} />
      {moveIndex >= 0 && <MoveControls en={en} index={moveIndex} length={movable.length} move={offset => { const moved = moveItem(movable, moveIndex, offset); let i = 0; change({ modules: value.modules.map(m => movable.some(v => v.id === m.id) ? moved[i++] : m) }); }} />}
      {module.compact && <label className="grid max-w-52 gap-2 text-sm">{en ? "Row spacing" : "条目间距"}<select className={settingsField} value={instance.density} onChange={e => patch({ density: e.target.value as typeof instance.density })}><option value="comfortable">{en ? "Comfortable" : "舒展"}</option><option value="compact">{en ? "Compact" : "紧凑"}</option></select></label>}
      <details className="text-xs text-muted"><summary className="cursor-pointer">{en ? "Data source and operations" : "数据来源与操作"}</summary><p className="mt-2 break-words leading-5">{module.source}</p>{module.commands.length > 0 && <p className="mt-1 break-words leading-5">{module.commands.join(" · ")}</p>}</details></div>;
    })}</section>
    <section className="space-y-3 border-t border-line pt-5"><h3 className="text-sm font-semibold">{en ? "Business definitions used by this page" : "本页使用的业务定义"}</h3><div className="flex flex-wrap gap-2">{selected.settings.map(tab => <Button key={tab} variant="secondary" size="sm" type="button" onClick={() => context.navigate(tab)}>{localText(workbenchItems.find(i => i.id === tab)?.title, locale)}</Button>)}</div>{selected.editor && <a className="inline-block text-sm underline" href={`/${locale}/dashboard/${selected.editor}`}>{en ? "Open the business editor" : "进入对应业务编辑器"}</a>}<p className="text-xs leading-5 text-muted">{en ? "Record values, permission checks, consent and submission state come from the business feature. Layout settings do not change those facts." : "记录内容、访问权限、协议确认和提交状态来自对应业务；页面设置只调整呈现。"}</p></section>
    <Button type="button" size="sm" variant="ghost" onClick={() => onChange({ ...config, experience: { ...x, screens: (x.screens || []).filter(s => s.id !== selected.id) } })}>{en ? "Use the default presentation" : "恢复本页默认呈现"}</Button>
    </>}
    <PhonePreview><NativeScreenPreview config={config} id={selected.id} locale={locale} /></PhonePreview>
  </div>;
}

export function NativeScreenPreview({ config, id, locale }: { config: MiniappSettings; id: NativeScreenConfig["id"]; locale: "zh" | "en" }) {
  const definition = nativeScreens.find(s => s.id === id)!, value = nativeScreenConfig(config.experience?.screens, id), en = locale === "en", x = config.experience!;
  const referenced = (pageId: string) => { const page = x.pages.find(p => p.id === pageId); return page ? <ExperiencePreview document={page} experience={x} locale={locale} /> : null; };
  return <div><div className="border-b border-line px-5 py-3 text-center text-sm font-semibold">{localText(value.title, locale) || localText(definition.title, locale)}</div><div className="px-5 pt-4"><p className="whitespace-pre-wrap text-sm leading-6 text-muted">{localText(value.description, locale)}</p></div>{referenced(value.beforePageId)}<div className="space-y-4 p-5">{definition.redirect && <p className="text-sm text-muted">{localText(definition.feature, locale)}</p>}{value.modules.filter(m => m.visible).map(instance => {
    const module = definition.modules.find(m => m.id === instance.id)!;
    return <section key={instance.id} className="min-w-0 border-b border-line pb-4"><h3 className="mb-3 text-sm font-medium">{localText(instance.title, locale) || localText(module.title, locale)}</h3>
      {module.kind === "participants" || module.kind === "identity" ? <div className="flex items-center justify-between gap-3 py-3 text-sm"><span>○ {en ? "Sample participant" : "示例参与人"}</span><span>›</span></div>
      : module.kind === "filters" ? <div className="flex gap-3 text-xs text-muted"><span className="rounded-full bg-moon px-3 py-2">{en ? "All" : "全部"}</span><span className="px-3 py-2">{en ? "Select category ▾" : "选择分类 ▾"}</span></div>
      : module.kind === "calendar" || module.kind === "slots" ? <div className="grid grid-cols-7 gap-2 text-center text-xs">{Array.from({ length: 7 }, (_, i) => <span key={i} className={(i === 2 ? "bg-moon " : "") + "rounded-md py-3"}>{i + 1}</span>)}</div>
      : module.kind === "services" ? x.services.filter(s => s.enabled).slice(0, 3).map(s => <div key={s.id} className={instance.density === "compact" ? "py-1" : "py-3"}><p className="text-sm">{localText(s.name, locale)} ›</p><p className="text-xs text-muted">{localText(s.summary, locale)}</p></div>)
      : module.kind === "contacts" ? (config.contacts || []).filter(c => c.visible).slice(0, 3).map(c => <div key={c.id} className={instance.density === "compact" ? "py-1" : "py-3"}><p className="text-sm">{localText(c.name, locale)}</p><p className="text-xs text-muted">{c.phone}</p></div>)
      : ["records", "schedule", "activities", "report", "resources"].includes(module.kind) ? [1, 2].map(n => <div key={n} className={"border-t border-line " + (instance.density === "compact" ? "py-2" : "py-4")}><p className="text-sm">{en ? "Sample record" : "示例业务记录"} {n}</p><p className="mt-1 text-xs text-muted">{en ? "Time · participant · status" : "时间 · 参与人 · 状态"}</p></div>)
      : module.kind === "form" || module.kind === "task" || module.kind === "consent" ? <div className="space-y-3"><div className="rounded-md border border-line px-3 py-3 text-xs text-muted">{en ? "Fields from the business definition" : "由业务定义提供的字段"}</div><div className="rounded-md bg-ink py-3 text-center text-xs text-paper">{en ? "Continue" : "继续"}</div></div>
      : <p className="text-xs leading-6 text-muted">{en ? "Content is supplied by the referenced definition or selected record." : "内容由引用的定义或当前业务记录提供。"}</p>}
    </section>;
  })}</div>{referenced(value.afterPageId)}{["discover", "calendar", "account"].includes(id) && <div className="grid grid-cols-3 border-t border-line py-4 text-center text-xs">{(["discover", "calendar", "account"] as const).map(tab => <span key={tab} className={tab === id ? "font-semibold text-leaf-deep" : "text-muted"}>{localText(nativeScreenConfig(x.screens, tab).tabLabel, locale) || (tab === "discover" ? (en ? "Discover" : "发现") : tab === "calendar" ? (en ? "Calendar" : "日历") : (en ? "Account" : "我的"))}</span>)}</div>}</div>;
}
