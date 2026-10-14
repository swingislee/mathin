"use client";
import { type ReactNode } from "react";
import { ChevronRight, ExternalLink } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { localText } from "../../../../contracts/participant-api/miniapp-experience";
import type { MiniappContact, MiniappSettings } from "../../../../contracts/participant-api/miniapp-settings";
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
import { libraryNames, libraryItems, moreSettings, type LibraryKind, type LibraryTarget, type Locale } from "./model";

export type LibraryUpload = (file: File, accept: (path: string) => void, qr?: boolean) => void;
export type ContactOptions = { campuses: { id: string; name: string }[]; legacy: MiniappContact[] };
const L = (locale: Locale, zh: string, en: string) => locale === "zh" ? zh : en;
const groups: { zh: string; en: string; kinds: LibraryKind[] }[] = [
  { zh: "基础", en: "Basics", kinds: ["brand", "stages", "contacts"] },
  { zh: "预约", en: "Booking", kinds: ["booking"] },
  { zh: "内容", en: "Content", kinds: ["pages", "forms", "reports"] },
];

/** Left column of the library: settings that pages use, opened one level deeper than the canvas. */
export function LibraryList({ settings, target, locale, onOpen }: { settings: MiniappSettings; target: LibraryTarget | null; locale: Locale; onOpen: (target: LibraryTarget) => void }) {
  const row = (key: string, label: ReactNode, active: boolean, onClick: () => void, depth = 0) =>
    <button type="button" key={key} onClick={onClick} style={{ paddingLeft: 12 + depth * 14 }}
      className={cn("flex w-full items-center gap-2 py-1.5 pr-3 text-left text-sm hover:bg-moon/20", active && "bg-moon/30 font-medium", depth && "text-xs")}>{label}</button>;
  return <div className="py-2">
    {groups.map(group => <div key={group.zh} className="pb-2">
      <p className="px-3 pb-1 text-[11px] font-medium text-muted">{group[locale]}</p>
      {group.kinds.map(kind => {
        const items = libraryItems(settings, kind), open = target?.kind === kind;
        return <div key={kind}>
          {row(kind, <><span className="min-w-0 flex-1 truncate">{libraryNames[kind][locale]}</span>{items && <span className="text-[11px] text-muted">{items.length}</span>}</>,
            open && !(items && target?.id), () => onOpen({ kind }))}
          {open && items?.map(item => row(item.id, <span className={cn("min-w-0 flex-1 truncate", !item.enabled && "text-muted")}>{localText(item.title, locale) || L(locale, "未命名", "Untitled")}{!item.enabled && L(locale, "（未启用）", " (off)")}</span>,
            (target?.id || items[0]?.id) === item.id, () => onOpen({ kind, id: item.id }), 1))}
        </div>;
      })}
    </div>)}
    <div className="border-t border-line pt-2">
      <p className="px-3 pb-1 text-[11px] font-medium text-muted">{L(locale, "更多设置（在原设置页打开）", "More settings (original page)")}</p>
      {moreSettings.map(item => <Link key={item.tab} href={item.href ?? `/dashboard/miniapp-settings?tab=${item.tab}`}
        className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted hover:bg-moon/20 hover:text-ink"><span className="min-w-0 flex-1 truncate">{item[locale]}</span><ExternalLink className="size-3.5 shrink-0" /></Link>)}
    </div>
  </div>;
}

/** Editor for one library object. Pages, forms and reports reuse the settings editors and render their phone preview into `previewHost`. */
export function LibraryEditor({ target, settings, contactOptions, activities, locale, previewHost, upload, onChange, onOpen }: {
  target: LibraryTarget; settings: MiniappSettings; contactOptions?: ContactOptions; activities: { id: string; title: string }[]; locale: Locale;
  previewHost: HTMLElement | null; upload: LibraryUpload; onChange: (change: (value: MiniappSettings) => MiniappSettings) => void; onOpen: (target: LibraryTarget) => void;
}) {
  const en = locale === "en", experience = settings.experience!;
  const context = {
    previewHost, selectedId: target.id ?? "", select: (id: string) => onOpen({ kind: target.kind, id }), config: settings, tab: target.kind, activities,
    // References inside the editors open library objects here and everything else in the original settings page.
    navigate: (tab: string, id = "") => {
      const kind = ({ pages: "pages", reports: "reports", forms: "forms", contacts: "contacts", stages: "stages", booking: "booking", brand: "brand" } as Record<string, LibraryKind>)[tab];
      if (kind) onOpen({ kind, id: id || undefined }); else window.location.assign(`/${locale}/dashboard/miniapp-settings?tab=${tab}`);
    },
  };
  let body: ReactNode = null;
  switch (target.kind) {
    case "brand":
      body = <div className="space-y-5">
        <LocalizedField label={L(locale, "小程序里显示的机构名称", "Name shown in the Mini Program")} value={settings.brand.name} max={60} onChange={name => onChange(v => ({ ...v, brand: { ...v.brand, name } }))} />
        <label className="grid max-w-xs gap-1 text-sm">{L(locale, "主题颜色", "Theme")}<select className={settingsField} value={settings.brand.theme}
          onChange={e => onChange(v => ({ ...v, brand: { ...v.brand, theme: e.target.value as MiniappSettings["brand"]["theme"] } }))}>
          <option value="paper">{L(locale, "纸色", "Paper")}</option><option value="leaf">{L(locale, "叶绿", "Leaf")}</option><option value="rose">{L(locale, "玫瑰", "Rose")}</option></select></label>
        <p className="text-xs text-muted">{L(locale, "页面顶部选择“左侧显示机构名称”时显示这里的名称。", "Pages with the brand top bar show this name.")}</p>
      </div>;
      break;
    case "stages":
      body = <><p className="mb-4 text-sm text-muted">{L(locale, "“参与者阶段”筛选、孩子年级和联系方式的适用阶段都使用这里的名称。", "Stage filters, participant grades and contact stages use these labels.")}</p>
        <StagesEditor value={settings.stages} locale={locale} onChange={stages => onChange(v => ({ ...v, stages }))} /></>;
      break;
    case "contacts":
      body = contactOptions ? <ContactsEditor value={settings.contacts} legacy={contactOptions.legacy} campuses={contactOptions.campuses} stages={settings.stages} locale={locale}
        onChange={contacts => onChange(v => ({ ...v, contacts }))} upload={(file, accept) => upload(file, accept, true)} />
        : <p className="text-sm text-muted">{L(locale, "联系服务选项暂未载入，请刷新后编辑。", "Contact options could not be loaded. Reload to edit.")}</p>;
      break;
    case "booking":
      body = <BookingPolicyEditor value={settings.booking} en={en} onChange={booking => onChange(v => ({ ...v, booking }))} />;
      break;
    case "pages": case "forms": case "reports":
      body = <>
        <ExperienceWorkbench key={target.kind} tab={target.kind} value={experience} locale={locale} activities={activities} upload={upload}
          onChange={next => onChange(v => ({ ...v, experience: next }))} />
        {target.kind === "reports" && <details className="mt-6 border-t border-line pt-5"><summary className="cursor-pointer text-sm">{L(locale, "原报告与旧客户端兼容栏目", "Compatible sections for original reports and clients")}</summary>
          <div className="mt-4"><ReportTemplatesEditor value={settings.reports} en={en} onChange={reports => onChange(v => ({ ...v, reports }))} /></div></details>}
      </>;
      break;
  }
  return <ExperienceContext.Provider value={experience}><WorkbenchContext.Provider value={context}>
    <div className={styles.fields}>{body}</div>
  </WorkbenchContext.Provider></ExperienceContext.Provider>;
}

/** What the open library object looks like in the Mini Program, for objects whose editor has no preview of its own. */
export function LibraryPreview({ target, settings, locale, canvas }: { target: LibraryTarget; settings: MiniappSettings; locale: Locale; canvas: ReactNode }) {
  if (target.kind === "contacts" || target.kind === "booking")
    return <div className={styles.phone}><NativePhonePreview screenId={target.kind === "contacts" ? "service" : "assessment"} config={settings} locale={locale} /></div>;
  return <>{canvas}</>;
}

export function Breadcrumb({ trail, locale, onBack }: { trail: string[]; locale: Locale; onBack: () => void }) {
  return <div className="flex min-w-0 flex-1 items-center gap-1 text-sm">
    <button type="button" onClick={onBack} className="shrink-0 text-muted hover:text-ink">{L(locale, "画布", "Canvas")}</button>
    {trail.map((part, index) => <span key={index} className={cn("flex min-w-0 items-center gap-1", index === trail.length - 1 ? "font-medium" : "text-muted")}>
      <ChevronRight className="size-3.5 shrink-0 text-muted" /><span className="truncate">{part}</span></span>)}
  </div>;
}
