import { newId } from "@/lib/uuid";
import { nativeScreenConfig, nativeScreens, type NativeScreenId } from "../../../../contracts/participant-api/miniapp-native";
import { experienceText as t, localText, type ContentBlock, type ContentDocument, type ExperienceField, type MiniappExperience } from "../../../../contracts/participant-api/miniapp-experience";
import { contentKindNames, newContentBlock } from "../../../../contracts/participant-api/miniapp-experience-templates";
import type { MiniappSettings } from "../../../../contracts/participant-api/miniapp-settings";

export type AssemblyTarget = { kind: "native"; id: NativeScreenId } | { kind: "page"; id: string } | { kind: "form"; id: string };
export type AssemblyFocus = { tab: string; id: string; part: string };
export type AssemblyNode = AssemblyFocus & { key: string; label: string; kind: string; visible?: boolean; children?: AssemblyNode[] };
type Locale = "zh" | "en";
const fieldKinds: Record<ExperienceField["type"], [string, string]> = { text: ["单行文字", "Short text"], textarea: ["多行说明", "Long text"], phone: ["联系电话", "Phone"], email: ["电子邮箱", "Email"], number: ["数字", "Number"], date: ["日期", "Date"], select: ["单项选择", "Single choice"], multiselect: ["多项选择", "Multiple choice"], consent: ["确认同意", "Confirmation"] };
export function blockTitle(block: ContentBlock, locale: Locale) {
  return localText("title" in block ? block.title : "text" in block ? block.text : block.kind === "action" ? block.action.label : undefined, locale).slice(0, 60) || localText(contentKindNames[block.kind], locale);
}
export function documentNodes(document: ContentDocument, locale: Locale): AssemblyNode[] {
  return document.blocks.map(block => ({ key: `${document.id}:${block.id}`, tab: document.purpose === "report" ? "reports" : "pages", id: document.id, part: `block:${block.id}`,
    label: blockTitle(block, locale), kind: localText(contentKindNames[block.kind], locale), visible: block.visible }));
}
export function assemblyTitle(config: MiniappSettings, target: AssemblyTarget, locale: Locale) {
  if (target.kind === "native") return localText(nativeScreens.find(s => s.id === target.id)?.title, locale);
  const item = target.kind === "page" ? config.experience?.pages.find(p => p.id === target.id) : config.experience?.forms.find(f => f.id === target.id);
  return localText(item?.title, locale) || (locale === "en" ? "Untitled" : "未命名");
}
export function assemblyFocus(config: MiniappSettings, target: AssemblyTarget): AssemblyFocus {
  return { tab: target.kind === "native" ? "native-pages" : target.kind === "form" ? "forms" : config.experience?.pages.find(p => p.id === target.id)?.purpose === "report" ? "reports" : "pages", id: target.id, part: "" };
}
export function assemblyNodes(config: MiniappSettings, target: AssemblyTarget, locale: Locale): AssemblyNode[] {
  const x = config.experience!, en = locale === "en";
  if (target.kind === "page") { const page = x.pages.find(p => p.id === target.id); return page ? documentNodes(page, locale) : []; }
  if (target.kind === "form") {
    const form = x.forms.find(f => f.id === target.id);
    return (form?.groups || []).map(group => ({ key: group.id, tab: "forms", id: target.id, part: `group:${group.id}`, label: localText(group.title, locale), kind: en ? "Question group" : "问题组",
      children: group.fields.map(field => ({ key: field.id, tab: "forms", id: target.id, part: `field:${group.id}:${field.id}`, label: localText(field.label, locale), kind: fieldKinds[field.type][en ? 1 : 0] })) }));
  }
  const screen = nativeScreens.find(s => s.id === target.id)!, value = nativeScreenConfig(x.screens, target.id);
  const pageNode = (id: string, label: string, key: string): AssemblyNode | null => {
    const page = x.pages.find(p => p.id === id); return page ? { key, tab: page.purpose === "report" ? "reports" : "pages", id, part: "", label, kind: en ? "Layout" : "版式", children: documentNodes(page, locale) } : null;
  };
  const content = (key: "beforePageId" | "afterPageId") => pageNode(value[key], key === "beforePageId" ? (en ? "Content above" : "上方内容") : (en ? "Content below" : "下方内容"), key);
  const modules: AssemblyNode[] = value.modules.map(instance => {
    const componentDefinition = screen.modules.find(m => m.id === instance.id)!;
    const node: AssemblyNode = { key: instance.id, tab: "native-pages", id: target.id, part: `module:${instance.id}`, label: localText(instance.title, locale) || localText(componentDefinition.title, locale), kind: en ? "Component" : "组件", visible: instance.visible, children: [] };
    if (target.id === "discover" && instance.id === "content") {
      const document = x.pages.find(p => p.id === x.homePageId);
      node.children = document ? documentNodes(document, locale) : config.home.map(block => ({ key: block.id, tab: "home", id: "", part: `home:${block.id}`, label: localText(block.title, locale),
        kind: block.type === "feature" ? (en ? "Feature strip" : "横向主推") : block.type === "activities" ? (en ? "Activity strip" : "活动展示条") : (en ? "Content" : "内容"), visible: block.visible }));
    }
    if (target.id === "discover" && instance.id === "shortcuts") {
      node.label = en ? "Floating buttons" : "悬浮按钮";
      node.children = config.floating.map(entry => ({ key: entry.id, tab: "menus", id: "", part: `floating:${entry.id}`, label: localText(entry.title, locale), kind: en ? "Entry" : "入口", visible: entry.visible }));
    }
    if (target.id === "calendar" && instance.id === "calendar") {
      node.label = en ? "Calendar card" : "日历卡";
      node.children = [{ key: "month-layout", tab: "native-pages", id: "agenda", part: "", label: en ? "Expanded calendar layout" : "展开后的日历版式", kind: en ? "Linked page" : "打开的页面" }];
    }
    if (["service-detail", "experience-form", "provider-booking"].includes(target.id) && ["content", "form", "booking"].includes(instance.id)) {
      node.children = x.services.map(service => {
        const flow = x.flows.find(f => f.id === service.flowId), form = x.forms.find(f => f.id === flow?.formId);
        const children: AssemblyNode[] = [];
        const detail = pageNode(service.detailPageId, en ? "Service content" : "详情内容", "detail:" + service.id); if (detail) children.push(detail);
        if (form) children.push({ key: "form:" + service.id, tab: "forms", id: form.id, part: "", label: localText(form.title, locale), kind: en ? "Form" : "表单" });
        const success = pageNode(flow?.confirmationPageId || "", en ? "Submission success card" : "提交成功卡", "success:" + service.id); if (success) children.push(success);
        return { key: service.id, tab: "offerings", id: service.id, part: "", label: localText(service.name, locale), kind: en ? "Service" : "服务", children };
      });
    }
    if (target.id === "reflections") node.children = x.pages.filter(p => p.purpose === "report").map(p => pageNode(p.id, localText(p.title, locale), p.id)!);
    return node;
  });
  return [content("beforePageId"), ...modules, content("afterPageId")].filter((node): node is AssemblyNode => !!node);
}

/** Add a real published-content componentDefinition. Native controllers keep ownership of their transactional steps. */
export function addAssemblyBlock(config: MiniappSettings, target: AssemblyTarget, kind: ContentBlock["kind"], position: "beforePageId" | "afterPageId", id = newId(), pageId = newId()) {
  const x = config.experience!;
  if (target.kind === "form") throw new Error("FORM_EXPECTS_FIELDS");
  const screen = target.kind === "native" ? nativeScreenConfig(x.screens, target.id) : null;
  let document = x.pages.find(p => p.id === (screen ? screen[position] : target.id));
  if (document?.purpose === "report" && kind === "accountRecords") throw new Error("LIVE_RECORDS_IN_REPORT");
  if (!document && target.kind === "page") throw new Error("PAGE_MISSING");
  if (!document) {
    if (x.pages.length >= 50) throw new Error("PAGE_LIMIT");
    document = { id: pageId, version: 1, title: t("补充内容", "Additional content"), description: t(), purpose: "page", audience: "all", enabled: true, layout: "reading", blocks: [] };
  }
  if (document.blocks.length >= 80) throw new Error("MODULE_LIMIT");
  const next = { ...document, blocks: [...document.blocks, newContentBlock(kind, id)] };
  const experience: MiniappExperience = { ...x, pages: x.pages.some(p => p.id === next.id) ? x.pages.map(p => p.id === next.id ? next : p) : [...x.pages, next] };
  if (screen) experience.screens = [...(x.screens || []).filter(s => s.id !== screen.id), { ...screen, [position]: next.id }];
  return { config: { ...config, experience }, focus: { tab: next.purpose === "report" ? "reports" : "pages", id: next.id, part: `block:${id}` } };
}

export function addAssemblyField(config: MiniappSettings, formId: string, type: ExperienceField["type"], label: { zh: string; en: string }, groupId?: string) {
  const x = config.experience!, form = x.forms.find(f => f.id === formId); if (!form) throw new Error("FORM_MISSING");
  const group = form.groups.find(g => g.id === groupId) || form.groups[0]; if (!group || group.fields.length >= 40) throw new Error("FIELD_LIMIT");
  const field: ExperienceField = { id: newId(), type, label, help: t(), placeholder: t(), required: false,
    options: ["select", "multiselect"].includes(type) ? [{ id: newId(), label: t("选项一", "Option one") }] : [] };
  return { config: { ...config, experience: { ...x, forms: x.forms.map(f => f.id === form.id ? { ...f, groups: f.groups.map(g => g.id === group.id ? { ...g, fields: [...g.fields, field] } : g) } : f) } },
    focus: { tab: "forms", id: form.id, part: `field:${group.id}:${field.id}` } };
}
