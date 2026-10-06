import { ChevronRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { logout } from "@/app/[locale]/(auth)/actions";
import { getProfile, requireDashboardEnvironment } from "@/lib/auth";
import { resolveAvailableEnvironments } from "@/lib/environment";
import { createClient } from "@/lib/supabase/server";
import { getMyStudents } from "@/features/school/customer";
import { BindCodeForm } from "@/features/school/BindCodeForm";
import { isFeatureEnabled } from "@/features/school/organization-settings";
import { setActiveEnvironmentAction } from "@/features/school/environment-actions";
import { getFamilyAdvisors } from "@/features/family-web/data";
import { familyGrade } from "@/features/family-web/format";
import styles from "@/features/family-web/family.module.css";

export default async function FamilyAccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const { user } = await requireDashboardEnvironment(locale, ["family"]);
  const en = locale === "en", profile = await getProfile(user.id), db = await createClient();
  const [children, contacts, environments, finance] = await Promise.allSettled([
    getMyStudents(), getFamilyAdvisors(), resolveAvailableEnvironments(db, user.id, profile?.role), isFeatureEnabled("finance.enabled"),
  ]);
  return <div className={styles.stack}>
    <div><p className={styles.eyebrow}>{en ? "MY FAMILY" : "我的家庭"}</p><h1 className={styles.heading}>{profile?.displayName || (en ? "Family account" : "家长账号")}</h1></div>
    <section id="children" className={`${styles.card} ${styles.stack}`}><h2 className={styles.subheading}>{en ? "Linked children" : "关联的孩子"}</h2>
      {children.status === "rejected" ? <p className={styles.notice}>{en ? "Could not load child profiles." : "孩子信息暂时未能读取。"}</p> : children.value.map(child => <Link key={child.id} className={styles.row} href={`/dashboard/children?child=${child.id}`}><span>{child.name} <span className={styles.muted}>{familyGrade(child.grade, locale)}</span></span><ChevronRight size={18} aria-hidden /></Link>)}
      <details open={children.status === "fulfilled" && !children.value.length}><summary className={styles.link}>{en ? "Link a child" : "关联孩子"}</summary><p className={styles.muted}>{en ? "Enter the family code provided by your advisor." : "输入学服提供的家庭关联码。"}</p><BindCodeForm mode="guardian" /></details>
    </section>
    <section id="contact" className={`${styles.card} ${styles.stack}`}><h2 className={styles.subheading}>{en ? "Contact your advisor" : "联系学服"}</h2>
      {contacts.status === "rejected" ? <p className={styles.notice}>{en ? "Could not load contact details. Refresh to retry." : "联系方式暂时未能读取，请刷新重试。"}</p> : !contacts.value.length ? <p className={styles.muted}>{en ? "No contact details have been published yet. Use your existing contact." : "暂未公布联系方式，请通过已有联系方式咨询学服。"}</p> : <div className={styles.list}>{contacts.value.map(contact => <div className={styles.listItem} key={contact.grade}><div className={styles.row}><strong>{familyGrade(contact.grade, locale)} · {contact.teacherName}</strong>{contact.phone && <a href={`tel:${contact.phone}`} className={styles.link}>{en ? "Call" : "拨打电话"}</a>}</div><a href={contact.qrCodeUrl} className={styles.link} target="_blank" rel="noopener noreferrer">{en ? "View WeChat QR code" : "查看微信二维码"}<ChevronRight size={16} aria-hidden /></a></div>)}</div>}
    </section>
    <section className={`${styles.card} ${styles.accountLinks}`}>
      <Link href="/dashboard/registration">{en ? "Registration and progress" : "班级报名与进度"}<ChevronRight size={18} aria-hidden /></Link>
      <Link href="/dashboard/account-security">{en ? "Account security and consent" : "账号安全与信息授权"}<ChevronRight size={18} aria-hidden /></Link>
      {finance.status === "fulfilled" && finance.value && <Link href="/dashboard/finance">{en ? "Payments and balance" : "费用与余额"}<ChevronRight size={18} aria-hidden /></Link>}
    </section>
    {environments.status === "fulfilled" && environments.value.filter(env => env !== "family").map(env => <form key={env} action={setActiveEnvironmentAction}><input type="hidden" name="locale" value={locale} /><input type="hidden" name="env" value={env} /><button className={styles.secondary}>{env === "staff" ? en ? "Switch to staff workspace" : "进入员工工作台" : en ? "Switch to learning" : "进入学习空间"}</button></form>)}
    <form action={logout}><input type="hidden" name="locale" value={locale} /><input type="hidden" name="returnTo" value={`/${locale}/family`} /><button className={styles.link}>{en ? "Sign out" : "退出登录"}</button></form>
  </div>;
}
