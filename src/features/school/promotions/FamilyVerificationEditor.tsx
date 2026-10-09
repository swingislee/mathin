"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { newId } from "@/lib/uuid";
import type { FamilyChild } from "../../../../contracts/participant-api/onboarding";
import { verifyPromotionFamily } from "./actions";
import type { PromotionRecord, VerifiedFamily } from "./contract";

export function FamilyVerificationEditor({ row, en, close, saved }: { row: PromotionRecord; en: boolean; close: () => void; saved: () => Promise<void> }) {
  const [details, setDetails] = useState<VerifiedFamily>(() => {
    const children: FamilyChild[] = row.children.map(child => {
      const current = row.participants.find(value => value.key === child.key);
      return current ? { ...child, childName: current.name, school: current.school, gender: current.gender as FamilyChild["gender"], grade: current.grade } : child;
    });
    for (const current of row.participants) if (!children.some(child => child.key === current.key)) children.push({ key: current.key,
      childName: current.name, school: current.school, grade: current.grade, gender: current.gender as FamilyChild["gender"], interests: [] });
    return { parentName: row.participants[0]?.parentName || row.parentName || "", children };
  });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const t = (zh: string, english: string) => en ? english : zh;
  const update = (index: number, patch: Partial<FamilyChild>) => setDetails(current => ({ ...current,
    children: current.children.map((child, at) => at === index ? { ...child, ...patch } : child) }));
  async function save() {
    if (!row.registrationId || busy) return;
    setBusy(true); setError("");
    try { await verifyPromotionFamily({ id: row.registrationId, expectedAt: row.verifiedAt, details }); await saved(); close(); }
    catch (failure) { setError(failure instanceof Error && failure.message === "CONFLICT"
      ? t("这份资料刚被他人核实，请刷新后核对。当前输入仍保留。", "Another person updated this family. Reload to compare; your draft is preserved.")
      : t("未保存，请核对孩子姓名及当前资料权限后重试。", "Not saved. Check the child names and your access, then retry.")); }
    finally { setBusy(false); }
  }
  return <section className="py-3" aria-label={t("核实家庭资料", "Verify family details")}>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-medium">{t("沟通后核实的资料", "Details verified through contact")}</h3>
      <p className="text-xs text-muted">{t("家长填写的称呼保留在原始登记中。这里保存后更新同一孩子的档案。", "The original registration keeps the parent’s preferred names. Saving here updates the same child’s profile.")}</p></div>
      <div className="flex gap-2"><Button disabled={busy || details.children.some(child => !child.childName.trim())} onClick={() => void save()}>{t("保存核实资料", "Save verified details")}</Button>
        <Button variant="ghost" disabled={busy} onClick={close}>{t("取消", "Cancel")}</Button></div></div>
    {error && <p role="alert" className="py-2 text-sm text-rose">{error}</p>}
    <fieldset disabled={busy} className="space-y-3">
      <Label className="grid max-w-sm gap-1">{t("家长姓名", "Parent name")}<Input value={details.parentName} maxLength={100} onChange={event => setDetails(value => ({ ...value, parentName: event.target.value }))} /></Label>
      {details.children.map((child, index) => <div key={child.key} className="border-t border-line pt-3">
        <div className="mb-2 flex items-center justify-between text-sm"><span>{t(`孩子 ${index + 1}`, `Child ${index + 1}`)} · {t("家长原填称呼：", "Original preferred name: ")}{row.children.find(value => value.key === child.key)?.childName || t("未填写", "Not provided")}</span>
          {!row.children.some(value => value.key === child.key) && !row.participants.some(value => value.key === child.key) && <Button size="sm" className="size-9 p-0" variant="ghost" aria-label={t("移除尚未保存的孩子", "Remove unsaved child")} onClick={() => setDetails(value => ({ ...value, children: value.children.filter(item => item.key !== child.key) }))}><Trash2 className="size-4" /></Button>}</div>
        <div className="grid gap-3 sm:grid-cols-4"><Label className="grid gap-1">{t("核实姓名", "Verified name")}<Input value={child.childName} maxLength={100} onChange={event => update(index, { childName: event.target.value })} /></Label>
          <Label className="grid gap-1">{t("年级", "Grade")}<select className="h-9 rounded-md border border-line bg-card px-2 text-sm" value={child.grade ?? ""} onChange={event => update(index, { grade: event.target.value === "" ? null : Number(event.target.value) })}>
            <option value="">{t("待确认", "Unknown")}</option><option value="-1">{t("幼中班", "K2")}</option><option value="0">{t("幼大班", "K3")}</option>
            {Array.from({ length: 12 }, (_, at) => at + 1).map(grade => <option key={grade} value={grade}>{t(`${grade} 年级`, `Grade ${grade}`)}</option>)}</select></Label>
          <Label className="grid gap-1">{t("学校", "School")}<Input value={child.school} maxLength={120} onChange={event => update(index, { school: event.target.value })} /></Label>
          <Label className="grid gap-1">{t("性别", "Gender")}<select className="h-9 rounded-md border border-line bg-card px-2 text-sm" value={child.gender} onChange={event => update(index, { gender: event.target.value as FamilyChild["gender"] })}>
            <option value="">{t("待确认", "Unknown")}</option><option value="female">{t("女", "Female")}</option><option value="male">{t("男", "Male")}</option></select></Label>
        </div>
      </div>)}
      {row.canAddChild && <Button variant="secondary" size="sm" disabled={details.children.length >= 10} onClick={() => setDetails(value => ({ ...value,
        children: [...value.children, { key: "staff_" + newId().replaceAll("-", ""), childName: "", grade: null, gender: "", school: "", interests: [] }] }))}><Plus className="size-4" />{t("为这个家庭补充另一个孩子", "Add another child to this family")}</Button>}
    </fieldset>
  </section>;
}
