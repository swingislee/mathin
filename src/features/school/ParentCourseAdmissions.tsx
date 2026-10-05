"use client";
import { useState, useTransition } from "react";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DashboardPage } from "./dashboard-page";
import type { AdmissionsWorkbench, CoursePublication } from "./parent-course-admissions";
import { saveCoursePublication, reviewCourseApplication } from "./parent-course-admissions-actions";

const words = {
  zh: { title: "小程序课程报名", hint: "发布可报名的长期课程，处理家长选班申请。", publish: "课程发布", applications: "报名申请", add: "新建发布", edit: "编辑", name: "对外课程名称", description: "课程介绍", price: "报价（元，留空表示待工作人员确认）", closes: "申请截止时间", enabled: "在小程序上架", classes: "开放班级（同一课程系列、年级和学期）", save: "保存", cancel: "取消", emptyClasses: "没有可发布的正式班级。请先建立长期正式班，并关联课程和学期。", pending: "待确认", confirmed: "已确认报名", declined: "未通过", cancelled: "已撤回", empty: "暂无报名申请", review: "处理申请", reply: "处理说明（家长可见）", verified: "已核对报名条件及缴费依据", confirm: "确认报名并分班", decline: "不予通过", note: "家长提交申请不占用名额，也不代表缴费。确认会建立正式报名并加入所选班级；费用事实在财务记录中核对。", quoted: "报价待确认", published: "已上架", hidden: "未上架", expired: "已截止", saved: "已保存", failed: "操作未完成，请刷新后重试", full: "班级已满，请联系家长重新选班", scope: "没有处理该学生或班级的权限", conflict: "申请或报名状态已变化，请刷新核对", mismatch: "请选同一课程系列、年级、学期的有效班级", teacher: "任课老师待定", place: "校区待定", permission: "确认报名还需要跟进写入权限，请由有权限的工作人员处理。" },
  en: { title: "Mini Program admissions", hint: "Publish long-term courses and review family applications.", publish: "Course offers", applications: "Applications", add: "New offer", edit: "Edit", name: "Public course title", description: "Description", price: "Quote (CNY, leave blank for staff confirmation)", closes: "Applications close", enabled: "Publish in Mini Program", classes: "Classes (same family, grade and term)", save: "Save", cancel: "Cancel", emptyClasses: "Create a formal long-term class with a course and term first.", pending: "Pending", confirmed: "Enrollment confirmed", declined: "Declined", cancelled: "Withdrawn", empty: "No applications", review: "Review", reply: "Reply visible to the family", verified: "Enrollment requirements and payment evidence checked", confirm: "Confirm and place in class", decline: "Decline", note: "Applications do not reserve seats or record payment. Confirmation creates enrollment and class placement. Check payment evidence in finance.", quoted: "Quote to be confirmed", published: "Published", hidden: "Unpublished", expired: "Closed", saved: "Saved", failed: "Could not complete. Refresh and retry.", full: "Class full. Contact the family to choose another class.", scope: "You do not have access to this student or class.", conflict: "Application or enrollment changed. Refresh to review.", mismatch: "Select active classes in the same course family, grade and term.", teacher: "Teacher pending", place: "Campus pending", permission: "Confirmation also requires follow-up write permission." },
};
const field = "w-full rounded-lg border border-line bg-card px-3 py-2";
const localTime = (value: string) => {
  const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export function ParentCourseAdmissions({ value }: { value: AdmissionsWorkbench }) {
  const locale = useLocale() === "en" ? "en" : "zh";
  const t = words[locale]; const router = useRouter();
  const [busy, start] = useTransition();
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<CoursePublication | null | undefined>(undefined);
  const [selected, setSelected] = useState<string[]>([]);
  const [reviewing, setReviewing] = useState("");
  const money = (n: number | null) => n === null ? t.quoted : `¥${(n / 100).toFixed(2)}`;
  function outcome(result: { ok: boolean; code?: string }) {
    setNotice(result.ok ? t.saved : result.code === "CLASS_FULL" ? t.full : result.code?.includes("FORBIDDEN") ? t.scope
      : result.code === "CLASS_TARGET_MISMATCH" ? t.mismatch : ["CONFLICT", "ALREADY_ENROLLED_FOR_COURSE", "ENROLLMENT_ALREADY_ASSIGNED"].includes(result.code || "") ? t.conflict : t.failed);
    if (result.ok) { setEditing(undefined); setReviewing(""); router.refresh(); }
  }
  return <DashboardPage title={t.title}>
    <p className="mb-6 text-sm text-muted-foreground">{t.hint}</p>
    {notice && <p role="status" className="mb-4 rounded-xl border border-line p-3">{notice}</p>}
    <section className="mb-8 space-y-3">
      <h2 className="text-lg font-semibold">{t.applications}</h2>
      <p className="max-w-3xl text-sm text-muted-foreground">{t.note}</p>
      {!value.applications.length && <p className="py-6 text-muted-foreground">{t.empty}</p>}
      {value.applications.map(a => <article key={a.id} className="rounded-xl border border-line bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><strong>{a.participantName} · {a.title}</strong><p className="mt-1 text-sm">{a.className} · {money(a.priceCents)} · {new Date(a.createdAt).toLocaleString(locale)}</p></div><span>{t[a.status]}</span></div>
        {a.reply && <p className="mt-3 whitespace-pre-wrap text-sm">{a.reply}</p>}
        {a.status === "pending" && reviewing !== a.id && <Button className="mt-3" size="sm" variant="secondary" disabled={busy} onClick={() => setReviewing(a.id)}>{t.review}</Button>}
        {a.status === "pending" && reviewing === a.id && <form className="mt-4 space-y-3" onSubmit={event => {
          event.preventDefault(); const data = new FormData(event.currentTarget);
          const confirm = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "confirm";
          if (confirm && data.get("verified") !== "on") { setNotice(t.verified); return; }
          start(async () => outcome(await reviewCourseApplication(a.id, confirm, String(data.get("reply") || ""))));
        }}>
          <label className="block text-sm">{t.reply}<textarea className={field + " mt-1"} name="reply" required maxLength={2000} disabled={busy} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="verified" disabled={busy || !value.canConfirm} />{t.verified}</label>
          {!value.canConfirm && <p className="text-sm text-muted-foreground">{t.permission}</p>}
          <div className="flex gap-2"><Button type="submit" value="confirm" disabled={busy || !value.canConfirm}>{t.confirm}</Button><Button variant="secondary" type="submit" value="decline" disabled={busy}>{t.decline}</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => setReviewing("")}>{t.cancel}</Button></div>
        </form>}
      </article>)}
    </section>
    {value.canPublish && <section className="space-y-3">
      <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">{t.publish}</h2><Button disabled={busy} onClick={() => { setEditing(null); setSelected([]); }}>{t.add}</Button></div>
      {editing !== undefined && <form key={editing?.id || "new"} className="space-y-4 rounded-xl border border-line bg-card p-4" onSubmit={event => {
        event.preventDefault(); const data = new FormData(event.currentTarget); const price = String(data.get("price") || "").trim();
        start(async () => outcome(await saveCoursePublication({ id: editing?.id || null, title: String(data.get("title")), description: String(data.get("description")),
          priceCents: price === "" ? null : Math.round(Number(price) * 100), bookingClosesAt: new Date(String(data.get("closes"))).toISOString(), enabled: data.get("enabled") === "on", classroomIds: selected })));
      }}>
        <label className="block text-sm">{t.name}<input className={field + " mt-1"} name="title" required maxLength={120} defaultValue={editing?.title} disabled={busy} /></label>
        <label className="block text-sm">{t.description}<textarea className={field + " mt-1"} name="description" maxLength={4000} defaultValue={editing?.description} disabled={busy} /></label>
        <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm">{t.price}<input className={field + " mt-1"} type="number" min="0" step="0.01" name="price" defaultValue={editing?.priceCents == null ? "" : editing.priceCents / 100} disabled={busy} /></label>
          <label className="block text-sm">{t.closes}<input className={field + " mt-1"} type="datetime-local" required name="closes" defaultValue={editing ? localTime(editing.bookingClosesAt) : ""} disabled={busy} /></label></div>
        <fieldset disabled={busy}><legend className="mb-2 text-sm">{t.classes}</legend>
          {!value.classes.length && <p>{t.emptyClasses}</p>}
          <div className="max-h-72 space-y-2 overflow-y-auto">{value.classes.map(c => <label key={c.id} className="flex gap-3 rounded-lg border border-line p-3 text-sm">
            <input type="checkbox" checked={selected.includes(c.id)} onChange={event => setSelected(event.target.checked ? [...selected, c.id] : selected.filter(id => id !== c.id))} />
            <span>{c.name} · {c.familyTitle} · {c.grade} · {c.level} · {c.termName}<span className="block text-muted-foreground">{c.campusName || t.place} · {c.teachers.map(x => x.name).join("、") || t.teacher} · {c.sessions.length} {locale === "zh" ? "个已排课次" : "scheduled lessons"}</span></span>
          </label>)}</div>
        </fieldset>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={editing?.enabled || false} disabled={busy} />{t.enabled}</label>
        <div className="flex gap-2"><Button type="submit" disabled={busy || !selected.length}>{t.save}</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => setEditing(undefined)}>{t.cancel}</Button></div>
      </form>}
      {value.publications.map(p => <div key={p.id} className="flex items-center justify-between gap-4 rounded-xl border border-line p-4"><div><strong>{p.title}</strong><p className="text-sm">{money(p.priceCents)} · {!p.enabled ? t.hidden : new Date(p.bookingClosesAt).getTime() <= Date.now() ? t.expired : t.published}</p></div><Button variant="secondary" disabled={busy} onClick={() => { setEditing(p); setSelected(p.classroomIds); }}>{t.edit}</Button></div>)}
    </section>}
  </DashboardPage>;
}
