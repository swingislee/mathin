"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { z } from "zod";
import { Link } from "@/i18n/navigation";
import { newId } from "@/lib/uuid";
import { courseCommandSchema, type courseApplicationSchema, type courseOfferSchema } from "@/features/parent-portal/course-contract";
import type { MyStudentRow } from "@/features/school/customer";
import { submitFamilyRegistration } from "./registration-actions";
import { familyDate, familyGrade } from "./format";
import styles from "./family.module.css";

type Offer = z.infer<typeof courseOfferSchema>;
type Application = z.infer<typeof courseApplicationSchema>;
type Command = Extract<z.infer<typeof courseCommandSchema>, { action: "apply" }>;
const words = {
  zh: { title: "班级报名", intro: "先了解班级安排，再提交预报名意向。", classes: "可报名班级", history: "报名记录", all: "全部", long: "长期班", short: "短期班", allGrades: "全部年级", empty: "暂无符合条件的已发布班级", detail: "查看安排", back: "返回班级列表", choose: "选择孩子", apply: "提交预报名", retry: "重试这份申请", note: "预报名不占用名额。学服会联系你确认安排、费用与正式报名事宜。", submitted: "预报名已提交", submittedNote: "学服会与你联系。你可以在报名记录中查看进度和回复。", unknown: "暂未收到提交结果。请保留这份申请重试，或先到报名记录中核对。", storage: "浏览器暂时无法保存申请，请允许网站存储后重试。", invalid: "提交未完成，请核对孩子与班级信息。", changed: "班级安排或报名状态已变化，请刷新后核对。", unavailable: "暂时无法读取，请刷新页面重试。", pending: "待联系", contacted: "已联系", confirmed: "历史正式报名", declined: "暂不接受", cancelled: "已撤回", withdraw: "撤回申请", withdrawConfirm: "确认撤回这份待联系的申请？", noHistory: "还没有报名记录", needsChild: "关联孩子后，即可提交预报名。", linkChild: "去关联孩子", schedule: "已排课次", location: "地点", teacher: "老师", level: "班型", deadline: "报名截止", pendingInfo: "待确认", activity: "公益活动", seats: "余位", fees: "费用由学服联系确认" },
  en: { title: "Class registration", intro: "Explore the arrangements and express your interest.", classes: "Available classes", history: "My requests", all: "All", long: "Long-term", short: "Short courses", allGrades: "All grades", empty: "No published classes match these filters", detail: "View arrangements", back: "Back to classes", choose: "Choose a child", apply: "Submit pre-registration", retry: "Retry this request", note: "Pre-registration does not reserve a seat. An advisor will contact you about arrangements, fees and enrollment.", submitted: "Pre-registration submitted", submittedNote: "An advisor will contact you. Check your requests for progress and replies.", unknown: "The result has not arrived. Retry this same request or check your records first.", storage: "Your browser could not save this request. Allow website storage and retry.", invalid: "Could not submit. Check the selected child and class.", changed: "The arrangements or request status changed. Refresh to review.", unavailable: "Could not load this information. Refresh to retry.", pending: "Awaiting contact", contacted: "Contacted", confirmed: "Historical enrollment", declined: "Unable to accept", cancelled: "Withdrawn", withdraw: "Withdraw request", withdrawConfirm: "Withdraw this pending request?", noHistory: "No requests yet", needsChild: "Link your child's profile to pre-register.", linkChild: "Link a child", schedule: "Scheduled lessons", location: "Location", teacher: "Teacher", level: "Class type", deadline: "Registration closes", pendingInfo: "To be confirmed", activity: "Community activity", seats: "Places left", fees: "An advisor will confirm the fees" },
};
function failureText(code: string, t: typeof words.zh) {
  return code === "UNAVAILABLE" ? t.unknown : ["FORM_CHANGED", "BOOKING_CLOSED", "CONFLICT", "NOT_FOUND"].includes(code) ? t.changed : t.invalid;
}

function RegistrationForm({ offer, students, applications, locale, userId, onHistory }: { offer: Offer; students: MyStudentRow[]; applications: Application[]; locale: "zh" | "en"; userId: string; onHistory: () => void }) {
  const t = words[locale], router = useRouter();
  const row = offer.classes[0];
  const key = `gezhi.family-registration.v1.${userId}.${offer.id}`;
  // This form mounts after selecting a class, so restoring browser storage is part of its initial state.
  const [initial] = useState((): { pending: Command | null; studentId: string; done: boolean; notice: string } => {
    const fallback = { pending: null, studentId: students[0]?.id || "", done: false, notice: "" };
    try {
      const saved = sessionStorage.getItem(key);
      if (saved) {
        const parsed = courseCommandSchema.safeParse(JSON.parse(saved));
        if (parsed.success && parsed.data.action === "apply" && parsed.data.kind === "class" && parsed.data.publicationId === offer.id) {
          const command = parsed.data;
          return { pending: command, studentId: command.participantId, done: applications.some(item => item.id === command.id), notice: t.unknown };
        }
      }
    } catch { return { ...fallback, notice: t.storage }; }
    return fallback;
  });
  const [studentId, setStudentId] = useState(initial.studentId);
  const [pending, setPending] = useState<Command | null>(initial.pending), [notice, setNotice] = useState(initial.notice), [submitted, setSubmitted] = useState(initial.done);
  const done = submitted || Boolean(pending && applications.some(item => item.id === pending.id));
  const [busy, start] = useTransition();
  const locked = useRef(false);
  useEffect(() => { if (done) { try { sessionStorage.removeItem(key); } catch { /* The server record already confirms receipt. */ } } }, [done, key]);
  const submit = () => {
    if (locked.current || done || !row) return;
    const command: Command = pending || { action: "apply", kind: "class", id: newId(), publicationId: offer.id, classroomId: row.id, revision: offer.revision, participantId: studentId };
    try { sessionStorage.setItem(key, JSON.stringify(command)); } catch { setNotice(t.storage); return; }
    locked.current = true; setPending(command); setNotice("");
    start(async () => {
      try {
        const result = await submitFamilyRegistration(locale, command);
        if (result.ok) { setPending(null); setSubmitted(true); router.refresh(); }
        else {
          if (result.code !== "UNAVAILABLE") { sessionStorage.removeItem(key); setPending(null); }
          setNotice(failureText(result.code, t));
        }
      } catch { setNotice(t.unknown); }
      finally { locked.current = false; }
    });
  };
  return <section className={`${styles.card} ${styles.stack}`}>
    <div><span className={styles.badge}>{row?.offeringType === "short_term_topic" ? t.short : t.long}</span><h2 className={styles.heading}>{offer.title}</h2><p className={styles.muted}>{[familyGrade(row?.grade ?? null, locale), row?.subject, row?.termName].filter(Boolean).join(" · ")}</p></div>
    {offer.description && <p className={styles.description}>{offer.description}</p>}
    <dl className={styles.details}>
      <div><dt>{t.location}</dt><dd>{[row?.campusName, row?.roomName].filter(Boolean).join(" · ") || t.pendingInfo}</dd></div>
      <div><dt>{t.teacher}</dt><dd>{row?.teachers.map(item => item.name).join("、") || t.pendingInfo}</dd></div>
      {row?.level && <div><dt>{t.level}</dt><dd>{row.level}</dd></div>}
      {row?.remaining !== null && row?.remaining !== undefined && <div><dt>{t.seats}</dt><dd>{row.remaining}</dd></div>}
      <div><dt>{t.deadline}</dt><dd>{familyDate(offer.bookingClosesAt, locale)}</dd></div>
    </dl>
    <details><summary className={styles.link}>{t.schedule} · {row?.sessions.length || 0}</summary><div className={styles.list}>{row?.sessions.map(item => <p className={styles.listItem} key={item.at}>{familyDate(item.at, locale)} · {item.duration} {locale === "en" ? "min" : "分钟"}</p>)}</div></details>
    <p className={styles.muted}>{t.fees}</p>
    {done ? <div className={styles.hero} role="status"><h2>{t.submitted}</h2><p>{t.submittedNote}</p><button className={styles.button} onClick={onHistory}>{t.history}</button></div> : <form className={styles.form} onSubmit={e => { e.preventDefault(); submit(); }}>
      {students.length ? <label className={styles.field}>{t.choose}<select required value={studentId} disabled={busy || Boolean(pending)} onChange={e => setStudentId(e.target.value)}>{students.map(item => <option key={item.id} value={item.id}>{item.name} · {familyGrade(item.grade, locale)}</option>)}</select></label> : <p className={styles.notice}>{t.needsChild} <Link className={styles.link} href="/dashboard/family-account#children">{t.linkChild}</Link></p>}
      <p className={styles.muted}>{t.note}</p>
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      <button className={styles.button} disabled={busy || !studentId || !row}>{busy ? "…" : pending ? t.retry : t.apply}</button>
      {pending && <button type="button" className={styles.link} onClick={onHistory}>{t.history}</button>}
    </form>}
  </section>;
}

export function FamilyRegistration({ offers, applications, students, locale: rawLocale, userId }: { offers: Offer[]; applications: Application[]; students: MyStudentRow[]; locale: string; userId: string }) {
  const locale = rawLocale === "en" ? "en" : "zh", t = words[locale], router = useRouter();
  const [tab, setTab] = useState("classes"), [kind, setKind] = useState(""), [grade, setGrade] = useState("");
  const [selected, setSelected] = useState<string | null>(null), [notice, setNotice] = useState("");
  const [busy, start] = useTransition();
  const current = offers.find(row => row.id === selected);
  const filtered = offers.filter(offer => offer.classes.some(row => (!grade || String(row.grade) === grade) && (!kind || (kind === "short" ? row.offeringType === "short_term_topic" : row.offeringType !== "short_term_topic"))));
  const grades = Array.from(new Set(offers.flatMap(row => row.classes.flatMap(item => item.grade === null ? [] : [item.grade])))).sort((a, b) => a - b);
  const showHistory = () => { setSelected(null); setTab("history"); router.refresh(); };
  const cancel = (id: string) => {
    if (busy || !window.confirm(t.withdrawConfirm)) return;
    start(async () => {
      try { const result = await submitFamilyRegistration(locale, { action: "cancel", id }); setNotice(result.ok ? t.cancelled : failureText(result.code, t)); router.refresh(); }
      catch { setNotice(t.unknown); }
    });
  };
  return <div className={styles.stack}>
    <div><h1 className={styles.heading}>{t.title}</h1><p className={styles.muted}>{t.intro}</p></div>
    <div className={styles.pills}><button className={styles.pill} aria-pressed={tab === "classes"} onClick={() => { setTab("classes"); setSelected(null); }}>{t.classes}</button><button className={styles.pill} aria-pressed={tab === "history"} onClick={showHistory}>{t.history}</button></div>
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {tab === "history" ? <div className={styles.stack}>{!applications.length && <p className={styles.card}>{t.noHistory}</p>}{applications.map(item => <article key={item.id} className={`${styles.card} ${styles.stack}`}><div className={styles.row}><h2 className={styles.subheading}>{item.title}</h2><span className={styles.badge}>{t[item.status]}</span></div><p className={styles.muted}>{item.participantName} · {item.kind === "activity" ? t.activity : item.className}<br />{familyDate(item.createdAt, locale)}</p>{item.reply && <p className={styles.description}>{item.reply}</p>}{item.status === "pending" && <button className={styles.secondary} disabled={busy} onClick={() => cancel(item.id)}>{t.withdraw}</button>}</article>)}</div>
      : current ? <><button className={styles.link} onClick={() => setSelected(null)}>← {t.back}</button><RegistrationForm key={current.id} offer={current} students={students} applications={applications} locale={locale} userId={userId} onHistory={showHistory} /></>
      : <>
        {selected && <p className={styles.notice}>{t.changed}</p>}
        <div className={styles.pills}>{(["", "long", "short"] as const).map(value => <button className={styles.pill} key={value} aria-pressed={kind === value} onClick={() => setKind(value)}>{value ? t[value] : t.all}</button>)}</div>
        <label className={styles.field}>{t.allGrades}<select value={grade} onChange={e => setGrade(e.target.value)}><option value="">{t.allGrades}</option>{grades.map(value => <option value={value} key={value}>{familyGrade(value, locale)}</option>)}</select></label>
        {!filtered.length && <p className={styles.card}>{t.empty}</p>}
        <div className={styles.catalog}>{filtered.map(offer => { const row = offer.classes[0]; return <article key={offer.id} className={styles.card}><div><span className={styles.badge}>{row?.offeringType === "short_term_topic" ? t.short : t.long}</span><h2 className={styles.subheading}>{offer.title}</h2><p className={styles.muted}>{[familyGrade(row?.grade ?? null, locale), row?.subject, row?.campusName].filter(Boolean).join(" · ")}</p></div><p className={styles.muted}>{row?.sessions[0] ? familyDate(row.sessions[0].at, locale) : t.pendingInfo}</p><button className={styles.secondary} onClick={() => setSelected(offer.id)}>{t.detail}</button></article>; })}</div>
      </>}
    <Link href="/dashboard/family-account#contact" className={styles.link}>{locale === "en" ? "Contact an advisor" : "联系学服"}</Link>
  </div>;
}
