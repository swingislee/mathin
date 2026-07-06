import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { Link } from "@/i18n/navigation";
import { LocaleSwitcher } from "./locale-switcher";
import { ThemeToggle } from "./theme-toggle";
import { UtilitySheet } from "./utility-sheet";

const publicRoutes = ["story", "games", "minds", "terms", "tools"] as const;

export async function SiteHeader() {
  const nav = await getTranslations("nav");
  const savedTheme = (await cookies()).get("mathin-theme")?.value;
  const theme = savedTheme === "light" || savedTheme === "dark" ? savedTheme : "system";
  return <header className="flex items-start justify-between gap-6 px-5 py-5 md:px-10 md:py-8"><Link href="/" className="text-3xl font-semibold tracking-tight md:text-5xl">Mathin</Link><div className="flex items-center gap-2"><nav className="mr-2 hidden items-center gap-5 lg:flex">{publicRoutes.map((route) => <Link key={route} href={`/${route}`} className="text-sm text-[var(--muted)] transition hover:text-[var(--foreground)]">{nav(route)}</Link>)}</nav><LocaleSwitcher /><ThemeToggle initialTheme={theme} /><UtilitySheet /></div></header>;
}
