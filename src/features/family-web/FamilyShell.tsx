"use client";

import { CalendarDays, House, NotebookPen, Sprout, UserRound } from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import styles from "./family.module.css";

export function FamilyShell({ children, locale }: { children: React.ReactNode; locale: string }) {
  const pathname = usePathname();
  const en = locale === "en";
  const items = [
    { href: "/dashboard", title: en ? "Home" : "首页", icon: House },
    { href: "/dashboard/family-schedule", title: en ? "Schedule" : "课表", icon: CalendarDays },
    { href: "/dashboard/registration", title: en ? "Register" : "报名", icon: NotebookPen },
    { href: "/dashboard/family-account", title: en ? "Account" : "我的", icon: UserRound },
  ];
  const selected = pathname.includes("registration") ? 2 : /schedule/.test(pathname) ? 1 : /account|finance/.test(pathname) ? 3 : 0;
  return <div className={styles.root}>
    <header className={styles.header}><Link href="/dashboard" className={styles.brand}><Sprout size={24} aria-hidden />{en ? "Gezhi" : "格致未来思维"}</Link><span className={styles.eyebrow}>{en ? "FOR FAMILIES" : "家长服务"}</span></header>
    <main className={styles.main}>{children}</main>
    <nav className={styles.nav} aria-label={en ? "Family navigation" : "家长导航"}><div className={styles.navInner}>{items.map((item, index) => <Link key={item.href} href={item.href} aria-current={selected === index ? "page" : undefined}><item.icon size={22} aria-hidden /><span>{item.title}</span></Link>)}</div></nav>
  </div>;
}
