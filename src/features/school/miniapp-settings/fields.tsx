"use client";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { newId } from "@/lib/uuid";
import { miniappActions, miniappIcons, type MiniappAction, type MiniappEntry, type MiniappText } from "../../../../contracts/participant-api/miniapp-settings";

export const settingsField = "w-full rounded-lg border border-line bg-card px-3 py-2 text-sm";
export const actionNames: Record<MiniappAction, MiniappText> = {
  none: { zh: "无跳转", en: "No action" }, assessment: { zh: "诊断预约", en: "Assessments" }, activities: { zh: "活动列表", en: "Activities" },
  applications: { zh: "报名记录", en: "Applications" }, service: { zh: "联系服务", en: "Contact service" }, agenda: { zh: "全部安排", en: "Arrangements" },
  calendar: { zh: "日历", en: "Calendar" }, reflections: { zh: "思考回顾", en: "Reflections" }, records: { zh: "活动记录", en: "Activity records" },
  participants: { zh: "参与人档案", en: "Participants" }, register: { zh: "参与登记", en: "Registration" }, guardian: { zh: "关联已有孩子", en: "Link child" },
  account: { zh: "账号设置", en: "Account" }, privacy: { zh: "隐私说明", en: "Privacy" }, document: { zh: "帮助文档", en: "Help document" },
};
export function LocalizedField({ label, value, onChange, max = 120, multiline = false }: {
  label: string; value: MiniappText; onChange: (v: MiniappText) => void; max?: number; multiline?: boolean;
}) {
  return <div className="grid gap-1 text-sm"><span>{label}</span><div className="grid gap-2 sm:grid-cols-2">{(["zh", "en"] as const).map(locale => <label key={locale} className="grid gap-1">
    <span className="text-xs text-muted">{locale === "zh" ? "中文" : "English"}</span>{multiline
      ? <textarea className={settingsField} value={value[locale]} maxLength={max} rows={3} onChange={e => onChange({ ...value, [locale]: e.target.value })} />
      : <input className={settingsField} value={value[locale]} maxLength={max} onChange={e => onChange({ ...value, [locale]: e.target.value })} />}
  </label>)}</div></div>;
}
export function MoveControls({ index, length, move, remove, en, children }: {
  index: number; length: number; move: (offset: number) => void; remove?: () => void; en: boolean; children?: ReactNode;
}) {
  return <div className="flex flex-wrap items-center gap-2">{children}<span className="flex-1" />
    <Button type="button" size="sm" variant="ghost" disabled={index === 0} onClick={() => move(-1)}>{en ? "Up" : "上移"}</Button>
    <Button type="button" size="sm" variant="ghost" disabled={index === length - 1} onClick={() => move(1)}>{en ? "Down" : "下移"}</Button>
    {remove && <Button type="button" size="sm" variant="ghost" onClick={remove}>{en ? "Remove" : "移除"}</Button>}
  </div>;
}
export function moveItem<T>(items: T[], index: number, offset: number): T[] {
  const next = [...items]; if (index + offset < 0 || index + offset >= next.length) return items;
  [next[index], next[index + offset]] = [next[index + offset], next[index]]; return next;
}
export function ActionField({ value, target, onChange, locale }: {
  value: MiniappAction; target: string; onChange: (action: MiniappAction, target: string) => void; locale: "zh" | "en";
}) {
  return <div className="flex flex-wrap gap-2"><label className="grid min-w-44 flex-1 gap-1 text-sm">{locale === "zh" ? "点击后打开" : "Open on tap"}
    <select className={settingsField} value={value} onChange={e => onChange(e.target.value as MiniappAction, "")}>{miniappActions.map(action => <option key={action} value={action}>{actionNames[action][locale]}</option>)}</select></label>
    {value === "document" && <label className="grid flex-1 gap-1 text-sm">{locale === "zh" ? "文档标识" : "Document key"}<input className={settingsField} value={target} placeholder="privacy / children_privacy" maxLength={64} pattern="[a-zA-Z0-9_-]*" onChange={e => onChange(value, e.target.value)} /></label>}
  </div>;
}
export function MenuEditor({ value, onChange, locale, max = 20 }: { value: MiniappEntry[]; onChange: (v: MiniappEntry[]) => void; locale: "zh" | "en"; max?: number }) {
  const en = locale === "en";
  const patch = (index: number, change: Partial<MiniappEntry>) => onChange(value.map((v, i) => i === index ? { ...v, ...change } : v));
  return <div className="divide-y divide-line">{value.map((item, index) => <div className="space-y-3 py-4" key={item.id}>
    <MoveControls index={index} length={value.length} move={offset => onChange(moveItem(value, index, offset))} remove={() => onChange(value.filter((_, i) => i !== index))} en={en}>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={item.visible} onChange={e => patch(index, { visible: e.target.checked })} />{en ? "Visible" : "展示"}</label>
    </MoveControls>
    <LocalizedField label={en ? "Entry title" : "入口名称"} value={item.title} onChange={title => patch(index, { title })} max={60} />
    <ActionField value={item.action} target={item.target} locale={locale} onChange={(action, target) => patch(index, { action, target })} />
    <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm">{en ? "Icon" : "图标"}<select className={settingsField} value={item.icon} onChange={e => patch(index, { icon: e.target.value as MiniappEntry["icon"] })}>{miniappIcons.map(icon => <option key={icon} value={icon}>{icon}</option>)}</select></label>
      <label className="grid gap-1 text-sm">{en ? "Show to" : "展示对象"}<select className={settingsField} value={item.audience} onChange={e => patch(index, { audience: e.target.value as MiniappEntry["audience"] })}><option value="all">{en ? "Everyone" : "所有人"}</option><option value="signedIn">{en ? "Signed-in accounts" : "已登录账号"}</option><option value="participants">{en ? "Accounts with participants" : "已有参与人的账号"}</option></select></label></div>
  </div>)}<div className="pt-4"><Button type="button" size="sm" variant="secondary" disabled={value.length >= max} onClick={() => onChange([...value, { id: newId(), title: actionNames.activities, action: "activities", target: "", icon: "activity", visible: true, audience: "all" }])}>{en ? "Add entry" : "添加入口"}</Button></div></div>;
}
