"use client";

import { useRef, useState } from "react";
import { useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DashboardCommandActions, DashboardCommandFilters, DashboardCommandPanel, DashboardPage, DashboardTableShell } from "../dashboard-page";
import { readPromotions, savePromotion } from "./actions";
import type { PromotionDashboard } from "./contract";

export function PromotionWorkbench({ initial, configured }: { initial: PromotionDashboard; configured: boolean }) {
  const en = useLocale() === "en";
  const [data, setData] = useState(initial), [name, setName] = useState(""), [scene, setScene] = useState("");
  const [page, setPage] = useState(1), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [environment, setEnvironment] = useState("release");
  const version = useRef(0);
  const t = (zh: string, english: string) => en ? english : zh;
  const gradeLabel = (grade: string | null) => grade === null ? "" : grade === "-1" ? t("幼中班", "K2") : grade === "0" ? t("幼大班", "K3") : t(`${grade} 年级`, `Grade ${grade}`);
  const interestLabels: Record<string, string> = { math: t("数学思维", "Math thinking"), science: t("科学探索", "Science"), activities: t("公益活动", "Community activities") };
  async function load(nextScene = scene, nextPage = page) {
    const current = ++version.current;
    setBusy(true); setError("");
    try { const result = await readPromotions({ scene: nextScene || null, page: nextPage }); if (current === version.current) { setData(result); setScene(nextScene); setPage(nextPage); } }
    catch { if (current === version.current) setError(t("读取失败，请重试。", "Could not load records. Please retry.")); }
    finally { if (current === version.current) setBusy(false); }
  }
  async function save(value: { scene: string | null; name: string; enabled: boolean }) {
    if (busy) return;
    setBusy(true); setError("");
    try { const result = await savePromotion(value); if (!value.scene) setName(""); await load(value.scene ? scene : result, 1); }
    catch { setError(t("保存失败，请重试。", "Could not save. Please retry.")); }
    finally { setBusy(false); }
  }
  const states = en ? { new: "New family", existing_record: "Existing record", registered: "Repeat scan" }
    : { new: "新增家庭", existing_record: "已有记录", registered: "再次扫码" };
  return <DashboardPage title={t("微信推广", "WeChat promotion")} commandPanel={<DashboardCommandPanel>
    <DashboardCommandFilters><Label htmlFor="promotion-filter">{t("推广人员", "Promoter")}</Label>
      <select id="promotion-filter" className="h-9 rounded-md border border-line bg-card px-2 text-sm" value={scene} disabled={busy} onChange={event => void load(event.target.value, 1)}>
        <option value="">{t("全部人员", "All promoters")}</option>{data.promotions.map(row => <option key={row.scene} value={row.scene}>{row.name}{row.enabled ? "" : t("（已停用）", " (disabled)")}</option>)}
      </select></DashboardCommandFilters>
    <DashboardCommandActions><Button variant="secondary" disabled={busy} onClick={() => void load()}>{t("刷新", "Refresh")}</Button></DashboardCommandActions>
  </DashboardCommandPanel>}>
    <form className="flex flex-wrap items-end gap-3 py-3" onSubmit={event => { event.preventDefault(); void save({ scene: null, name: name.trim(), enabled: true }); }}>
      <div className="min-w-52"><Label htmlFor="promoter-name">{t("兼职／推广人员姓名", "Promoter name")}</Label><Input id="promoter-name" value={name} onChange={event => setName(event.target.value)} required maxLength={100} disabled={busy} /></div>
      <Button disabled={busy || !name.trim()} type="submit">{t("建立专属二维码", "Create personal code")}</Button>
      <p className="text-xs text-muted">{t("按验证手机号统计新增家庭；孩子信息单独保留。同名兼职请加上可区分的称呼。", "New families are counted by verified phone. Child details are kept separately. Use distinct names for promoters.")}</p>
    </form>
    {error && <p className="py-2 text-sm text-rose" role="alert">{error}</p>}
    {!configured && <p className="py-2 text-sm text-muted">{t("推广人员可以先建立；微信服务配置完成后可下载小程序码。", "You can add promoters now. Code downloads become available when WeChat is configured.")}</p>}
    <div className="flex items-center gap-2 py-2"><Label htmlFor="code-environment">{t("二维码版本", "Code version")}</Label>
      <select id="code-environment" value={environment} onChange={event => setEnvironment(event.target.value)} className="h-9 rounded-md border border-line bg-card px-2 text-sm">
        <option value="release">{t("正式版", "Release")}</option><option value="trial">{t("体验版", "Trial")}</option><option value="develop">{t("开发版", "Development")}</option>
      </select></div>
    <DashboardTableShell><Table mobileLayout="stacked"><TableHeader><TableRow>
      <TableHead>{t("推广人员", "Promoter")}</TableHead><TableHead>{t("新增家庭", "New families")}</TableHead><TableHead>{t("重复／已有", "Repeat / existing")}</TableHead><TableHead>{t("操作", "Actions")}</TableHead>
    </TableRow></TableHeader><TableBody>{data.promotions.map(row => <TableRow key={row.scene}>
      <TableCell>{row.name}{!row.enabled && <span className="ml-2 text-xs text-muted">{t("已停用", "Disabled")}</span>}</TableCell><TableCell>{row.newCount}</TableCell><TableCell>{row.repeatCount}</TableCell>
      <TableCell><div className="flex flex-wrap gap-3">
        {configured && row.enabled && <a className="text-sm underline underline-offset-4" href={`/api/v1/school/promotions/code?scene=${row.scene}&environment=${environment}`} target="_blank" rel="noreferrer">{t("打开／保存小程序码", "Open / save code")}</a>}
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void load(row.scene, 1)}>{t("查看记录", "View records")}</Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void save({ scene: row.scene, name: row.name, enabled: !row.enabled })}>{row.enabled ? t("停用", "Disable") : t("启用", "Enable")}</Button>
      </div></TableCell>
    </TableRow>)}{!data.promotions.length && <TableRow><TableCell colSpan={4} className="py-8 text-muted">{t("添加一位推广人员，建立专属小程序码。", "Add a promoter to create a personal Mini Program code.")}</TableCell></TableRow>}</TableBody></Table></DashboardTableShell>
    <h2 className="pt-6 pb-3 font-display text-lg">{t("扫码登记记录", "Scan registrations")}</h2>
    <DashboardTableShell><Table mobileLayout="stacked"><TableHeader><TableRow>
      {[t("家长与手机号", "Parent and phone"), t("孩子信息", "Child details"), t("推广归属", "Attribution"), t("授权定位", "Shared location"), t("登记时间", "Registered")].map(label => <TableHead key={label}>{label}</TableHead>)}
    </TableRow></TableHeader><TableBody>{data.records.map(row => <TableRow key={row.id}>
      <TableCell><div>{row.parentName || "—"}</div><div className="text-sm text-muted">{row.phone || "—"}</div></TableCell>
      <TableCell>{row.studentId ? <Link className="underline underline-offset-4" href={`/dashboard/students/${row.studentId}`}>{row.childName || t("学生档案", "Student profile")}</Link> : row.childName || "—"}
        <div className="text-sm text-muted">{gradeLabel(row.grade)} {row.school || ""}</div>
        {!!row.interests?.length && <div className="text-xs text-muted">{row.interests.map(value => interestLabels[value] || value).join(" · ")}</div>}
        {row.state === "existing_record" && <div className="text-xs text-muted">{t("历史档案关联待核对", "Historical profile match needs review")}</div>}</TableCell>
      <TableCell><div>{row.promoter || t("直接进入", "Direct entry")}</div><span className={row.state === "new" ? "text-sm text-leaf-deep" : "text-sm text-muted"}>{states[row.state]}</span></TableCell>
      <TableCell>{row.location?.status === "granted" && row.location.latitude !== undefined && row.location.longitude !== undefined
        ? <><a className="text-sm underline underline-offset-4" target="_blank" rel="noreferrer" href={`https://apis.map.qq.com/uri/v1/marker?marker=coord:${row.location.latitude},${row.location.longitude};title:${encodeURIComponent(t("登记地点", "Registration location"))}&referer=mathin`}>{row.location.latitude.toFixed(5)}, {row.location.longitude.toFixed(5)}</a>
          {row.location.accuracy != null && <div className="text-xs text-muted">± {Math.round(row.location.accuracy)} m</div>}</>
        : <span className="text-sm text-muted">{row.location?.status === "declined" ? t("未授权", "Not shared") : t("未记录", "Not recorded")}</span>}</TableCell>
      <TableCell className="text-sm">{new Date(row.at).toLocaleString(en ? "en-GB" : "zh-CN", { timeZone: "Asia/Shanghai" })}</TableCell>
    </TableRow>)}{!data.records.length && <TableRow><TableCell colSpan={5} className="py-8 text-muted">{t("暂无扫码登记记录", "No registrations yet")}</TableCell></TableRow>}</TableBody></Table></DashboardTableShell>
    <div className="flex items-center justify-between gap-3 py-3 text-sm"><span>{t(`共 ${data.total} 条 · 第 ${page} / ${Math.max(1, Math.ceil(data.total / 30))} 页`, `${data.total} records · Page ${page} / ${Math.max(1, Math.ceil(data.total / 30))}`)}</span>
      <div className="flex gap-2"><Button variant="secondary" disabled={busy || page === 1} onClick={() => void load(scene, page - 1)}>{t("上一页", "Previous")}</Button><Button variant="secondary" disabled={busy || page * 30 >= data.total} onClick={() => void load(scene, page + 1)}>{t("下一页", "Next")}</Button></div></div>
  </DashboardPage>;
}
