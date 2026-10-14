"use client";
import { NativeScreenEditor, NativeScreenPreview } from "./NativeScreenEditor";
import { AssemblyNavigation } from "./AssemblyNavigation";
import { assemblyFocus, assemblyNodes, assemblyTitle, type AssemblyFocus, type AssemblyNode, type AssemblyTarget } from "./assembly-model";
import { DashboardPage, DashboardCommandPanel, DashboardCommandActions } from "@/features/school/dashboard-page";
import { nativeScreens } from "../../../../contracts/participant-api/miniapp-native";

/* eslint-disable @next/next/no-img-element -- Staff preview reads authenticated image responses. */
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { WorkbenchContext } from "./WorkbenchContext";
import { workbenchItems } from "./workbench-model";
import { CapabilitiesView, DataDefinitionsView, ModulesView, StructureView } from "./WorkbenchViews";
import { ContextPhonePreview } from "./WorkspacePhonePreview";
import { ReferenceField } from "./ExperienceServiceEditor";
import { ContentEditor } from "./ContentEditor";
import styles from "./workbench.module.css";
import { newId } from "@/lib/uuid";
import { defaultMiniappSettings, type MiniappSettings, type MiniappHomeBlock, type MiniappContact } from "../../../../contracts/participant-api/miniapp-settings";
import type { SettingsState } from "./contract";
import { loadMiniappSettings, restoreMiniappSettings, saveMiniappSettings, uploadMiniappImage } from "./actions";
import { BookingPolicyEditor } from "./BookingPolicyEditor";
import { StagesEditor } from "./StagesEditor";
import { ContactsEditor } from "./ContactsEditor";
import { ReportTemplatesEditor } from "./ReportTemplatesEditor";
import { ActionField, LocalizedField, MenuEditor, MoveControls, moveItem, settingsField } from "./fields";
import { defaultMiniappExperience } from "../../../../contracts/participant-api/miniapp-experience-templates";
import { settingsExperienceIssues } from "../../../../contracts/participant-api/miniapp-experience-validation";
import { ExperienceContext } from "./ExperienceContext";
import { ExperienceWorkbench, experienceTabs } from "./ExperienceWorkbench";
const withExperience = (value: MiniappSettings): MiniappSettings => ({ ...value, experience: value.experience || defaultMiniappExperience(value) });
function initialAssembly(config: MiniappSettings, tab: string): AssemblyTarget {
  const x = config.experience!;
  const page = x.pages.find(p => (p.purpose === "report") === (tab === "reports"));
  if (["pages", "reports"].includes(tab) && page) return { kind: "page", id: page.id };
  if (tab === "forms" && x.forms[0]) return { kind: "form", id: x.forms[0].id };
  return { kind: "native", id: "assessment" };
}

const imageUrl = (path: string) => path ? `/api/v1/participant/settings/image?preview=1&path=${encodeURIComponent(path)}` : "";
export function MiniappSettingsEditor({ initial, locale, activities = [], contactOptions, initialTab = "home", activityLoadFailed = false }: { initial: SettingsState; locale: "zh" | "en"; activities?: { id: string; title: string }[]; initialTab?: string; activityLoadFailed?: boolean;
  contactOptions?: { campuses: { id: string; name: string }[]; legacy: MiniappContact[] } }) {
  const en = locale === "en";
  const [state, setState] = useState(initial), [config, setConfig] = useState(() => withExperience(initial.draft || defaultMiniappSettings()));
  const [baseline, setBaseline] = useState(JSON.stringify(withExperience(initial.draft || defaultMiniappSettings())));
  const [tab, setTab] = useState(workbenchItems.some(item => item.id === initialTab) ? initialTab : "native-pages"), [notice, setNotice] = useState(""), [conflict, setConflict] = useState(false), [busy, start] = useTransition();
  const [selectedIds, setSelectedIds] = useState<Record<string, string>>(() => ["native-pages", "pages", "reports", "forms"].includes(initialTab) ? { [initialTab]: initialAssembly(config, initialTab).id } : {}), [previewHost, setPreviewHost] = useState<HTMLElement | null>(null);
  const [assemblyTarget, setAssemblyTarget] = useState<AssemblyTarget>(() => initialAssembly(config, initialTab)), [selectedPart, selectPart] = useState("");
  const inspect = ({ tab: nextTab, id, part }: AssemblyFocus) => { setTab(nextTab); setSelectedIds(ids => ({ ...ids, [nextTab]: id })); selectPart(part); };
  const chooseTarget = (target: AssemblyTarget) => { setAssemblyTarget(target); inspect(assemblyFocus(config, target)); };
  const navigate = (nextTab: string, id = "", part = "") => {
    inspect({ tab: nextTab, id, part });
    if (nextTab === "native-pages") setAssemblyTarget({ kind: "native", id: nativeScreens.find(s => s.id === id)?.id || "assessment" });
    else if (["pages", "reports"].includes(nextTab)) { const page = config.experience!.pages.find(p => p.id === id) || config.experience!.pages.find(p => (p.purpose === "report") === (nextTab === "reports")); if (page) setAssemblyTarget({ kind: "page", id: page.id }); }
    else if (nextTab === "forms") { const form = config.experience!.forms.find(f => f.id === id) || config.experience!.forms[0]; if (form) setAssemblyTarget({ kind: "form", id: form.id }); }
  };
  const selectedId = selectedIds[tab] || "", item = workbenchItems.find(item => item.id === tab)!;
  const focus = { tab, id: selectedId, part: selectedPart };
  const allNodes = assemblyNodes(config, assemblyTarget, locale).flatMap(function flatten(node: AssemblyNode): AssemblyNode[] { return [node, ...(node.children || []).flatMap(flatten)]; });
  const focusedNode = allNodes.find(node => node.tab === tab && node.id === selectedId && node.part === selectedPart);
  const currentTitle = tab === "native-pages" ? assemblyTitle(config, { kind: "native", id: nativeScreens.find(s => s.id === selectedId)?.id || "assessment" }, locale) : ["pages", "reports", "forms"].includes(tab) ? assemblyTitle(config, { kind: tab === "forms" ? "form" : "page", id: selectedId }, locale) : item.title[locale];
  const nativePreview = tab === "native-pages" ? (nativeScreens.find(s => s.id === selectedId)?.id || "assessment") : assemblyTarget.kind === "native" && ["home", "menus", "pages"].includes(tab) ? assemblyTarget.id : null;
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
      accept(r.data); setNotice(publish ? (en ? "Published. The Mini Program checks for updates when a page is reopened; configuration is cached for up to one minute." : "已发布。小程序重新进入页面时检查更新，展示配置最多缓存一分钟。") : (en ? "Draft saved." : "草稿已保存。"));
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
  return <ExperienceContext.Provider value={config.experience}><WorkbenchContext.Provider value={{ previewHost: nativePreview ? null : previewHost, selectedId, select: id => navigate(tab, id), navigate, config, tab, activities, assembly: true, selectedPart, selectPart }}>
    <DashboardPage className={styles.page} title={en ? "More Mini Program settings" : "小程序更多设置"} backHref="/dashboard/miniapp-runtime" backLabel={en ? "Mini Program" : "小程序"} commandPanel={<DashboardCommandPanel><DashboardCommandActions>
      <span className="text-sm text-muted">{dirty ? (en ? "Unsaved changes" : "有未保存修改") : state.publishedAt ? `${en ? "Published" : "最近发布"} ${new Date(state.publishedAt).toLocaleString(locale)}` : (en ? "Not published" : "尚未发布")}</span>
      {conflict && <Button variant="secondary" disabled={busy} onClick={reload}>{en ? "Reload draft" : "重新载入草稿"}</Button>}
      <Button disabled={busy || conflict} onClick={() => save(false)} variant="secondary">{en ? "Save draft" : "保存草稿"}</Button><Button disabled={busy || conflict} onClick={() => save(true)}>{en ? "Publish" : "发布"}</Button>
    </DashboardCommandActions></DashboardCommandPanel>}><div className={styles.workspace + " space-y-4"}>
    {activityLoadFailed && <p className="text-sm text-muted">{en ? "Activity choices could not be loaded. Reload to edit recommendations." : "活动选项暂未载入，编辑推荐活动前请刷新重试。"}</p>}
    <p className="text-sm text-muted">{en ? "Pages, name and theme, stages, contacts, assessment rules, content pages, forms and report layouts are edited in the Mini Program workbench. This page keeps services, flows and other settings not yet moved there." : "页面、名称与主题、学习阶段、联系方式、诊断预约规则、图文页、表单和报告版式都在「小程序」操作台里编辑；这里保留服务、流程等还没搬过去的设置。"} <Link href="/dashboard/miniapp-runtime" className="text-ink underline underline-offset-4">{en ? "Open the workbench" : "回到操作台"}</Link></p>
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {issues.length > 0 && <details className="border-l-2 border-crater pl-3"><summary className="cursor-pointer text-sm">{en ? `${issues.length} configuration items need attention before publishing` : `${issues.length} 项配置需要在发布前补齐`}</summary><ul className="mt-2 space-y-1 text-sm text-muted">{issues.slice(0, 30).map((issue, index) => <li key={index}>{issue[locale]} <span className="text-xs">({issue.path})</span></li>)}</ul></details>}
    <div className={styles.columns}>
    <AssemblyNavigation config={config} locale={locale} target={assemblyTarget} focus={focus} onTarget={chooseTarget} onFocus={inspect} onChange={setConfig} initialTab={initialTab} />
    <main className={styles.editor}><div className={styles.fields}><header className="mb-5 space-y-1"><p className="text-xs text-muted">{focusedNode ? focusedNode.kind : item.group[locale]}</p><h2 className="text-lg font-semibold">{focusedNode?.label || currentTitle}</h2></header>
    <fieldset disabled={busy} className="min-w-0 space-y-5">
      {tab === "structure" && <StructureView config={config} locale={locale} />}
      {tab === "native-pages" && <NativeScreenEditor config={config} locale={locale} onChange={setConfig} />}
      {tab === "modules" && <ModulesView config={config} locale={locale} onChange={setConfig} />}
      {tab === "data" && <DataDefinitionsView config={config} locale={locale} />}
      {tab === "capabilities" && <CapabilitiesView config={config} locale={locale} />}
      {config.experience && (tab in experienceTabs || tab === "reports") && <ExperienceWorkbench key={tab} tab={tab} value={config.experience} locale={locale} activities={activities} onChange={experience => setConfig(v => ({ ...v, experience }))} upload={upload} />}
      {tab === "brand" && <div className="max-w-3xl space-y-5"><LocalizedField label={en ? "Display name" : "展示名称"} value={config.brand.name} max={60} onChange={name => setConfig(v => ({ ...v, brand: { ...v.brand, name } }))} />
        <LocalizedField label={en ? "Introduction" : "品牌介绍"} value={config.brand.introduction} max={500} multiline onChange={introduction => setConfig(v => ({ ...v, brand: { ...v.brand, introduction } }))} />
        {imagePicker(config.brand.image, image => setConfig(v => ({ ...v, brand: { ...v.brand, image } })))}
        <label className="grid max-w-xs gap-1 text-sm">{en ? "Theme" : "主题"}<select className={settingsField} value={config.brand.theme} onChange={e => setConfig(v => ({ ...v, brand: { ...v.brand, theme: e.target.value as MiniappSettings["brand"]["theme"] } }))}><option value="paper">{en ? "Paper" : "纸色"}</option><option value="leaf">{en ? "Leaf" : "叶绿"}</option><option value="rose">{en ? "Rose" : "玫瑰"}</option></select></label></div>}
      {tab === "home" && !selectedPart && config.experience && <ReferenceField label={en ? "Homepage composition" : "首页使用的编排"} value={config.experience.homePageId} choices={config.experience.pages.filter(p => p.purpose !== "report" && p.audience === "all")} locale={locale} onChange={homePageId => setConfig(v => ({ ...v, experience: { ...v.experience!, homePageId } }))} empty={en ? "Current homepage modules" : "当前首页模块"} />}
      {tab === "home" && config.experience?.homePageId && (() => { const page = config.experience.pages.find(p => p.id === config.experience!.homePageId); return page ? <ContentEditor value={page} experience={config.experience} locale={locale} upload={upload} onChange={next => setConfig(v => ({ ...v, experience: { ...v.experience!, pages: v.experience!.pages.map(p => p.id === next.id ? next : p) } }))} /> : null; })()}
      {tab === "home" && !config.experience?.homePageId && <div><div className="divide-y divide-line">{config.home.map((b, i) => (!selectedPart.startsWith("home:") || selectedPart === `home:${b.id}`) && <div key={b.id} className="space-y-4 py-5">
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
      {tab === "menus" && <div className="max-w-3xl space-y-8"><section><h3 className="font-medium">{en ? "Home shortcuts" : "首页快捷入口"}</h3><MenuEditor value={config.floating} locale={locale} max={5} focusedId={selectedPart.startsWith("floating:") ? selectedPart.slice(9) : undefined} onChange={floating => setConfig(v => ({ ...v, floating }))} /></section>
        {!selectedPart.startsWith("floating:") && <section className="space-y-5 border-t border-line pt-6"><h3 className="font-medium">{en ? "Account services" : "我的服务入口"}</h3>{config.accountGroups.map((group, index) => <div key={group.id} className="space-y-3 border-b border-line pb-6">
          <MoveControls en={en} index={index} length={config.accountGroups.length} move={offset => setConfig(v => ({ ...v, accountGroups: moveItem(v.accountGroups, index, offset) }))} remove={() => setConfig(v => ({ ...v, accountGroups: v.accountGroups.filter((_, i) => i !== index) }))} />
          <LocalizedField label={en ? "Group title" : "分组名称"} value={group.title} max={60} onChange={title => setConfig(v => ({ ...v, accountGroups: v.accountGroups.map((g, i) => i === index ? { ...g, title } : g) }))} />
          <MenuEditor value={group.entries} locale={locale} onChange={entries => setConfig(v => ({ ...v, accountGroups: v.accountGroups.map((g, i) => i === index ? { ...g, entries } : g) }))} /></div>)}
          <Button type="button" variant="secondary" disabled={config.accountGroups.length >= 8} onClick={() => setConfig(v => ({ ...v, accountGroups: [...v.accountGroups, { id: newId(), title: { zh: "新分组", en: "New group" }, entries: [] }] }))}>{en ? "Add group" : "添加分组"}</Button></section>}</div>}
      {tab === "stages" && <StagesEditor value={config.stages} locale={locale} onChange={stages => setConfig(v => ({ ...v, stages }))} />}
      {tab === "booking" && <BookingPolicyEditor value={config.booking} en={en} onChange={booking => setConfig(v => ({ ...v, booking }))} />}
      {tab === "reports" && <details className="border-t border-line pt-5"><summary className="cursor-pointer text-sm">{en ? "Compatible sections for original reports and clients" : "原报告与旧客户端兼容栏目"}</summary><div className="mt-4"><ReportTemplatesEditor value={config.reports} en={en} onChange={reports => setConfig(v => ({ ...v, reports }))} /></div></details>}
      {tab === "contacts" && (contactOptions ? <ContactsEditor value={config.contacts} legacy={contactOptions.legacy} campuses={contactOptions.campuses} stages={config.stages} locale={locale} onChange={contacts => setConfig(v => ({ ...v, contacts }))} upload={(file, update) => upload(file, update, true)} /> : <p className="text-sm text-muted">{en ? "Contact options could not be loaded. Reload to edit." : "联系服务选项暂未载入，请刷新后编辑。"}</p>)}
      {tab === "history" && <div className="divide-y divide-line">{!state.history.length && <p className="text-sm text-muted">{en ? "No published versions yet." : "暂无发布记录。"}</p>}{state.history.map(row => <div key={row.revision} className="flex items-center justify-between gap-3 py-3"><span className="text-sm">{new Date(row.publishedAt).toLocaleString(locale)} · {en ? "Version" : "版本"} {row.revision}</span><Button variant="secondary" size="sm" disabled={dirty || conflict} onClick={() => restore(row.revision)}>{en ? "Restore as draft" : "恢复为草稿"}</Button></div>)}</div>}
    </fieldset></div></main>
    <aside className={styles.preview} aria-label={en ? "Phone preview" : "手机页面预览"}><div className="mb-3 flex items-center justify-between gap-2"><h3 className="text-xs font-medium">{en ? "Phone preview" : "手机页面预览"}</h3><span className="text-xs text-muted">{en ? "Draft · sample records" : "草稿 · 业务记录为示例"}</span></div><div className={styles.phone}><div className={styles.statusBar}><span>9:41</span><span>{en ? "Preview" : "预览"}</span><span aria-hidden>▰</span></div><div ref={setPreviewHost} className={styles.screen} data-empty={en ? "Select or create an object to preview." : "选择或新建对象后在此预览。"}>{nativePreview ? <NativeScreenPreview config={config} id={nativePreview} locale={locale} onFocus={inspect} focus={focus} /> : !["pages", "reports", "forms", "structure", "native-pages", "modules", "data", "capabilities"].includes(tab) && !(tab === "home" && config.experience?.homePageId) && <ContextPhonePreview tab={tab} id={selectedId} config={config} locale={locale} />}</div></div><p className="mt-3 text-xs leading-5 text-muted">{en ? "Content and forms reflect this draft. Transactional screens show their structure; submissions here do not create business records." : "内容与表单随草稿更新。业务操作页展示结构，预览不会产生真实提交。"}</p></aside>
    </div>
  </div></DashboardPage></WorkbenchContext.Provider></ExperienceContext.Provider>;
}
