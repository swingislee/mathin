"use client";
/* eslint-disable @next/next/no-img-element -- Staff QR preview requires cookie authorization. */
import { Button } from "@/components/ui/button";
import { newId } from "@/lib/uuid";
import { miniappText, type MiniappContact, type MiniappStageGroup } from "../../../../contracts/participant-api/miniapp-settings";
import { LocalizedField, MoveControls, moveItem, settingsField } from "./fields";

export function ContactsEditor({ value, legacy, campuses, stages, locale, onChange, upload }: {
  value: MiniappContact[] | undefined; legacy: MiniappContact[]; campuses: { id: string; name: string }[];
  stages: MiniappStageGroup[]; locale: "zh" | "en"; onChange: (value: MiniappContact[]) => void;
  upload: (file: File, update: (path: string) => void) => void;
}) {
  const en = locale === "en", rows = value || legacy;
  const patch = (id: string, changes: Partial<MiniappContact>) => onChange(rows.map(c => c.id === id ? { ...c, ...changes } : c));
  const image = (path: string) => path.includes("/") ? `/api/v1/parent/advisors/qr?preview=1&path=${encodeURIComponent(path)}` : `/api/v1/participant/settings/image?preview=1&path=${encodeURIComponent(path)}`;
  return <div className="max-w-4xl space-y-5">
    <p className="text-sm text-muted">{en ? "Choose stages and a campus for each contact. With no stage selected, the contact is the fallback for that campus. Save a draft and publish with the controls above." : "为联系人选择适用阶段和校区。不选阶段时，作为该校区的默认联系人。使用上方按钮保存草稿并发布。"}</p>
    {value === undefined && <p className="text-sm text-muted">{en ? "Showing existing grade contacts. Changes below become a draft; existing public details remain until publication." : "当前沿用原有学服配置。修改后进入草稿，发布时更新公开联系方式。"}</p>}
    {rows.map((c, i) => <section key={c.id} className="space-y-4 border-b border-line pb-6">
      <MoveControls en={en} index={i} length={rows.length} move={offset => onChange(moveItem(rows, i, offset))} remove={() => onChange(rows.filter(r => r.id !== c.id))}>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={c.visible} onChange={e => patch(c.id, { visible: e.target.checked })} />{en ? "Visible" : "展示"}</label>
      </MoveControls>
      <LocalizedField label={en ? "Contact name" : "人员称呼"} value={c.name} max={60} onChange={name => patch(c.id, { name })} />
      <LocalizedField label={en ? "Service" : "服务事项"} value={c.service} max={120} onChange={service => patch(c.id, { service })} />
      <div className="flex flex-wrap gap-2">{stages.flatMap(g => g.stages).map(s => <label key={s.id} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={c.stageNumbers.includes(s.stageNumber)} onChange={e => patch(c.id, { stageNumbers: e.target.checked ? [...c.stageNumbers, s.stageNumber] : c.stageNumbers.filter(n => n !== s.stageNumber) })} />{miniappText(s.label, locale)}</label>)}</div>
      <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-1 text-sm">{en ? "Campus" : "校区"}<select className={settingsField} value={c.campusId} onChange={e => patch(c.id, { campusId: e.target.value })}><option value="">{en ? "All campuses" : "所有校区"}</option>{campuses.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label className="grid gap-1 text-sm">{en ? "Phone" : "联系电话"}<input type="tel" className={settingsField} maxLength={24} value={c.phone} onChange={e => patch(c.id, { phone: e.target.value })} /></label></div>
      <div className="flex flex-wrap items-center gap-4">{c.qrImage && <img src={image(c.qrImage)} alt={en ? "Contact QR code" : "联系人二维码"} className="h-32 w-32 object-contain" />}<label className="grid gap-1 text-sm">{en ? "QR image (JPG, PNG or WebP, up to 5 MB)" : "二维码图片（JPG、PNG 或 WebP，5 MB 内）"}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) upload(file, qrImage => patch(c.id, { qrImage })); }} /></label>{c.qrImage && <Button type="button" variant="ghost" size="sm" onClick={() => patch(c.id, { qrImage: "" })}>{en ? "Remove image" : "移除图片"}</Button>}</div>
      <LocalizedField label={en ? "Service hours" : "服务时间"} value={c.hours} max={500} multiline onChange={hours => patch(c.id, { hours })} />
      <LocalizedField label={en ? "Address" : "服务地址"} value={c.address} max={500} multiline onChange={address => patch(c.id, { address })} />
    </section>)}
    <Button type="button" variant="secondary" disabled={rows.length >= 40} onClick={() => onChange([...rows, { id: newId(), name: { zh: "", en: "" }, service: { zh: "", en: "" }, phone: "", qrImage: "", stageNumbers: [], campusId: "", hours: { zh: "", en: "" }, address: { zh: "", en: "" }, visible: true }])}>{en ? "Add contact" : "添加联系人"}</Button>
  </div>;
}
