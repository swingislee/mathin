"use client";
import { useState, useTransition } from "react";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DashboardPage, DashboardSection } from "./dashboard-page";
import type { RegistrationWorkbench } from "./parent-registration";
import { saveRegistrationPublication, reviewRegistration } from "./parent-registration-actions";
import { ActivityPageEditor } from "./miniapp-activity-page/Editor";
import { ApplicationAnswers } from "./miniapp-settings/ApplicationAnswers";

const words = {
  zh: { title: "对外展示与预报名", hint: "家长提交报名意向后，由学服线下联系。", back: "返回", public: "对外展示", name: "对外名称", description: "介绍", closes: "预报名截止时间", enabled: "在小程序展示并接受预报名", save: "保存", saved: "已保存", applications: "预报名", empty: "暂无预报名", reply: "联系结果（家长可见）", contact: "标记已联系", decline: "暂不接受", pending: "待联系", contacted: "已联系", confirmed: "历史正式报名", declined: "暂不接受", cancelled: "已撤回", note: "预报名不占用名额。家长线下缴费，正式入班由班级业务办理。", failed: "保存未完成，请重试。", conflict: "内容已变化，请刷新后核对。", hidden: "未展示", visible: "已展示" },
  en: { title: "Public listing and pre-registration", hint: "An advisor contacts families offline after they express interest.", back: "Back", public: "Public listing", name: "Public title", description: "Description", closes: "Pre-registration closes", enabled: "Show in Mini Program and accept pre-registration", save: "Save", saved: "Saved", applications: "Pre-registrations", empty: "No pre-registrations", reply: "Contact outcome (visible to family)", contact: "Mark contacted", decline: "Unable to accept", pending: "Awaiting contact", contacted: "Contacted", confirmed: "Historical enrollment", declined: "Unable to accept", cancelled: "Withdrawn", note: "Pre-registration does not reserve a seat. Families pay offline. Class membership is handled through the class workflow.", failed: "Could not save. Please retry.", conflict: "Details changed. Refresh to review.", hidden: "Hidden", visible: "Published" },
};
const field = "w-full rounded-lg border border-line bg-card px-3 py-2";
const localTime = (v: string) => { const d = new Date(v); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
export function ParentRegistrationSettings({ value, shortCourse = false }: { value: RegistrationWorkbench; shortCourse?: boolean }) {
  const locale = useLocale() === "en" ? "en" : "zh", router = useRouter();
  const t = { ...words[locale], ...(value.kind === "activity" ? locale === "zh" ? {
    title: "公益活动展示与报名", hint: "家长提交公益活动报名后，由学服联系确认。", closes: "活动报名截止时间",
    enabled: "在小程序展示公益活动并接受报名", applications: "活动报名", empty: "暂无活动报名",
    note: "小程序展示的公益活动不收取参与费用。提交申请不占用名额，由学服联系确认参与安排。",
  } : {
    title: "Community activity listing and registration", hint: "An advisor contacts families to confirm participation.", closes: "Activity registration closes",
    enabled: "Publish this community activity in the Mini Program", applications: "Activity requests", empty: "No activity requests",
    note: "Community activities published in the Mini Program have no participation fee. Requests do not reserve places; an advisor confirms arrangements.",
  } : { enabled: locale === "zh" ? "在家长网页展示并接受班级预报名" : "Show on the family website and accept class pre-registration" }) };
  if (shortCourse) Object.assign(t, locale === "zh" ? {
    title: "短期课展示与报名", hint: "参与人提交报名申请后，由工作人员联系确认。", applications: "短期课报名申请",
    enabled: "展示并接受短期课报名", note: "报名申请保存在本班；已开通的小程序入口与家长网页同步停止或恢复报名。申请不自动生成入班名册。",
  } : {
    title: "Short course listing and registration", hint: "Staff contact participants to confirm their requests.", applications: "Short course requests",
    enabled: "Publish and accept short course requests", note: "Requests are saved with this class. Its enabled Mini Program listing and family website listing open or close together. Requests do not create roster entries.",
  });
  const [busy, start] = useTransition(), [notice, setNotice] = useState("");
  const [draft, setDraft] = useState({ ...value.publication, bookingClosesAt: localTime(value.publication.bookingClosesAt) });
  const [revision, setRevision] = useState(value.publication.revision);
  const [replies, setReplies] = useState<Record<string, string>>({});
  if (revision !== value.publication.revision) {
    setRevision(value.publication.revision);
    setDraft({ ...value.publication, bookingClosesAt: localTime(value.publication.bookingClosesAt) });
  }
  const run = (action: () => ReturnType<typeof reviewRegistration>) => start(async () => {
    const r = await action(); setNotice(r.ok ? t.saved : r.code === "FORM_CHANGED" || r.code === "CONFLICT" ? t.conflict : t.failed);
    if (r.ok || !r.ok && r.code === "FORM_CHANGED") router.refresh();
  });
  return <DashboardPage title={`${value.name} · ${t.title}`} description={t.hint}
    backHref={value.kind === "class" ? `/dashboard/${shortCourse ? "short-courses" : "classes"}/${value.targetId}` : "/dashboard/activities"} backLabel={t.back}>
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {value.canPublish && <DashboardSection title={t.public} description={draft.enabled ? t.visible : t.hidden}>
      {!value.publishable && <p className="mb-4 text-sm text-muted">{locale === "en" ? "Set a future activity time or restore an active class before publishing." : "活动请先设置未来的举办时间；班级需处于有效的计划或开班状态。"}</p>}
      <form className="grid max-w-2xl gap-4" onSubmit={e => { e.preventDefault(); run(() => saveRegistrationPublication({ ...draft, kind: value.kind, targetId: value.targetId, bookingClosesAt: new Date(draft.bookingClosesAt).toISOString() })); }}>
        <label className="grid gap-1 text-sm">{t.name}<input className={field} value={draft.title} maxLength={120} required disabled={busy} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
        <label className="grid gap-1 text-sm">{t.description}<textarea className={field} value={draft.description} rows={4} maxLength={4000} disabled={busy} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
        <label className="grid gap-1 text-sm">{t.closes}<input className={field} type="datetime-local" value={draft.bookingClosesAt} required disabled={busy} onChange={e => setDraft({ ...draft, bookingClosesAt: e.target.value })} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.enabled} disabled={busy || (!value.publishable && !draft.enabled)} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} />{t.enabled}</label>
        <p className="text-sm text-muted">{t.note}</p><Button className="justify-self-start" disabled={busy}>{t.save}</Button>
      </form>
    </DashboardSection>}
    {value.canPublish && (value.kind === "activity" || shortCourse) && <ActivityPageEditor
      key={`${value.kind}/${value.targetId}`} target={{ kind: value.kind, targetId: value.targetId }}
      title={draft.title || value.name} description={value.publication.description} locale={locale} />}
    {value.canReview && <DashboardSection title={t.applications}>
      {!value.applications.length && <p className="text-sm text-muted">{t.empty}</p>}
      <div className="divide-y divide-line">{value.applications.map(a => <article key={a.id} className="grid gap-3 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><span>{a.participantName} · {a.title}</span><span className="text-sm text-muted">{t[a.status]} · {new Date(a.createdAt).toLocaleString(locale)}</span></div>
        {a.hasAnswers && <ApplicationAnswers id={a.id} en={locale === "en"} />}
        {a.status === "pending" ? <><label className="grid max-w-2xl gap-1 text-sm">{t.reply}<textarea className={field} value={replies[a.id] || ""} maxLength={2000} disabled={busy} onChange={e => setReplies({ ...replies, [a.id]: e.target.value })} /></label>
          <div className="flex gap-2"><Button size="sm" disabled={busy || !replies[a.id]?.trim()} onClick={() => run(() => reviewRegistration(a.id, true, replies[a.id]))}>{t.contact}</Button><Button size="sm" variant="secondary" disabled={busy || !replies[a.id]?.trim()} onClick={() => run(() => reviewRegistration(a.id, false, replies[a.id]))}>{t.decline}</Button></div></> : a.reply && <p className="text-sm text-muted">{a.reply}</p>}
      </article>)}</div>
    </DashboardSection>}
  </DashboardPage>;
}
