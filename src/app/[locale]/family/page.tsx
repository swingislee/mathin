import { redirect } from "next/navigation";
import { LoginCard } from "@/components/auth/LoginCard";
import { getWechatConfig } from "@/features/wechat/config";
import { getActiveEnvironment, getProfile, requireUser } from "@/lib/auth";
import { resolveAvailableEnvironments } from "@/lib/environment";
import { createClient } from "@/lib/supabase/server";
import { setActiveEnvironmentAction } from "@/features/school/environment-actions";
import { Link } from "@/i18n/navigation";
import styles from "@/features/family-web/family.module.css";

export const metadata = { title: { absolute: "格致未来思维 · 家长服务" }, description: "查看孩子的安排、学习反馈与班级报名。" };
export default async function FamilyEntryPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ error?: string; wechatError?: string }> }) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const db = await createClient(), { data: { user } } = await db.auth.getUser();
  if (user) {
    await requireUser(locale);
    if (await getActiveEnvironment(user.id) === "family") redirect(`/${locale}/dashboard`);
    const profile = await getProfile(user.id), environments = await resolveAvailableEnvironments(db, user.id, profile?.role);
    return <div className={styles.root}><main className={`${styles.login} ${styles.stack}`}><h1 className={styles.heading}>{locale === "en" ? "Gezhi · Family services" : "格致未来思维 · 家长服务"}</h1>{environments.includes("family") ? <form action={setActiveEnvironmentAction}><input type="hidden" name="locale" value={locale} /><input type="hidden" name="env" value="family" /><button className={styles.button}>{locale === "en" ? "Enter my family space" : "进入我的家庭"}</button></form> : <p className={styles.notice}>{locale === "en" ? "This account does not have a family profile. Contact your advisor to link a child." : "当前账号尚未关联家长身份，请联系学服关联孩子。"}</p>}<Link href="/dashboard" className={styles.link}>{locale === "en" ? "Continue to my account" : "返回我的账号"}</Link></main></div>;
  }
  return <div className={styles.root}><main className={styles.login}><div className={styles.loginCard}><LoginCard family locale={locale} wechatAvailable={Boolean(getWechatConfig())} next={`/${locale}/family`} error={query.error} wechatError={query.wechatError} /></div></main></div>;
}
