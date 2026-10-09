"use client";

import { useState } from "react";
import { ArrowUpRight, Plus, QrCode } from "lucide-react";
import { useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DashboardCommandActions, DashboardCommandFilters, DashboardCommandPanel, DashboardPage } from "../dashboard-page";
import type { FamilyForm } from "../../../../contracts/participant-api/onboarding";
import { readPromotionSettings, savePromotion } from "./actions";
import type { PromotionSettings } from "./contract";
import { PromotionFormEditor } from "./PromotionFormEditor";

export function PromotionWorkbench({ initial, initialForm, configured }: { initial: PromotionSettings; initialForm: FamilyForm; configured: boolean }) {
  const en = useLocale() === "en", t = (zh: string, english: string) => en ? english : zh;
  const [promotions, setPromotions] = useState(initial), [scene, setScene] = useState("");
  const [name, setName] = useState(""), [adding, setAdding] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [environment, setEnvironment] = useState("release"), [dirty, setDirty] = useState(false), [editorBusy, setEditorBusy] = useState(false);
  const [nextScene, setNextScene] = useState<string | null>(null), [firstEditor, setFirstEditor] = useState(true);
  const selected = promotions.find(value => value.scene === scene);
  function select(value: string) { setScene(value); setDirty(false); setFirstEditor(false); setNextScene(null); }
  function requestSelection(value: string) { if (dirty) setNextScene(value); else select(value); }
  async function save(value: { scene: string | null; name: string; enabled: boolean }) {
    if (busy || editorBusy) return;
    setBusy(true); setError("");
    try {
      const result = await savePromotion(value);
      setPromotions(await readPromotionSettings());
      if (!value.scene) { setName(""); setAdding(false); select(result); }
    } catch { setError(t("保存失败，请重试。", "Could not save. Please retry.")); }
    finally { setBusy(false); }
  }
  return <DashboardPage title={t("微信推广", "WeChat promotion")} commandPanel={<DashboardCommandPanel>
    <DashboardCommandFilters><Label htmlFor="promotion-form">{t("表单", "Form")}</Label>
      <select id="promotion-form" className="h-9 max-w-full rounded-md border border-line bg-card px-2 text-sm" value={scene} disabled={busy || editorBusy} onChange={event => requestSelection(event.target.value)}>
        <option value="">{t("默认表单", "Default form")}</option>{promotions.map(row => <option key={row.scene} value={row.scene}>{row.name}{row.enabled ? "" : t("（已停用）", " (disabled)")}</option>)}
      </select></DashboardCommandFilters>
    <DashboardCommandActions><Button variant="secondary" disabled={busy || editorBusy || dirty} onClick={() => setAdding(value => !value)}><Plus className="size-4" />{t("新建推广码", "New promotion code")}</Button>
      <Link href="/dashboard/leads?period=all" className={buttonVariants({ variant: "ghost", size: "sm" })}>{t("登记资料在线索中处理", "Manage registrations in leads")}<ArrowUpRight className="size-4" /></Link></DashboardCommandActions>
  </DashboardCommandPanel>}>
    {adding && <form className="flex flex-wrap items-end gap-3 border-b border-line py-3" onSubmit={event => { event.preventDefault(); void save({ scene: null, name: name.trim(), enabled: true }); }}>
      <Label className="grid min-w-52 gap-1">{t("推广码名称（人员／场景）", "Code name (promoter / setting)")}<Input autoFocus value={name} onChange={event => setName(event.target.value)} required maxLength={100} disabled={busy} /></Label>
      <Button disabled={busy || dirty || !name.trim()} type="submit">{t("创建", "Create")}</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => setAdding(false)}>{t("取消", "Cancel")}</Button>
    </form>}
    {error && <p className="py-2 text-sm text-rose" role="alert">{error}</p>}
    {selected && <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3 text-sm">
      <div className="flex flex-wrap gap-3"><span>{t(`新增家庭 ${selected.newCount}`, `${selected.newCount} new families`)}</span><span className="text-muted">{t(`重复／已有 ${selected.repeatCount}`, `${selected.repeatCount} repeat / existing`)}</span></div>
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="code-environment" className="text-xs">{t("二维码版本", "Code version")}</Label><select id="code-environment" value={environment} onChange={event => setEnvironment(event.target.value)} className="h-8 rounded-md border border-line bg-card px-2 text-xs">
          <option value="release">{t("正式版", "Release")}</option><option value="trial">{t("体验版", "Trial")}</option><option value="develop">{t("开发版", "Development")}</option></select>
        {configured && selected.enabled && <a className={buttonVariants({ variant: "secondary", size: "sm" })} href={`/api/v1/school/promotions/code?scene=${scene}&environment=${environment}`} target="_blank" rel="noreferrer"><QrCode className="size-4" />{t("打开／保存小程序码", "Open / save code")}</a>}
        <Button variant="ghost" size="sm" disabled={busy || editorBusy} onClick={() => void save({ scene, name: selected.name, enabled: !selected.enabled })}>{selected.enabled ? t("停用", "Disable") : t("启用", "Enable")}</Button>
      </div>
    </div>}
    <PromotionFormEditor key={scene || "default"} scene={scene || null} name={selected?.name || t("默认表单", "Default form")} en={en}
      initial={firstEditor ? initialForm : undefined} onDirtyChange={setDirty} onBusyChange={setEditorBusy} />
    <ConfirmDialog open={nextScene !== null} onOpenChange={open => { if (!open) setNextScene(null); }} title={t("切换表单？", "Switch forms?")}
      description={t("当前表单有未保存的修改。切换会放弃这些修改。", "This form has unsaved changes. Switching will discard them.")}
      confirmLabel={t("放弃修改并切换", "Discard and switch")} cancelLabel={t("继续编辑", "Keep editing")} onConfirm={() => { if (nextScene !== null) select(nextScene); }} />
  </DashboardPage>;
}
