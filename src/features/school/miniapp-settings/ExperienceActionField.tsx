"use client";
import { experienceNativeTargets, localText, type ExperienceAction, type MiniappExperience } from "../../../../contracts/participant-api/miniapp-experience";
import { LocalizedField, actionNames, settingsField } from "./fields";

const names = { none: ["无操作", "No action"], native: ["现有业务入口", "Native destination"], page: ["内容页面", "Content page"], offering: ["服务详情", "Service details"], catalog: ["服务目录", "Service catalog"], form: ["填写表单", "Fill a form"], web: ["外部网页", "Website"], phone: ["拨打电话", "Phone call"] };
export function ExperienceActionField({ value, experience, locale, onChange, label = true }: { value: ExperienceAction; experience: MiniappExperience; locale: "zh" | "en"; onChange: (v: ExperienceAction) => void; label?: boolean }) {
  const choices = value.kind === "native" ? experienceNativeTargets.map(id => ({ id, title: actionNames[id] }))
    : value.kind === "page" ? experience.pages.filter(p => p.purpose !== "report").map(p => ({ id: p.id, title: p.title }))
    : value.kind === "offering" ? experience.services.map(s => ({ id: s.id, title: s.name }))
    : value.kind === "form" ? experience.forms.map(f => ({ id: f.id, title: f.title }))
    : value.kind === "web" ? experience.destinations.map(d => ({ id: d.id, title: d.name })) : [];
  return <div className="space-y-3">{label && <LocalizedField label={locale === "zh" ? "操作文字" : "Action label"} value={value.label} onChange={text => onChange({ ...value, label: text })} />}
    <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm">{locale === "zh" ? "点击后执行" : "On tap"}<select className={settingsField} value={value.kind} onChange={e => onChange({ ...value, kind: e.target.value as ExperienceAction["kind"], target: "" })}>{Object.entries(names).map(([key, title]) => <option key={key} value={key}>{title[locale === "zh" ? 0 : 1]}</option>)}</select></label>
      {choices.length > 0 || ["native", "page", "offering", "form", "web"].includes(value.kind) ? <label className="grid gap-1 text-sm">{locale === "zh" ? "绑定目标" : "Destination"}<select className={settingsField} value={value.target} onChange={e => onChange({ ...value, target: e.target.value })}><option value="">{locale === "zh" ? "请选择" : "Choose"}</option>{choices.map(c => <option key={c.id} value={c.id}>{localText(c.title, locale)}</option>)}</select></label>
        : value.kind === "phone" && <label className="grid gap-1 text-sm">{locale === "zh" ? "电话号码" : "Phone number"}<input className={settingsField} value={value.target} onChange={e => onChange({ ...value, target: e.target.value })} /></label>}
    </div>
  </div>;
}
