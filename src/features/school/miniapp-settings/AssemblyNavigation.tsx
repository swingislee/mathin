"use client";
import { useState } from "react";
import { ChevronRight, Layers, LayoutTemplate, Plus, Settings2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { nativeScreens } from "../../../../contracts/participant-api/miniapp-native";
import { experienceText as t, localText, type ExperienceField } from "../../../../contracts/participant-api/miniapp-experience";
import { contentKindNames } from "../../../../contracts/participant-api/miniapp-experience-templates";
import { moduleGroups } from "../../../../contracts/participant-api/miniapp-experience-catalog";
import type { MiniappSettings } from "../../../../contracts/participant-api/miniapp-settings";
import { addAssemblyBlock, addAssemblyField, assemblyFocus, assemblyNodes, assemblyTitle, type AssemblyFocus, type AssemblyNode, type AssemblyTarget } from "./assembly-model";
import { workbenchGroups } from "./workbench-model";
import { settingsField } from "./fields";
import styles from "./workbench.module.css";

/** Edited in the Mini Program workbench, or explanations that are no longer listed. */
const movedToWorkbench = new Set(["structure", "home", "pages", "reports", "modules", "menus", "data", "forms", "stages", "contacts", "capabilities", "booking", "brand"]);

export function AssemblyNavigation({ config, locale, target, focus, onTarget, onFocus, onChange, initialTab }: {
  config: MiniappSettings; locale: "zh" | "en"; target: AssemblyTarget; focus: AssemblyFocus;
  onTarget: (target: AssemblyTarget) => void; onFocus: (focus: AssemblyFocus) => void; onChange: (config: MiniappSettings) => void; initialTab: string;
}) {
  const en = locale === "en", x = config.experience!;
  const [view, setView] = useState(["native-pages", "pages", "reports", "forms", "home", "modules"].includes(initialTab) ? "pages" : "settings");
  const [position, setPosition] = useState<"beforePageId" | "afterPageId">("afterPageId"), [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const active = (node: AssemblyFocus) => node.tab === focus.tab && node.id === focus.id && node.part === focus.part;
  const inspect = (next: AssemblyFocus) => {
    if (next.tab === "forms" && next.id && target.kind !== "form") { onTarget({ kind: "form", id: next.id }); setView("pages"); }
    if (next.tab === "native-pages" && next.id && next.id !== target.id) { const screen = nativeScreens.find(s => s.id === next.id); if (screen) onTarget({ kind: "native", id: screen.id }); }
    if (["home", "menus"].includes(next.tab) && (target.kind !== "native" || target.id !== "discover")) onTarget({ kind: "native", id: "discover" });
    onFocus(next); setNotice("");
  };
  const nodes = assemblyNodes(config, target, locale);
  const choose = (next: AssemblyTarget) => { onTarget(next); setView("pages"); setNotice(""); };
  const roots = (items: { target: AssemblyTarget; title: string; enabled?: boolean }[]) => items.filter(item => !search || item.title.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(item => {
    const selected = item.target.kind === target.kind && item.target.id === target.id;
    return <div key={item.target.kind + item.target.id}><button type="button" className={styles.treePage} aria-current={selected ? "page" : undefined} onClick={() => choose(item.target)}>
      <ChevronRight size={13} className={selected ? "rotate-90" : ""} /><LayoutTemplate size={15} /><span>{item.title}</span>{item.enabled === false && <span className="text-[10px] text-muted">{en ? "Draft" : "草稿"}</span>}
    </button>{selected && <div className={styles.outline} aria-label={en ? "Page components" : "页面组成"}>
      <button type="button" className={styles.treeNode} aria-current={active(assemblyFocus(config, target)) ? "true" : undefined} onClick={() => inspect(assemblyFocus(config, target))}><Settings2 size={13} /><span>{en ? "Page properties" : "页面属性"}</span></button>
      {nodes.map(node => <Node key={node.key} node={node} active={active} inspect={inspect} />)}
      <button type="button" className={styles.addComponent} onClick={() => setView("components")}><Plus size={13} />{en ? "Add a component" : "添加组件"}</button>
    </div>}</div>;
  });
  const insert = (operation: () => { config: MiniappSettings; focus: AssemblyFocus }) => {
    try { const result = operation(); onChange(result.config); inspect(result.focus); setView("pages"); }
    catch { setNotice(en ? "This page cannot accept another component here. Select another page or remove an unused item." : "当前位置已达到组件数量限制，请选择其他页面或移除不用的项目。"); }
  };
  const insertionTarget: AssemblyTarget = ["pages", "reports"].includes(focus.tab) && x.pages.some(p => p.id === focus.id) ? { kind: "page", id: focus.id } : target;
  const report = insertionTarget.kind === "page" && x.pages.find(p => p.id === insertionTarget.id)?.purpose === "report";
  return <nav className={styles.navigation} aria-label={en ? "Page assembly" : "页面装配"}>
    <Tabs value={view} onValueChange={setView}><TabsList className="mb-4 grid w-full grid-cols-3"><TabsTrigger value="pages">{en ? "Pages" : "页面"}</TabsTrigger><TabsTrigger value="components">{en ? "Components" : "组件"}</TabsTrigger><TabsTrigger value="settings">{en ? "Settings" : "设置"}</TabsTrigger></TabsList></Tabs>
    {view === "pages" && <><input className={settingsField + " mb-3 text-xs"} aria-label={en ? "Find a page" : "查找页面"} placeholder={en ? "Find a page…" : "查找页面…"} value={search} onChange={e => setSearch(e.target.value)} />
      <div className={styles.treeHeading}>{en ? "Feature pages" : "功能页面"}</div>{roots(nativeScreens.filter(s => !["discover", "calendar", "account"].includes(s.id) && !s.redirect && !["experience", "web"].includes(s.id)).map(s => ({ target: { kind: "native", id: s.id }, title: localText(s.title, locale) })))}
    </>}
    {view === "components" && <><div className="mb-4 space-y-2"><p className="text-xs text-muted">{en ? "Add to" : "添加到"}</p><strong className="text-sm">{assemblyTitle(config, insertionTarget, locale)}</strong>{insertionTarget.kind === "native" && <select className={settingsField + " text-xs"} aria-label={en ? "Insert position" : "插入位置"} value={position} onChange={e => setPosition(e.target.value as typeof position)}><option value="afterPageId">{en ? "Below this page's content" : "页面内容下方"}</option><option value="beforePageId">{en ? "Above this page's content" : "页面内容上方"}</option></select>}</div>
      {target.kind === "form" ? <div className="grid gap-1">{([["text", "单行文字", "Short text"], ["textarea", "多行说明", "Long text"], ["select", "单项选择", "Single choice"], ["multiselect", "多项选择", "Multiple choice"], ["number", "数字", "Number"], ["date", "日期", "Date"], ["time", "时间", "Time"], ["phone", "联系电话", "Phone"], ["email", "电子邮箱", "Email"], ["rating", "评分", "Rating"], ["address", "收货地址", "Address"], ["media", "照片 / 文件", "Photos / files"], ["consent", "确认同意", "Confirmation"]] as const).map(([type, zh, english]) => <button key={type} type="button" className={styles.paletteItem} onClick={() => insert(() => addAssemblyField(config, target.id, type as ExperienceField["type"], t(zh, english), focus.part.split(":")[1]))}><Plus size={14} /><span>{en ? english : zh}</span></button>)}</div>
      : moduleGroups.filter(group => group.id !== "report" || report).map(group => <section key={group.id} className="mb-4"><h3 className={styles.treeHeading}>{localText(group.name, locale)}</h3>{group.kinds.filter(kind => !report || kind !== "accountRecords").map(kind => <button type="button" key={kind} className={styles.paletteItem} onClick={() => insert(() => addAssemblyBlock(config, insertionTarget, kind, position))}><Plus size={14} /><span>{localText(contentKindNames[kind], locale)}</span></button>)}</section>)}
    </>}
    {view === "settings" && <>{workbenchGroups.map(group => ({ ...group, items: group.items.filter(([id]) => !movedToWorkbench.has(id)) })).filter(group => group.items.length).map(group => <details key={group.id} open={group.items.some(([id]) => id === focus.tab)} className="mb-2"><summary className={styles.treeHeading}>{localText(group.title, locale)}</summary>{group.items.map(([id, title]) => <button type="button" key={id} className={styles.treeNode} aria-current={focus.tab === id ? "true" : undefined} onClick={() => {
      if (id === "native-pages") choose({ kind: "native", id: "assessment" });
      else if (id === "forms" && x.forms[0]) choose({ kind: "form", id: x.forms[0].id });
      else if (["pages", "reports"].includes(id) && x.pages.some(p => (p.purpose === "report") === (id === "reports"))) choose({ kind: "page", id: x.pages.find(p => (p.purpose === "report") === (id === "reports"))!.id });
      else inspect({ tab: id, id: "", part: "" });
    }}><span>{localText(title, locale)}</span></button>)}</details>)}<a className="mt-4 block px-2 text-xs underline" href={`/${locale}/dashboard/miniapp-settings/documents`}>{en ? "Help & agreements" : "帮助与协议文档"}</a></>}
    {notice && <p role="status" className="mt-3 text-xs text-rose">{notice}</p>}
  </nav>;
}

function Node({ node, active, inspect }: { node: AssemblyNode; active: (node: AssemblyFocus) => boolean; inspect: (focus: AssemblyFocus) => void }) {
  return <div><button type="button" className={styles.treeNode} aria-current={active(node) ? "true" : undefined} data-visible={node.visible !== false} onClick={() => inspect(node)} title={node.kind}>
    <Layers size={12} /><span className="min-w-0 flex-1 truncate">{node.label}</span>{node.visible === false && <span aria-label="hidden">○</span>}
  </button>{!!node.children?.length && <div className={styles.nestedOutline}>{node.children.map(child => <Node key={child.key} node={child} active={active} inspect={inspect} />)}</div>}</div>;
}
