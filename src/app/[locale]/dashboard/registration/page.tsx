import { requireDashboardEnvironment } from "@/lib/auth";
import { getMyStudents } from "@/features/school/customer";
import { getFamilyRegistration } from "@/features/family-web/data";
import { FamilyRegistration } from "@/features/family-web/FamilyRegistration";
import styles from "@/features/family-web/family.module.css";

export default async function RegistrationPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const { user } = await requireDashboardEnvironment(locale, ["family"]);
  const result = await Promise.allSettled([getFamilyRegistration(), getMyStudents()]);
  if (result[0].status !== "fulfilled" || result[1].status !== "fulfilled") {
    return <div className={styles.stack}><h1 className={styles.heading}>{locale === "en" ? "Class registration" : "班级报名"}</h1><p className={styles.notice} role="alert">{locale === "en" ? "Could not load registration information. Refresh to retry." : "报名信息暂时未能读取，请刷新页面重试。"}</p></div>;
  }
  return <FamilyRegistration {...result[0].value} students={result[1].value} locale={locale} userId={user.id} />;
}
