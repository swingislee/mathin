"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { newId } from "@/lib/uuid";
import type { FamilyField, FamilyForm } from "../../../../contracts/participant-api/onboarding";
import { readPromotionForm, savePromotionForm } from "./actions";

export function PromotionFormEditor({ scene, name, en, close }: { scene: string | null; name: string; en: boolean; close: () => void }) {
  const [form, setForm] = useState<FamilyForm | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const t = (zh: string, english: string) => en ? english : zh;
  useEffect(() => {
    let active = true;
    readPromotionForm(scene).then(value => { if (active) setForm(value); })
      .catch(() => { if (active) setError(en ? "Could not load the form." : "表单读取失败，请重新打开。"); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [scene, en]);
  function change(update: (current: FamilyForm) => FamilyForm) { setForm(current => current && update(current)); setSaved(false); }
  function field(index: number, update: (current: FamilyField) => FamilyField) {
    change(current => ({ ...current, fields: current.fields.map((value, at) => at === index ? update(value) : value) }));
  }
  function move(index: number, delta: number) {
    change(current => { const fields = [...current.fields]; [fields[index], fields[index + delta]] = [fields[index + delta], fields[index]]; return { ...current, fields }; });
  }
  async function save() {
    if (!form || busy) return;
    setBusy(true); setError("");
    try {
      setForm(await savePromotionForm({ scene, version: form.version, config: { title: form.title, description: form.description, fields: form.fields } }));
      setSaved(true);
    } catch (failure) {
      setError(failure instanceof Error && failure.message === "FORM_CHANGED"
        ? t("这份表单已被其他人调整。当前草稿仍保留，请重新打开后核对。", "This form has changed. Your draft is still here; reopen to compare.")
        : t("未保存，请检查标题、字段名称和兴趣选项后重试。", "Not saved. Check the title, field labels and interest options."));
    } finally { setBusy(false); }
  }
  return <section className="border-y border-line py-4" aria-label={t("推广表单设置", "Promotion form settings")}>
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-medium">{name} · {t("表单设置", "Form settings")}</h2>
      <div className="flex items-center gap-2">{saved && <span className="text-sm text-leaf-deep">{t("已保存", "Saved")}</span>}
        <Button disabled={busy || !form} onClick={() => void save()}>{t("保存表单", "Save form")}</Button><Button variant="ghost" disabled={busy} onClick={close}>{t("关闭", "Close")}</Button></div></div>
    {error && <p className="py-2 text-sm text-rose" role="alert">{error}</p>}
    {!form && busy && <p className="py-3 text-sm text-muted">{t("正在读取…", "Loading…")}</p>}
    {form && <fieldset disabled={busy} className="mt-3 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2"><Label className="grid gap-1">{t("表单标题", "Form title")}<Input value={form.title.zh} maxLength={100} onChange={event => change(value => ({ ...value, title: { ...value.title, zh: event.target.value } }))} /></Label>
        <Label className="grid gap-1">{t("英文标题（选填）", "English title (optional)")}<Input value={form.title.en} maxLength={160} onChange={event => change(value => ({ ...value, title: { ...value.title, en: event.target.value } }))} /></Label>
        <Label className="grid gap-1">{t("填写提示", "Form introduction")}<Input value={form.description.zh} maxLength={400} onChange={event => change(value => ({ ...value, description: { ...value.description, zh: event.target.value } }))} /></Label>
        <Label className="grid gap-1">{t("英文提示（选填）", "English introduction (optional)")}<Input value={form.description.en} maxLength={600} onChange={event => change(value => ({ ...value, description: { ...value.description, en: event.target.value } }))} /></Label></div>
      <div className="divide-y divide-line">{form.fields.map((item, index) => <div key={item.id} className="py-3">
        <div className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_8rem_auto]">
          <Label className="grid gap-1">{t("字段名称", "Field label")}<Input aria-label={`${item.label.zh}字段名称`} value={item.label.zh} maxLength={100} onChange={event => field(index, value => ({ ...value, label: { ...value.label, zh: event.target.value } }))} /></Label>
          <Label className="grid gap-1">{t("英文名称（选填）", "English label (optional)")}<Input value={item.label.en} maxLength={160} onChange={event => field(index, value => ({ ...value, label: { ...value.label, en: event.target.value } }))} /></Label>
          <Label className="grid gap-1">{t("填写规则", "Requirement")}<select className="h-9 rounded-md border border-line bg-card px-2 text-sm" value={item.mode} onChange={event => field(index, value => ({ ...value, mode: event.target.value as FamilyField["mode"] }))}>
            <option value="required">{t("必填", "Required")}</option><option value="optional">{t("选填", "Optional")}</option><option value="hidden">{t("不显示", "Hidden")}</option></select></Label>
          <div className="flex gap-1"><Button variant="ghost" size="icon" disabled={index === 0} aria-label={t("上移", "Move up")} onClick={() => move(index, -1)}><ArrowUp className="size-4" /></Button>
            <Button variant="ghost" size="icon" disabled={index === form.fields.length - 1} aria-label={t("下移", "Move down")} onClick={() => move(index, 1)}><ArrowDown className="size-4" /></Button></div>
        </div>
        {item.id === "interests" && <div className="mt-3 space-y-2 pl-3">{item.options?.map((option, optionIndex) => <div key={option.id} className="flex gap-2">
          <Input aria-label={t(`兴趣选项 ${optionIndex + 1}`, `Interest option ${optionIndex + 1}`)} value={option.label.zh} maxLength={100} onChange={event => field(index, value => ({ ...value, options: value.options?.map((entry, at) => at === optionIndex ? { ...entry, label: { ...entry.label, zh: event.target.value } } : entry) }))} />
          <Input aria-label={t(`兴趣选项 ${optionIndex + 1} 英文`, `English interest option ${optionIndex + 1}`)} value={option.label.en} placeholder={t("英文（选填）", "English (optional)")} maxLength={160} onChange={event => field(index, value => ({ ...value, options: value.options?.map((entry, at) => at === optionIndex ? { ...entry, label: { ...entry.label, en: event.target.value } } : entry) }))} />
          <Button variant="ghost" size="icon" disabled={item.options!.length <= 1} aria-label={t("移除此选项", "Remove option")} onClick={() => field(index, value => ({ ...value, options: value.options?.filter((_, at) => at !== optionIndex) }))}><Trash2 className="size-4" /></Button>
        </div>)}<Button variant="secondary" size="sm" disabled={(item.options?.length || 0) >= 20} onClick={() => field(index, value => ({ ...value, options: [...value.options || [], { id: "o_" + newId().replaceAll("-", ""), label: { zh: "", en: "" } }] }))}><Plus className="size-4" />{t("添加兴趣选项", "Add interest option")}</Button></div>}
      </div>)}</div>
      <p className="text-xs text-muted">{t(scene ? "仅修改这张推广码的表单。已登记内容按当时的表单保留。" : "直接进入小程序使用此表单；新推广码从这里复制，之后可分别调整。", scene ? "Changes apply to this code. Existing submissions keep their original form." : "Direct entry uses this form. New promotion codes copy it and can then be edited separately.")}</p>
    </fieldset>}
  </section>;
}
