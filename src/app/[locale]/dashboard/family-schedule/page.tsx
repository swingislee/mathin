import { Link } from "@/i18n/navigation";
import { requireDashboardEnvironment } from "@/lib/auth";
import { getFamilySchedule } from "@/features/family-web/data";
import { familyDate } from "@/features/family-web/format";
import styles from "@/features/family-web/family.module.css";

export default async function FamilySchedulePage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ week?: string }> }) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  await requireDashboardEnvironment(locale, ["family"]);
  const en = locale === "en", week = Math.trunc(Math.max(-12, Math.min(12, Number(query.week) || 0)));
  const shanghaiDay = new Date(new Date().getTime() + 8 * 3600000).toISOString().slice(0, 10);
  const start = new Date(Date.parse(`${shanghaiDay}T00:00:00+08:00`) + Math.trunc(week) * 7 * 86400000);
  const end = new Date(start.getTime() + 7 * 86400000);
  const [result] = await Promise.allSettled([getFamilySchedule(start.toISOString(), end.toISOString())]);
  return <div className={styles.stack}><div><h1 className={styles.heading}>{en ? "Family schedule" : "孩子的课表"}</h1><p className={styles.muted}>{familyDate(start.toISOString(), locale, false)} — {familyDate(new Date(end.getTime() - 1).toISOString(), locale, false)}</p></div>
    <div className={styles.row}><Link className={styles.link} href={`/dashboard/family-schedule?week=${Math.max(-12, week - 1)}`}>← {en ? "Previous" : "前一周"}</Link><Link className={styles.pill} href="/dashboard/family-schedule">{en ? "Today" : "回到今天"}</Link><Link className={styles.link} href={`/dashboard/family-schedule?week=${Math.min(12, week + 1)}`}>{en ? "Next" : "后一周"} →</Link></div>
    {result.status === "rejected" ? <p role="alert" className={styles.notice}>{en ? "Could not load the schedule. Refresh to retry." : "课表暂时未能读取，请刷新页面重试。"}</p> : !result.value.length ? <p className={styles.card}>{en ? "No lessons scheduled in this period." : "这段时间暂无课程安排。"}</p> : result.value.map(row => <article key={`${row.id}-${row.studentId}`} className={`${styles.card} ${styles.stack}`}><div className={styles.row}><h2 className={styles.subheading}>{familyDate(row.at, locale)}</h2><span className={styles.badge}>{row.studentName}</span></div><p>{row.classroom} · {row.title}</p><p className={styles.muted}>{row.teacher}{row.duration ? ` · ${row.duration} ${en ? "min" : "分钟"}` : ""}</p><div className={styles.row}><Link className={styles.link} href={`/dashboard/children?child=${row.studentId}`}>{en ? "Learning details" : "查看学习情况"}</Link><Link className={styles.link} href={`/dashboard/children?child=${row.studentId}#leave`}>{en ? "Request leave" : "请假"}</Link></div></article>)}
  </div>;
}
