"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Check, Link2, LockKeyhole, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { newId } from "@/lib/uuid";
import { FAMILY_FIELD_IDS, type FamilyField, type FamilyFieldId, type FamilyForm } from "../../../../contracts/participant-api/onboarding";
import { readPromotionForm, savePromotionForm } from "./actions";
import { FORM_FIELD_BINDINGS } from "./form-fields";
import { PromotionFormPreview, type FormSelection } from "./PromotionFormPreview";

export function PromotionFormEditor({ scene, name, en, initial, onDirtyChange, onBusyChange }: {
  scene: string | null; name: string; en: boolean; initial?: FamilyForm;
  onDirtyChange: (dirty: boolean) => void; onBusyChange: (busy: boolean) => void;
}) {
  const [form, setForm] = useState<FamilyForm | null>(initial ?? null), [busy, setBusy] = useState(!initial), [error, setError] = useState("");
  const [saved, setSaved] = useState(false), [selected, setSelected] = useState<FormSelection>("introduction"), [previewEnglish, setPreviewEnglish] = useState(en);
  const t = (zh: string, english: string) => en ? english : zh;
  useEffect(() => {
    if (initial) return;
    let active = true;
    readPromotionForm(scene).then(value => { if (active) setForm(value); })
      .catch(() => { if (active) setError(en ? "Could not load the form." : "表单读取失败，请重新选择。"); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [scene, en, initial]);
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  function change(update: (current: FamilyForm) => FamilyForm) { setForm(current => current && update(current)); setSaved(false); onDirtyChange(true); }
  function field(id: FamilyFieldId, update: (current: FamilyField) => FamilyField) {
    change(current => ({ ...current, fields: current.fields.map(value => value.id === id ? update(value) : value) }));
  }
  function add(id: FamilyFieldId) {
    change(current => { const value = current.fields.find(item => item.id === id)!;
      return { ...current, fields: [...current.fields.filter(item => item.id !== id), { ...value, mode: "optional" }] }; });
    setSelected(id);
  }
  function remove(id: FamilyFieldId) { field(id, current => ({ ...current, mode: "hidden" })); setSelected("introduction"); }
  function move(id: FamilyFieldId, delta: number) {
    change(current => {
      const fields = [...current.fields], visible = fields.filter(item => item.mode !== "hidden"), index = visible.findIndex(item => item.id === id);
      const adjacent = visible[index + delta]; if (!adjacent) return current;
      const from = fields.findIndex(item => item.id === id), to = fields.findIndex(item => item.id === adjacent.id);
      [fields[from], fields[to]] = [fields[to], fields[from]]; return { ...current, fields };
    });
  }
  async function save() {
    if (!form || busy) return;
    setBusy(true); setError("");
    try {
      setForm(await savePromotionForm({ scene, version: form.version, config: { title: form.title, description: form.description, fields: form.fields } }));
      setSaved(true); onDirtyChange(false);
    } catch (failure) {
      setError(failure instanceof Error && failure.message === "FORM_CHANGED"
        ? t("表单刚被其他人修改。你的草稿仍保留，请核对最新版本后再保存。", "Someone changed this form. Your draft is preserved; compare the latest version before saving.")
        : t("未保存，请检查标题、字段名称和兴趣选项。", "Not saved. Check the title, field labels and interest options."));
    } finally { setBusy(false); }
  }
  const current = form?.fields.find(item => item.id === selected), visible = form?.fields.filter(item => item.mode !== "hidden") ?? [];
  const position = visible.findIndex(item => item.id === selected);
  return <section aria-label={t("推广表单编辑", "Promotion form editor")}>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3">
      <div><h2 className="font-medium">{name}</h2><p className="mt-1 text-xs text-muted">{t("点选手机预览中的内容，在右侧调整。", "Select an item in the phone preview to edit it.")}</p></div>
      <div className="flex items-center gap-3"><Label className="flex items-center gap-2 text-xs"><Checkbox checked={previewEnglish} onCheckedChange={value => setPreviewEnglish(value === true)} />English</Label>
        {saved && <span role="status" className="text-sm text-leaf-deep">{t("已保存", "Saved")}</span>}
        <Button disabled={busy || !form} onClick={() => void save()}>{t("保存表单", "Save form")}</Button></div>
    </div>
    {error && <p className="py-3 text-sm text-rose" role="alert">{error}</p>}
    {!form && busy && <p className="py-10 text-sm text-muted">{t("正在读取手机表单…", "Loading the mobile form…")}</p>}
    {form && <div className="grid min-w-0 gap-6 py-5 xl:grid-cols-[190px_minmax(300px,1fr)_300px]">
      <aside className="min-w-0 xl:border-r xl:border-line xl:pr-5" aria-label={t("可添加字段", "Field library")}>
        <h3 className="mb-3 text-sm font-medium">{t("添加字段", "Add fields")}</h3>
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 xl:grid-cols-1">{FAMILY_FIELD_IDS.map(id => {
          const included = form.fields.find(item => item.id === id)?.mode !== "hidden", binding = FORM_FIELD_BINDINGS[id];
          return <Button key={id} variant="ghost" size="sm" className="justify-between gap-2 px-2" disabled={busy} onClick={() => included ? setSelected(id) : add(id)}
            aria-label={(included ? t("选择", "Select ") : t("添加", "Add ")) + (en ? binding.en : binding.zh)}>
            <span>{en ? binding.en : binding.zh}</span>{included ? <Check className="size-3.5 text-leaf-deep" /> : <Plus className="size-3.5" />}</Button>;
        })}</div>
        <div className="mt-5 space-y-2 border-t border-line pt-3 text-xs text-muted"><p className="flex items-center gap-2"><LockKeyhole className="size-3.5" />{t("微信手机号授权", "WeChat phone authorization")}</p><p className="flex items-center gap-2"><LockKeyhole className="size-3.5" />{t("隐私同意", "Privacy consent")}</p></div>
      </aside>
      <div className="min-w-0"><PromotionFormPreview form={form} en={previewEnglish} selected={selected} select={setSelected} disabled={busy} />
        <p className="mx-auto mt-3 max-w-[375px] text-center text-xs text-muted">{t("手机表单预览 · 保存后生效", "Mobile form preview · Save to apply")}</p></div>
      <fieldset disabled={busy} className="min-w-0 space-y-4 border-t border-line pt-4 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-5">
        {current ? <>
          <div><p className="text-xs text-muted">{t("固定资料字段", "Linked record field")}</p><h3 className="mt-1 flex items-center gap-2 font-medium"><Link2 className="size-4 text-leaf-deep" />{en ? FORM_FIELD_BINDINGS[current.id].en : FORM_FIELD_BINDINGS[current.id].zh}</h3>
            <p className="mt-2 text-xs leading-5 text-muted">{t("填写结果保存到这一项；修改显示名称不会改变对应关系。", "Answers are saved to this field. Changing the display label keeps this link.")}</p></div>
          <Label className="grid gap-1.5">{t("页面显示名称", "Display label")}<Input value={current.label.zh} maxLength={100} onChange={event => field(current.id, value => ({ ...value, label: { ...value.label, zh: event.target.value } }))} /></Label>
          <Label className="grid gap-1.5 text-xs">{t("英文显示名称", "English label")}<Input value={current.label.en} maxLength={160} onChange={event => field(current.id, value => ({ ...value, label: { ...value.label, en: event.target.value } }))} /></Label>
          <Label className="flex items-center gap-2"><Checkbox checked={current.mode === "required"} onCheckedChange={value => field(current.id, entry => ({ ...entry, mode: value === true ? "required" : "optional" }))} />{t("家长必须填写", "Required")}</Label>
          <div className="flex flex-wrap gap-2"><Button variant="secondary" size="sm" disabled={busy || position <= 0} onClick={() => move(current.id, -1)}><ArrowUp className="size-3.5" />{t("上移", "Move up")}</Button>
            <Button variant="secondary" size="sm" disabled={busy || position === visible.length - 1} onClick={() => move(current.id, 1)}><ArrowDown className="size-3.5" />{t("下移", "Move down")}</Button></div>
          {current.id === "interests" && <div className="space-y-2 border-t border-line pt-3"><h4 className="text-sm font-medium">{t("兴趣选项", "Interest options")}</h4>{current.options?.map((option, index) => <div key={option.id} className="flex items-start gap-1">
            <div className="min-w-0 flex-1 space-y-1"><Input aria-label={t(`兴趣选项 ${index + 1}`, `Interest option ${index + 1}`)} value={option.label.zh} maxLength={100}
              onChange={event => field(current.id, value => ({ ...value, options: value.options?.map(item => item.id === option.id ? { ...item, label: { ...item.label, zh: event.target.value } } : item) }))} />
              <Input aria-label={t(`选项 ${index + 1} 英文`, `Option ${index + 1} English`)} placeholder={t("英文（选填）", "English (optional)")} value={option.label.en} maxLength={160}
                onChange={event => field(current.id, value => ({ ...value, options: value.options?.map(item => item.id === option.id ? { ...item, label: { ...item.label, en: event.target.value } } : item) }))} /></div>
            <Button variant="ghost" size="sm" className="size-9 shrink-0 p-0" disabled={busy || current.options!.length <= 1} aria-label={t("删除兴趣选项", "Remove interest option")}
              onClick={() => field(current.id, value => ({ ...value, options: value.options?.filter(item => item.id !== option.id) }))}><Trash2 className="size-4" /></Button>
          </div>)}<Button variant="secondary" size="sm" disabled={busy || (current.options?.length ?? 0) >= 20}
            onClick={() => field(current.id, value => ({ ...value, options: [...value.options || [], { id: "o_" + newId().replaceAll("-", ""), label: { zh: "", en: "" } }] }))}><Plus className="size-4" />{t("添加选项", "Add option")}</Button></div>}
          <div className="border-t border-line pt-3"><Button variant="ghost" size="sm" className="text-rose" onClick={() => remove(current.id)}><Trash2 className="size-4" />{t("从表单移除", "Remove from form")}</Button><p className="mt-1 text-xs text-muted">{t("可以从字段库加回来。已登记资料保留。", "Add it back from the field library. Existing submissions are kept.")}</p></div>
        </> : <>
          <h3 className="text-sm font-medium">{t("标题与填写提示", "Title and introduction")}</h3>
          <Label className="grid gap-1.5">{t("表单标题", "Form title")}<Input value={form.title.zh} maxLength={100} onChange={event => change(value => ({ ...value, title: { ...value.title, zh: event.target.value } }))} /></Label>
          <Label className="grid gap-1.5">{t("填写提示", "Introduction")}<Textarea value={form.description.zh} maxLength={400} onChange={event => change(value => ({ ...value, description: { ...value.description, zh: event.target.value } }))} /></Label>
          <details className="text-sm"><summary className="cursor-pointer text-muted">English</summary><div className="mt-3 space-y-3">
            <Label className="grid gap-1.5">{t("英文标题", "English title")}<Input value={form.title.en} maxLength={160} onChange={event => change(value => ({ ...value, title: { ...value.title, en: event.target.value } }))} /></Label>
            <Label className="grid gap-1.5">{t("英文提示", "English introduction")}<Textarea value={form.description.en} maxLength={600} onChange={event => change(value => ({ ...value, description: { ...value.description, en: event.target.value } }))} /></Label>
          </div></details>
          <p className="border-t border-line pt-3 text-xs leading-5 text-muted">{scene ? t("这张推广码使用自己的表单。", "This promotion code has its own form.") : t("直接进入小程序使用此表单，新建推广码也从这里复制。", "Direct entry uses this form. New promotion codes start with a copy.")}</p>
        </>}
      </fieldset>
    </div>}
  </section>;
}
