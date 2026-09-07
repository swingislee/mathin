"use client";

import { useState } from "react";
import { FolderOpen, RefreshCw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { CUBE_DRAFT_NAME_MAX, type CubeDraftErrorCode } from "./cube-structures-draft";
import type { CubeDraftLibrary } from "./useCubeDrafts";

const zh = {
  title: "账号草稿", name: "草稿名称", placeholder: "例如：分层计数 · 第一课", save: "保存草稿", saveAs: "另存为新草稿",
  library: "已保存草稿", choose: "选择一份草稿", open: "打开草稿", refresh: "刷新草稿列表", empty: "还没有保存的草稿。",
  loading: "正在读取账号草稿…", busy: "正在处理…", unsaved: "尚未保存", dirty: "有未保存更改", saved: "已保存",
  location: "保存到当前账号，其他设备登录同一账号、访问同一网站即可打开。每个账号最多 200 份草稿，每份 4 MB。",
  reopening: "保存包含备课现场、撤销记录和教学步骤；录制重新打开时暂停。保存或打开后刷新本页，会恢复该草稿的已保存版本。",
  login: "在新标签页登录", security: "在新标签页完成账号安全验证", returnAfterLogin: "完成后回到此页，点刷新草稿列表，当前现场保留。",
  demo: "回到备课模式后保存或打开。临场演示操作不会覆盖备课草稿。",
  openTitle: "打开另一份草稿？", openDescription: "当前未保存的修改会被替换。可以取消并先保存；已保存的其他草稿保持不变。",
  cancel: "取消", confirmOpen: "确认打开",
  errors: {
    invalid: "草稿内容不完整或操作记录无效，当前现场与原草稿均已保留。",
    version: "这份草稿使用其他版本，请用兼容版本打开；原草稿保持不变。",
    "too-large": "这份草稿超过当前保存容量（4 MB）。当前现场仍在，请先精简记录再保存。",
    unavailable: "暂时无法确认保存或读取结果。当前现场仍在，请保持页面打开，恢复网络后刷新列表或重试。",
    conflict: "另一设备或标签页已更新这份草稿。请重新打开最新版本，或另存为新草稿保留当前修改。",
    missing: "未找到这份草稿。请刷新草稿列表，当前现场保持不变。",
    "auth-required": "登录后即可保存和打开账号草稿，当前工具仍可使用。",
    "account-security": "请先完成账号安全验证，再返回此页刷新草稿列表。",
    "account-changed": "登录账号已改变。请在新标签页登录原账号以保存当前修改；换账号使用时重新打开工具页。",
    limit: "此账号已达到 200 份草稿上限，可以继续保存现有草稿。",
  } satisfies Record<CubeDraftErrorCode, string>,
};
const en = {
  title: "Account drafts", name: "Draft name", placeholder: "For example: Layer counting · Lesson 1", save: "Save draft", saveAs: "Save as a new draft",
  library: "Saved drafts", choose: "Choose a draft", open: "Open draft", refresh: "Refresh draft list", empty: "No saved drafts yet.",
  loading: "Reading account drafts…", busy: "Working…", unsaved: "Not saved yet", dirty: "Unsaved changes", saved: "Saved",
  location: "Saved to your account. Sign in to the same website on another device to open it. Up to 200 drafts per account, 4 MB each.",
  reopening: "Saves include preparation, undo history and lesson steps; recording reopens paused. After saving or opening, refreshing this page restores that draft's saved version.",
  login: "Sign in in a new tab", security: "Complete account security in a new tab", returnAfterLogin: "Return here and refresh the draft list when finished. Your current work stays open.",
  demo: "Return to Preparation to save or open. Live demo changes never overwrite your preparation draft.",
  openTitle: "Open another draft?", openDescription: "Unsaved changes will be replaced. Cancel to save first. Other saved drafts stay unchanged.",
  cancel: "Cancel", confirmOpen: "Open draft",
  errors: {
    invalid: "The draft has incomplete content or an invalid operation sequence. Your current work and the original draft are retained.",
    version: "This draft uses a different version. Open it with a compatible version; the original draft is unchanged.",
    "too-large": "This draft exceeds the current save capacity (4 MB). Your current work is retained; shorten the recording before saving.",
    unavailable: "The save or read result could not be confirmed. Keep this page open; refresh the list or retry when your connection is restored.",
    conflict: "Another device or tab updated this draft. Reopen the latest version, or save as a new draft to keep your changes.",
    missing: "This draft was not found. Refresh the draft list; your current work is unchanged.",
    "auth-required": "Sign in to save and open account drafts. You can still use the tool.",
    "account-security": "Complete account security, then return here and refresh the draft list.",
    "account-changed": "Your signed-in account changed. Sign back into the original account in a new tab to save this work, or open a fresh tool page for the new account.",
    limit: "This account has reached the 200-draft limit. You can still save updates to existing drafts.",
  },
} satisfies { [Key in keyof typeof zh]: Key extends "errors" ? Record<CubeDraftErrorCode, string> : string };

export function cubeDraftMessages(locale: "zh" | "en") { return locale === "en" ? en : zh; }

export function CubeDraftPanel({ locale, library, preparation, disabled = false }: {
  readonly locale: "zh" | "en"; readonly library: CubeDraftLibrary; readonly preparation: boolean; readonly disabled?: boolean;
}) {
  const m = cubeDraftMessages(locale);
  const [selected, setSelected] = useState("");
  const [confirmOpen, setConfirmOpen] = useState<string | null>(null);
  const draftId = library.drafts.some((draft) => draft.id === selected) ? selected : library.current?.id ?? library.drafts[0]?.id ?? "";
  const unavailable = disabled || library.loading || library.busy || !preparation || !library.accountReady;
  const savedAt = library.current ? new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(library.current.updatedAt)) : "";
  function open() {
    if (!draftId || unavailable) return;
    if (library.dirty) setConfirmOpen(draftId);
    else void library.open(draftId);
  }

  return <section className="space-y-2 text-xs" aria-label={m.title} data-cube-draft-panel>
    <div className="flex items-center justify-between gap-2"><h3 className="font-bold">{m.title}</h3><p role="status" className="text-muted" data-cube-draft-status={library.loading ? "loading" : library.dirty ? "dirty" : library.current ? "saved" : "new"}>
      {library.loading ? m.loading : library.busy ? m.busy : library.dirty ? m.dirty : library.current ? `${m.saved} · ${savedAt}` : m.unsaved}
    </p></div>
    <Label htmlFor="cube-draft-name" className="text-xs">{m.name}</Label>
    <Input id="cube-draft-name" className="h-8 text-xs" value={library.name} maxLength={CUBE_DRAFT_NAME_MAX} placeholder={m.placeholder} disabled={unavailable} onChange={(event) => library.setName(event.target.value)} />
    <div className="flex flex-wrap gap-1">
      <Button size="sm" disabled={unavailable || !library.name.trim()} onClick={() => { void library.save(); }}><Save className="size-3.5" aria-hidden />{m.save}</Button>
      {library.current && <Button size="sm" variant="secondary" disabled={unavailable || !library.name.trim()} onClick={() => { void library.save(true); }}>{m.saveAs}</Button>}
    </div>
    <div className="flex items-center justify-between gap-2"><span>{m.library}</span><Button size="sm" variant="ghost" className="size-7 p-0" aria-label={m.refresh} disabled={library.loading || library.busy} onClick={() => { void library.refresh(); }}><RefreshCw className="size-3.5" aria-hidden /></Button></div>
    {library.drafts.length ? <div className="flex items-center gap-1">
      <Select value={draftId} onValueChange={setSelected} disabled={unavailable}><SelectTrigger aria-label={m.library} className="min-w-0 flex-1 text-xs"><SelectValue placeholder={m.choose} /></SelectTrigger><SelectContent>
        {library.drafts.map((draft) => <SelectItem key={draft.id} value={draft.id}>{draft.name}</SelectItem>)}
      </SelectContent></Select>
      <Button size="sm" variant="secondary" className="size-8 shrink-0 p-0" aria-label={m.open} disabled={unavailable || !draftId} onClick={open}><FolderOpen className="size-4" aria-hidden /></Button>
    </div> : <p className="text-muted">{m.empty}</p>}
    {!preparation && <p className="leading-5 text-muted">{m.demo}</p>}
    {library.error && <p className="leading-5 text-rose" role="alert">{m.errors[library.error]}</p>}
    {library.error && ["auth-required", "account-security", "account-changed"].includes(library.error) && <div className="space-y-1">
      <a className="font-semibold text-primary underline" href={library.error === "account-security" ? `/${locale}/dashboard/account-security` : `/${locale}/login`} target="_blank" rel="noopener noreferrer">{library.error === "account-security" ? m.security : m.login}</a>
      <p className="leading-5 text-muted">{m.returnAfterLogin}</p>
    </div>}
    <p className="leading-5 text-muted">{m.location}</p>
    <p className="leading-5 text-muted">{m.reopening}</p>
    <AlertDialog open={confirmOpen !== null} onOpenChange={(open) => { if (!open) setConfirmOpen(null); }}><AlertDialogContent><AlertDialogHeader>
      <AlertDialogTitle>{m.openTitle}</AlertDialogTitle><AlertDialogDescription>{m.openDescription}</AlertDialogDescription>
    </AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{m.cancel}</AlertDialogCancel><AlertDialogAction onClick={() => { if (confirmOpen) void library.open(confirmOpen); setConfirmOpen(null); }}>{m.confirmOpen}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}
