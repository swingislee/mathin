"use client";
/* eslint-disable @next/next/no-img-element -- Staff preview reads authenticated image responses. */
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { WorkbenchContext } from "./WorkbenchContext";
import { workbenchGroups, workbenchItems } from "./workbench-model";
import { CapabilitiesView, DataDefinitionsView, ModulesView, NativePagesView, StructureView } from "./WorkbenchViews";
import { ContextPhonePreview } from "./WorkspacePhonePreview";
import { ReferenceField } from "./ExperienceServiceEditor";
import { ContentEditor } from "./ContentEditor";
import styles from "./workbench.module.css";
import { newId } from "@/lib/uuid";
import { defaultMiniappSettings, miniappText, type MiniappSettings, type MiniappHomeBlock, type MiniappContact } from "../../../../contracts/participant-api/miniapp-settings";
import type { SettingsState } from "./contract";
import { loadMiniappSettings, restoreMiniappSettings, saveMiniappSettings, uploadMiniappImage } from "./actions";
import { BookingPolicyEditor } from "./BookingPolicyEditor";
import { ContactsEditor } from "./ContactsEditor";
import { ReportTemplatesEditor } from "./ReportTemplatesEditor";
import { ActionField, LocalizedField, MenuEditor, MoveControls, moveItem, settingsField } from "./fields";
import { defaultMiniappExperience } from "../../../../contracts/participant-api/miniapp-experience-templates";
import { settingsExperienceIssues } from "../../../../contracts/participant-api/miniapp-experience-validation";
import { ExperienceContext } from "./ExperienceContext";
import { ExperienceWorkbench, experienceTabs } from "./ExperienceWorkbench";
const withExperience = (value: MiniappSettings): MiniappSettings => ({ ...value, experience: value.experience || defaultMiniappExperience(value) });

const imageUrl = (path: string) => path ? `/api/v1/participant/settings/image?preview=1&path=${encodeURIComponent(path)}` : "";
export function MiniappSettingsEditor({ initial, locale, activities = [], contactOptions, initialTab = "home" }: { initial: SettingsState; locale: "zh" | "en"; activities?: { id: string; title: string }[]; initialTab?: string;
  contactOptions?: { campuses: { id: string; name: string }[]; legacy: MiniappContact[] } }) {
  const en = locale === "en";
  const [state, setState] = useState(initial), [config, setConfig] = useState(() => withExperience(initial.draft || defaultMiniappSettings()));
  const [baseline, setBaseline] = useState(JSON.stringify(withExperience(initial.draft || defaultMiniappSettings())));
  const [tab, setTab] = useState(workbenchItems.some(item => item.id === initialTab) ? initialTab : "native-pages"), [notice, setNotice] = useState(""), [conflict, setConflict] = useState(false), [busy, start] = useTransition();
  const [selectedIds, setSelectedIds] = useState<Record<string, string>>({}), [previewHost, setPreviewHost] = useState<HTMLElement | null>(null);
  const [expandedGroup, expandGroup] = useState<string>(workbenchGroups.find(g => g.items.some(i => i[0] === initialTab))?.id || "presentation");
  const navigate = (nextTab: string, id = "") => { setTab(nextTab); setSelectedIds(ids => ({ ...ids, [nextTab]: id })); expandGroup(workbenchGroups.find(g => g.items.some(i => i[0] === nextTab))?.id || "presentation"); };
  const selectedId = selectedIds[tab] || "", item = workbenchItems.find(item => item.id === tab)!;
  const dirty = JSON.stringify(config) !== baseline;
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault(); window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const failure = (code: string) => code === "FORM_CHANGED" ? (en ? "Another edit was saved. Your changes are kept; reload to review the current draft." : "已有其他修改保存。当前输入已保留，请重新载入后核对。")
    : code === "VALIDATION" ? (en ? "Check field lengths, images and required values." : "请检查字段长度、图片和必填内容。") : (en ? "Could not save. Please retry." : "未能完成，请重试。");
  const run = (operation: () => Promise<void>) => start(async () => { try { await operation(); } catch { setNotice(failure("UNAVAILABLE")); } });
  const accept = (next: SettingsState) => { const value = next.draft || defaultMiniappSettings(); setState(next); setConfig(withExperience(value)); setBaseline(JSON.stringify(withExperience(value))); setConflict(false); };
  function save(publish: boolean) {
    if (publish && settingsExperienceIssues(config).length) { setNotice(en ? "Resolve the listed configuration items before publishing. You can still save a draft." : "请先处理下方配置问题再发布，当前内容可以保存为草稿。"); return; }
    run(async () => {
      const r = await saveMiniappSettings(config, state.revision, publish);
      if (!r.ok) { setNotice(failure(r.code)); setConflict(r.code === "FORM_CHANGED"); return; }
      accept(r.data); setNotice(publish ? (en ? "Published. The Mini Program refreshes its configuration within a minute." : "已发布，小程序将在一分钟内刷新展示配置。") : (en ? "Draft saved." : "草稿已保存。"));
    });
  }
  function reload() { run(async () => { const r = await loadMiniappSettings(); if (r.ok) { accept(r.data); setNotice(""); } else setNotice(failure(r.code)); }); }
  function restore(revision: number) { run(async () => { const r = await restoreMiniappSettings(revision, state.revision); if (r.ok) { accept(r.data); setNotice(en ? "Restored as a draft. Preview and publish when ready." : "已恢复为草稿，预览后可重新发布。"); } else { setNotice(failure(r.code)); setConflict(r.code === "FORM_CHANGED"); } }); }
  function upload(file: File, update: (path: string) => void, qr = false) { run(async () => {
    const form = new FormData(); form.set("image", file); if (qr) form.set("kind", "qr"); const r = await uploadMiniappImage(form);
    if (r.ok) { update(r.data.path); setNotice(en ? "Image optimized and uploaded. Save or publish to use it." : "图片已压缩并上传，保存或发布后使用。"); } else setNotice(failure(r.code));
  }); }
  const imagePicker = (path: string, update: (path: string) => void) => <div className="flex flex-wrap items-center gap-3">{path && <img src={imageUrl(path)} className="h-20 w-32 rounded-lg object-contain" alt={en ? "Preview" : "预览"} />}
    <label className="grid gap-1 text-sm">{en ? "Image (JPG / PNG / WebP, up to 5 MB)" : "图片（JPG / PNG / WebP，5 MB 内）"}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) upload(file, update); }} /></label>
    {path && <Button type="button" variant="ghost" size="sm" onClick={() => update("")}>{en ? "Remove image" : "移除图片"}</Button>}</div>;
  const patchHome = (index: number, change: Partial<MiniappHomeBlock>) => setConfig(v => ({ ...v, home: v.home.map((b, i) => i === index ? { ...b, ...change } : b) }));
  const issues = settingsExperienceIssues(config);
  return <ExperienceContext.Provider value={config.experience}><WorkbenchContext.Provider value={{ previewHost, selectedId, select: id => setSelectedIds(ids => ({ ...ids, [tab]: id })), navigate, config, tab, activities }}><div className={styles.workspace + " space-y-4"}>
    <div className="flex flex-wrap items-center gap-3"><Button disabled={busy || conflict} onClick={() => save(false)} variant="secondary">{en ? "Save draft" : "保存草稿"}</Button>
      <Button disabled={busy || conflict} onClick={() => save(true)}>{en ? "Publish" : "发布"}</Button>
      <span className="text-sm text-muted">{dirty ? (en ? "Unsaved changes" : "有未保存修改") : state.publishedAt ? `${en ? "Published" : "最近发布"} ${new Date(state.publishedAt).toLocaleString(locale)}` : (en ? "Not published" : "尚未发布")}</span>
      {conflict && <Button variant="secondary" disabled={busy} onClick={reload}>{en ? "Reload draft" : "重新载入草稿"}</Button>}</div>
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {issues.length > 0 && <details className="border-l-2 border-crater pl-3"><summary className="cursor-pointer text-sm">{en ? `${issues.length} configuration items need attention before publishing` : `${issues.length} 项配置需要在发布前补齐`}</summary><ul className="mt-2 space-y-1 text-sm text-muted">{issues.slice(0, 30).map((issue, index) => <li key={index}>{issue[locale]} <span className="text-xs">({issue.path})</span></li>)}</ul></details>}
    <div className={styles.columns}>
    <nav className={styles.navigation} aria-label={en ? "Mini Program configuration" : "小程序配置分组"}>
      {workbenchGroups.map(group => <section key={group.id} className="mb-3"><button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-semibold text-muted" aria-expanded={expandedGroup === group.id} onClick={() => expandGroup(expandedGroup === group.id ? "" : group.id)}>{group.title[locale]}<span aria-hidden>{expandedGroup === group.id ? "−" : "+"}</span></button>{expandedGroup === group.id && <div className="space-y-1">{group.items.map(([id, title]) => <button key={id} type="button" aria-current={tab === id ? "page" : undefined} className={"block w-full rounded-md px-3 py-2 text-left text-sm leading-6 " + (tab === id ? "bg-moon font-medium text-ink" : "text-muted hover:bg-line/30 hover:text-ink")} onClick={() => { setTab(id); expandGroup(group.id); }}>{title[locale]}</button>)}</div>}</section>)}
      <a href={`/${locale}/dashboard/miniapp-settings/documents`} className="mt-5 block border-t border-line px-3 pt-4 text-xs text-muted underline">{en ? "Help & agreements" : "帮助与协议文档"}</a>
    </nav>
    <main className={styles.editor}><div className={styles.fields}><header className="mb-6 space-y-2"><p className="text-xs text-muted">{item.group[locale]} / {item.title[locale]}</p><h2 className="text-lg font-semibold">{item.title[locale]}</h2><p className="text-xs leading-5 text-muted">{item.description[locale]}</p></header>
    <fieldset disabled={busy} className="min-w-0 space-y-5">
      {tab === "structure" && <StructureView config={config} locale={locale} />}
      {tab === "native-pages" && <NativePagesView config={config} locale={locale} />}
      {tab === "modules" && <ModulesView config={config} locale={locale} onChange={setConfig} />}
      {tab === "data" && <DataDefinitionsView config={config} locale={locale} />}
      {tab === "capabilities" && <CapabilitiesView config={config} locale={locale} />}
      {config.experience && (tab in experienceTabs || tab === "reports") && <ExperienceWorkbench key={tab} tab={tab} value={config.experience} locale={locale} activities={activities} onChange={experience => setConfig(v => ({ ...v, experience }))} upload={upload} />}
      {tab === "brand" && <div className="max-w-3xl space-y-5"><LocalizedField label={en ? "Display name" : "展示名称"} value={config.brand.name} max={60} onChange={name => setConfig(v => ({ ...v, brand: { ...v.brand, name } }))} />
        <LocalizedField label={en ? "Introduction" : "品牌介绍"} value={config.brand.introduction} max={500} multiline onChange={introduction => setConfig(v => ({ ...v, brand: { ...v.brand, introduction } }))} />
        {imagePicker(config.brand.image, image => setConfig(v => ({ ...v, brand: { ...v.brand, image } })))}
        <label className="grid max-w-xs gap-1 text-sm">{en ? "Theme" : "主题"}<select className={settingsField} value={config.brand.theme} onChange={e => setConfig(v => ({ ...v, brand: { ...v.brand, theme: e.target.value as MiniappSettings["brand"]["theme"] } }))}><option value="paper">{en ? "Paper" : "纸色"}</option><option value="leaf">{en ? "Leaf" : "叶绿"}</option><option value="rose">{en ? "Rose" : "玫瑰"}</option></select></label></div>}
      {tab === "home" && config.experience && <ReferenceField label={en ? "Homepage composition" : "首页使用的编排"} value={config.experience.homePageId} choices={config.experience.pages.filter(p => p.purpose !== "report" && p.audience === "all")} locale={locale} onChange={homePageId => setConfig(v => ({ ...v, experience: { ...v.experience!, homePageId } }))} empty={en ? "Current homepage modules" : "当前首页模块"} />}
      {tab === "home" && config.experience?.homePageId && (() => { const page = config.experience.pages.find(p => p.id === config.experience!.homePageId); return page ? <ContentEditor value={page} experience={config.experience} locale={locale} upload={upload} onChange={next => setConfig(v => ({ ...v, experience: { ...v.experience!, pages: v.experience!.pages.map(p => p.id === next.id ? next : p) } }))} /> : null; })()}
      {tab === "home" && !config.experience?.homePageId && <div><div className="divide-y divide-line">{config.home.map((b, i) => <div key={b.id} className="space-y-4 py-5">
        <MoveControls index={i} length={config.home.length} move={offset => setConfig(v => ({ ...v, home: moveItem(v.home, i, offset) }))} remove={() => setConfig(v => ({ ...v, home: v.home.filter((_, index) => index !== i) }))} en={en}>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={b.visible} onChange={e => patchHome(i, { visible: e.target.checked })} />{en ? "Visible" : "展示"}</label>
          <select aria-label={en ? "Block type" : "模块类型"} className={settingsField + " max-w-44"} value={b.type} onChange={e => patchHome(i, { type: e.target.value as MiniappHomeBlock["type"] })}>{(["feature", "activities", "text", "image"] as const).map((type, n) => <option value={type} key={type}>{en ? ["Feature", "Activity list", "Text", "Image"][n] : ["主推入口", "活动列表", "文字介绍", "图片"][n]}</option>)}</select>
        </MoveControls>
        <LocalizedField label={en ? "Title" : "标题"} value={b.title} onChange={title => patchHome(i, { title })} />
        <LocalizedField label={en ? "Description" : "说明"} value={b.body} max={2000} multiline onChange={body => patchHome(i, { body })} />
        {b.type === "activities" ? <><label className="grid max-w-36 gap-1 text-sm">{en ? "Shown activities" : "展示活动数"}<input className={settingsField} type="number" min={1} max={12} value={b.limit} onChange={e => patchHome(i, { limit: Number(e.target.value) })} /></label>
          <div className="space-y-2 text-sm"><span>{en ? "Featured activities (shown first when matching filters)" : "推荐活动（符合筛选时优先展示）"}</span>
            {b.featuredIds.map((id, index) => <MoveControls key={id} en={en} index={index} length={b.featuredIds.length} move={offset => patchHome(i, { featuredIds: moveItem(b.featuredIds, index, offset) })} remove={() => patchHome(i, { featuredIds: b.featuredIds.filter(v => v !== id) })}><span>{activities.find(a => a.id === id)?.title || (en ? "Currently unavailable activity" : "当前未公开的活动")}</span></MoveControls>)}
            <select aria-label={en ? "Add featured activity" : "添加推荐活动"} className={settingsField} value="" disabled={b.featuredIds.length >= 30} onChange={e => { if (e.target.value) patchHome(i, { featuredIds: [...b.featuredIds, e.target.value] }); }}><option value="">{en ? "Select a published activity" : "选择已公开活动"}</option>{activities.filter(a => !b.featuredIds.includes(a.id)).map(a => <option key={a.id} value={a.id}>{a.title}</option>)}</select></div></>
          : <>{imagePicker(b.image, image => patchHome(i, { image }))}<ActionField value={b.action} target={b.target} locale={locale} onChange={(action, target) => patchHome(i, { action, target })} /></>}
      </div>)}<div className="pt-4"><Button type="button" variant="secondary" disabled={config.home.length >= 12} onClick={() => setConfig(v => ({ ...v, home: [...v.home, { id: newId(), type: "text", visible: true, title: { zh: "", en: "" }, body: { zh: "", en: "" }, image: "", action: "none", target: "", limit: 3, featuredIds: [] }] }))}>{en ? "Add block" : "添加模块"}</Button></div></div>
</div>}
      {tab === "menus" && <div className="max-w-3xl space-y-8"><section><h3 className="font-medium">{en ? "Home shortcuts" : "首页快捷入口"}</h3><MenuEditor value={config.floating} locale={locale} max={5} onChange={floating => setConfig(v => ({ ...v, floating }))} /></section>
        <section className="space-y-5 border-t border-line pt-6"><h3 className="font-medium">{en ? "Account services" : "我的服务入口"}</h3>{config.accountGroups.map((group, index) => <div key={group.id} className="space-y-3 border-b border-line pb-6">
          <MoveControls en={en} index={index} length={config.accountGroups.length} move={offset => setConfig(v => ({ ...v, accountGroups: moveItem(v.accountGroups, index, offset) }))} remove={() => setConfig(v => ({ ...v, accountGroups: v.accountGroups.filter((_, i) => i !== index) }))} />
          <LocalizedField label={en ? "Group title" : "分组名称"} value={group.title} max={60} onChange={title => setConfig(v => ({ ...v, accountGroups: v.accountGroups.map((g, i) => i === index ? { ...g, title } : g) }))} />
          <MenuEditor value={group.entries} locale={locale} onChange={entries => setConfig(v => ({ ...v, accountGroups: v.accountGroups.map((g, i) => i === index ? { ...g, entries } : g) }))} /></div>)}
          <Button type="button" variant="secondary" disabled={config.accountGroups.length >= 8} onClick={() => setConfig(v => ({ ...v, accountGroups: [...v.accountGroups, { id: newId(), title: { zh: "新分组", en: "New group" }, entries: [] }] }))}>{en ? "Add group" : "添加分组"}</Button></section></div>}
      {tab === "stages" && <div className="max-w-4xl space-y-6">{config.stages.map((group, gi) => <section key={group.id} className="space-y-3 border-b border-line pb-5">
        <MoveControls en={en} index={gi} length={config.stages.length} move={offset => setConfig(v => ({ ...v, stages: moveItem(v.stages, gi, offset) }))} />
        <LocalizedField label={en ? "Group name" : "阶段分组"} value={group.label} max={60} onChange={label => setConfig(v => ({ ...v, stages: v.stages.map((g, i) => i === gi ? { ...g, label } : g) }))} />
        {group.stages.map((stage, si) => <div key={stage.id} className="space-y-2 border-t border-line pt-3"><MoveControls en={en} index={si} length={group.stages.length} move={offset => setConfig(v => ({ ...v, stages: v.stages.map((g, i) => i === gi ? { ...g, stages: moveItem(g.stages, si, offset) } : g) }))}>
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={stage.visible} onChange={e => setConfig(v => ({ ...v, stages: v.stages.map((g, i) => i === gi ? { ...g, stages: g.stages.map((s, j) => j === si ? { ...s, visible: e.target.checked } : s) } : g) }))} />{en ? "Available in new selections" : "新选择中可见"}</label></MoveControls>
          <LocalizedField label={stage.stageNumber < 1 ? `K${stage.stageNumber + 3}` : `${en ? "Grade" : "年级"} ${stage.stageNumber}`} value={stage.label} max={60} onChange={label => setConfig(v => ({ ...v, stages: v.stages.map((g, i) => i === gi ? { ...g, stages: g.stages.map((s, j) => j === si ? { ...s, label } : s) } : g) }))} />
          <select className={settingsField + " max-w-xs"} aria-label={en ? "Stage group" : "所属阶段分组"} value={group.id} onChange={e => setConfig(v => ({ ...v, stages: v.stages.map(g => g.id === group.id ? { ...g, stages: g.stages.filter(s => s.id !== stage.id) } : g.id === e.target.value ? { ...g, stages: [...g.stages, stage] } : g) }))}>{config.stages.map(g => <option key={g.id} value={g.id}>{miniappText(g.label, locale)}</option>)}</select>
        </div>)}</section>)}</div>}
      {tab === "booking" && <BookingPolicyEditor value={config.booking} en={en} onChange={booking => setConfig(v => ({ ...v, booking }))} />}
      {tab === "reports" && <details className="border-t border-line pt-5"><summary className="cursor-pointer text-sm">{en ? "Compatible sections for original reports and clients" : "原报告与旧客户端兼容栏目"}</summary><div className="mt-4"><ReportTemplatesEditor value={config.reports} en={en} onChange={reports => setConfig(v => ({ ...v, reports }))} /></div></details>}
      {tab === "contacts" && (contactOptions ? <ContactsEditor value={config.contacts} legacy={contactOptions.legacy} campuses={contactOptions.campuses} stages={config.stages} locale={locale} onChange={contacts => setConfig(v => ({ ...v, contacts }))} upload={(file, update) => upload(file, update, true)} /> : <p className="text-sm text-muted">{en ? "Contact options could not be loaded. Reload to edit." : "联系服务选项暂未载入，请刷新后编辑。"}</p>)}
      {tab === "history" && <div className="divide-y divide-line">{!state.history.length && <p className="text-sm text-muted">{en ? "No published versions yet." : "暂无发布记录。"}</p>}{state.history.map(row => <div key={row.revision} className="flex items-center justify-between gap-3 py-3"><span className="text-sm">{new Date(row.publishedAt).toLocaleString(locale)} · {en ? "Version" : "版本"} {row.revision}</span><Button variant="secondary" size="sm" disabled={dirty || conflict} onClick={() => restore(row.revision)}>{en ? "Restore as draft" : "恢复为草稿"}</Button></div>)}</div>}
    </fieldset></div></main>
    <aside className={styles.preview} aria-label={en ? "Phone preview" : "手机页面预览"}><div className="mb-3 flex items-center justify-between gap-2"><h3 className="text-xs font-medium">{en ? "Phone preview" : "手机页面预览"}</h3><span className="text-xs text-muted">{en ? "Draft · sample records" : "草稿 · 业务记录为示例"}</span></div><div className={styles.phone}><div className={styles.statusBar}><span>9:41</span><span>{en ? "Preview" : "预览"}</span><span aria-hidden>▰</span></div><div ref={setPreviewHost} className={styles.screen} data-empty={en ? "Select or create an object to preview." : "选择或新建对象后在此预览。"}>{!["pages", "reports", "forms", "structure", "native-pages", "modules", "data", "capabilities"].includes(tab) && !(tab === "home" && config.experience?.homePageId) && <ContextPhonePreview tab={tab} id={selectedId} config={config} locale={locale} />}</div></div><p className="mt-3 text-xs leading-5 text-muted">{en ? "Content and forms reflect this draft. Transactional screens show their structure; submissions here do not create business records." : "内容与表单随草稿更新。业务操作页展示结构，预览不会产生真实提交。"}</p></aside>
    </div>
  </div></WorkbenchContext.Provider></ExperienceContext.Provider>;
}
