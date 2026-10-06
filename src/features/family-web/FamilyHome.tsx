"use client";

import { useState } from "react";
import { BookOpen, CalendarClock, MessageSquareText, ArrowUpRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import type { MyLearningSummary } from "@/features/school/customer";
import type { FamilySession } from "./data";
import { familyDate, familyGrade } from "./format";
import styles from "./family.module.css";

export function FamilyHome({ locale, name, students, sessions, unavailable, scheduleUnavailable, today }: {
  locale: string; name: string; students: MyLearningSummary[]; today: string; sessions: FamilySession[]; unavailable: boolean; scheduleUnavailable: boolean;
}) {
  const en = locale === "en";
  const [childId, setChildId] = useState(students[0]?.studentId || "");
  const child = students.find(row => row.studentId === childId) || students[0];
  const upcoming = sessions.filter(row => row.studentId === child?.studentId);
  const next = upcoming[0];
  return <div className={styles.stack}>
    <div><p className={styles.eyebrow}>{familyDate(today, locale, false)}</p><h1 className={styles.heading}>{en ? `Hello${name ? `, ${name}` : ""}` : `你好${name ? `，${name}` : ""}`}</h1><p className={styles.muted}>{en ? "Your child's plans and progress, together." : "孩子的安排和成长，都在这里。"}</p></div>
    {unavailable && <p role="alert" className={styles.notice}>{en ? "Some information could not be loaded. Refresh to try again." : "部分信息暂时未能读取，请刷新页面重试。"}</p>}
    {child ? <>
      <div className={styles.pills} aria-label={en ? "Choose a child" : "选择孩子"}>{students.map(row => <button key={row.studentId} className={styles.pill} aria-pressed={row.studentId === child.studentId} onClick={() => setChildId(row.studentId)}>{row.studentName} · {familyGrade(row.grade, locale)}</button>)}</div>
      <section className={styles.hero} aria-label={en ? "Next lesson" : "下一次安排"}><p>{en ? "COMING UP" : "下一次安排"}</p>{scheduleUnavailable ? <h2>{en ? "Schedule could not be loaded" : "课表暂时未能读取"}</h2> : next ? <><h2>{familyDate(next.at, locale)}</h2><p>{next.classroom}<br />{next.title}{next.teacher ? ` · ${next.teacher}` : ""}</p></> : <><h2>{en ? "No lessons in the next 7 days" : "未来 7 天暂无课程安排"}</h2><p>{en ? "New lessons will appear here once scheduled." : "排课更新后，会在这里显示。"}</p></>}<Link className={styles.link} href="/dashboard/family-schedule">{en ? "View schedule" : "查看课表"}<ArrowUpRight size={16} aria-hidden /></Link></section>
      <div className={styles.quick}>
        <Link href={`/dashboard/children?child=${child.studentId}`}><MessageSquareText size={24} aria-hidden />{en ? "Feedback" : "学习反馈"}</Link>
        <Link href={`/dashboard/assignments?child=${child.studentId}`}><BookOpen size={24} aria-hidden />{en ? "Practice" : "课后作业"}{child.pendingAssignmentCount ? ` · ${child.pendingAssignmentCount}` : ""}</Link>
        <Link href={`/dashboard/children?child=${child.studentId}#leave`}><CalendarClock size={24} aria-hidden />{en ? "Request leave" : "我要请假"}</Link>
      </div>
      {upcoming.length > 1 && <section className={styles.card}><div className={styles.row}><h2 className={styles.subheading}>{en ? "Next 7 days" : "接下来一周"}</h2><span className={styles.badge}>{en ? `${upcoming.length} lessons` : `${upcoming.length} 次课`}</span></div><div className={styles.list}>{upcoming.slice(1, 4).map(row => <div key={row.id} className={styles.listItem}><strong>{familyDate(row.at, locale)}</strong><p className={styles.muted}>{row.classroom} · {row.title}</p></div>)}</div></section>}
    </> : !unavailable && <section className={styles.hero}><h2>{en ? "Connect your child's profile" : "先关联孩子，查看专属安排"}</h2><p>{en ? "Use the family code provided by your advisor." : "使用学服提供的家庭关联码，即可查看孩子的课表、作业和反馈。"}</p><Link href="/dashboard/family-account#children" className={styles.button}>{en ? "Link a child" : "关联孩子"}</Link></section>}
    <section className={styles.card}><div className={styles.row}><div><h2 className={styles.subheading}>{en ? "Explore classes" : "了解适合孩子的班级"}</h2><p className={styles.muted}>{en ? "Browse arrangements and submit your interest." : "查看班级安排，提交预报名意向。"}</p></div><Link href="/dashboard/registration" className={styles.link}>{en ? "Browse" : "去看看"}<ArrowUpRight size={16} aria-hidden /></Link></div></section>
    <Link href="/dashboard/family-account#contact" className={styles.link}>{en ? "Need help? Contact your advisor" : "需要帮助？联系学服"}</Link>
  </div>;
}
