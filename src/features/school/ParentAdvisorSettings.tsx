"use client";
import { useState, useTransition } from "react";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { AdvisorSetting } from "./parent-registration";
import { saveAdvisorContact } from "./parent-registration-actions";

export function ParentAdvisorSettings({ rows }: { rows: AdvisorSetting[] }) {
  const en = useLocale() === "en", router = useRouter();
  const [grade, setGrade] = useState(1), [busy, start] = useTransition(), [notice, setNotice] = useState("");
  const row = rows.find(r => r.grade === grade);
  const grades = Array.from({ length: 14 }, (_, i) => i - 1);
  const gradeName = (n: number) => n === -1 ? (en ? "K2" : "幼中班") : n === 0 ? (en ? "K3" : "幼大班") : en ? `Grade ${n}` : `${n} 年级`;
  return <div className="grid max-w-2xl gap-5">
    <label className="grid gap-1 text-sm">{en ? "Grade" : "年级"}<select className="rounded-lg border border-line bg-card p-2" disabled={busy} value={grade} onChange={e => { setGrade(Number(e.target.value)); setNotice(""); }}>{grades.map(n => <option key={n} value={n}>{gradeName(n)}{rows.some(r => r.grade === n) ? (en ? " · configured" : " · 已设置") : ""}</option>)}</select></label>
    <form key={`${grade}/${row?.qrPath || ""}/${row?.phone || ""}/${row?.enabled}`} className="grid gap-4" onSubmit={e => {
      e.preventDefault(); const form = new FormData(e.currentTarget); form.set("grade", String(grade));
      start(async () => { const r = await saveAdvisorContact(form); setNotice(r.ok ? (en ? "Saved" : "已保存") : (en ? "Check the phone number and QR image, then retry." : "请核对手机号和二维码图片后重试。")); if (r.ok) router.refresh(); });
    }}>
      <input type="hidden" name="qrPath" value={row?.qrPath || ""} />
      <label className="grid gap-1 text-sm">{en ? "Advisor name (optional)" : "学辅老师称呼（可选）"}<input className="rounded-lg border border-line bg-card p-2" name="teacherName" maxLength={60} defaultValue={row?.teacherName || ""} disabled={busy} /></label>
      <label className="grid gap-1 text-sm">{en ? "Phone number" : "手机号"}<input className="rounded-lg border border-line bg-card p-2" name="phone" type="tel" maxLength={24} required defaultValue={row?.phone || ""} disabled={busy} /></label>
      {row && <img src={row.qrCodeUrl} alt={en ? "Current advisor QR code" : "当前学辅二维码"} className="h-44 w-44 rounded-lg border border-line object-contain" />}
      <label className="grid gap-1 text-sm">{en ? "QR image (PNG, JPG or WebP, up to 1 MB)" : "上传老师二维码（PNG、JPG 或 WebP，1 MB 以内）"}<input type="file" accept="image/png,image/jpeg,image/webp" name="qrFile" required={!row} disabled={busy} /></label>
      <label className="flex gap-2 text-sm"><input type="checkbox" name="enabled" value="true" defaultChecked={row?.enabled ?? true} disabled={busy} />{en ? "Show this advisor for this grade" : "对该年级展示此学辅联系方式"}</label>
      <Button className="justify-self-start" disabled={busy}>{en ? "Save" : "保存"}</Button>
    </form>
    {notice && <p role="status" className="text-sm">{notice}</p>}
  </div>;
}
