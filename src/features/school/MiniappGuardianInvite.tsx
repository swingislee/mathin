"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useLocale } from "next-intl";
import { QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { issueMiniappGuardianInvite, revokeMiniappGuardianInvite } from "./guardian-invite-actions";

export function MiniappGuardianInvite({ studentId, compact = false }: { studentId: string; compact?: boolean }) {
  const zh = useLocale() === "zh";
  const title = zh ? "关联家长微信" : "Link a guardian's WeChat";
  const [invite, setInvite] = useState<{ id: string; code: string; expiresAt: string } | null>(null);
  const [environment, setEnvironment] = useState(process.env.NODE_ENV === "development" ? "develop" : "release");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const activeUrl = useRef("");
  useEffect(() => () => { if (activeUrl.current) URL.revokeObjectURL(activeUrl.current); }, []);
  function clearImage() { if (activeUrl.current) URL.revokeObjectURL(activeUrl.current); activeUrl.current = ""; setImageUrl(""); }
  async function create() {
    setBusy(true); setError(""); clearImage();
    try {
      const result = await issueMiniappGuardianInvite(studentId);
      if (!result.ok) throw new Error(result.code);
      setInvite(result.data);
    } catch { setError(zh ? "无法生成，请确认有该学生的编辑权限后重试。" : "Could not create an invitation. Check your student edit access and retry."); }
    finally { setBusy(false); }
  }
  async function showCode() {
    if (!invite) return;
    setBusy(true); setError(""); clearImage();
    try {
      const response = await fetch(`/api/v1/school/guardian-invites?id=${invite.id}&environment=${environment}`, { cache: "no-store" });
      if (!response.ok) throw new Error("UNAVAILABLE");
      activeUrl.current = URL.createObjectURL(await response.blob()); setImageUrl(activeUrl.current);
    } catch { setError(zh ? "小程序码暂未生成。可复制关联码，让家长在小程序“我的 → 关联已有孩子”输入；或确认所选版本已包含此页面。" : "The QR code is unavailable. Copy the invitation into My → Link an existing child, or check that the selected version includes this page."); }
    finally { setBusy(false); }
  }
  async function revoke() {
    if (!invite) return;
    setBusy(true); setError("");
    try { const result = await revokeMiniappGuardianInvite(invite.id); if (!result.ok) throw new Error(result.code); setInvite(null); clearImage(); }
    catch { setError(zh ? "撤销未完成；该邀请码可能已被使用，请刷新学生档案确认。" : "Could not revoke. It may already have been used; refresh the student record."); }
    finally { setBusy(false); }
  }
  return <Dialog><DialogTrigger asChild><Button type="button" variant="ghost" size="sm" title={title} aria-label={title}
    className={compact ? "size-9 rounded-full p-0" : ""}><QrCode className="size-4" />{compact ? null : title}</Button></DialogTrigger>
    <DialogContent className="max-w-md"><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>
      {zh ? "请将关联码单独交给该孩子的监护人。家长先看到部分姓名，主动确认后才关联现有档案，可查看孩子资料与学习记录、报名预约。" : "Give this invitation directly to the child's guardian. They see a partial name, then explicitly confirm to access the existing profile, learning records and bookings."}
    </DialogDescription></DialogHeader>
      {!invite ? <Button onClick={create} disabled={busy}>{zh ? "生成一次性关联码" : "Create invitation"}</Button> : <div className="space-y-3">
        <p className="text-xs text-muted">{zh ? "单次使用 · 有效至 " : "Single use · Expires "}{new Date(invite.expiresAt).toLocaleString(zh ? "zh-CN" : "en")}</p>
        <code className="block break-all rounded bg-paper p-3 text-sm">{invite.code}</code>
        <Button variant="secondary" size="sm" onClick={async () => { try { await navigator.clipboard.writeText(invite.code); } catch { setError(zh ? "请手动选中上方关联码复制。" : "Select and copy the code above."); } }}>{zh ? "复制关联码" : "Copy code"}</Button>
        <div className="flex items-center gap-2"><select aria-label={zh ? "小程序版本" : "Miniapp version"} value={environment} disabled={busy}
          onChange={event => { setEnvironment(event.target.value); clearImage(); }} className="rounded border border-line bg-card p-2 text-sm">
          <option value="release">{zh ? "正式版" : "Release"}</option><option value="trial">{zh ? "体验版" : "Trial"}</option><option value="develop">{zh ? "开发版" : "Development"}</option>
        </select><Button size="sm" onClick={showCode} disabled={busy}>{zh ? "显示小程序码" : "Show QR code"}</Button></div>
        {imageUrl ? <Image src={imageUrl} alt={title} width={240} height={240} unoptimized className="mx-auto" /> : null}
        <Button variant="ghost" size="sm" disabled={busy} onClick={revoke}>{zh ? "撤销此关联码" : "Revoke invitation"}</Button>
      </div>}
      {error ? <p role="alert" className="text-sm text-rose">{error}</p> : null}
    </DialogContent></Dialog>;
}
