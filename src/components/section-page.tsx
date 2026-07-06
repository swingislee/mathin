import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { logout } from "@/app/[locale]/(auth)/actions";

export async function SectionPage({ section, locale, showLogout = false }: { section: "story" | "games" | "minds" | "terms" | "tools" | "dashboard" | "classroom" | "notebook" | "whiteboard"; locale?: string; showLogout?: boolean }) {
  const nav = await getTranslations("nav");
  const common = await getTranslations("common");
  return <main className="grid min-h-screen place-items-center p-6"><section className="w-full max-w-2xl rounded-[2rem] border bg-[var(--card)] p-8 shadow-sm md:p-12"><div className="mb-16 flex items-center justify-between"><Link href="/" className="inline-flex items-center gap-2 text-sm text-[var(--muted)]"><ArrowLeft size={16} />{common("backHome")}</Link>{showLogout && <form action={logout}><input type="hidden" name="locale" value={locale ?? "zh"} /><button className="rounded-full border px-4 py-2 text-sm" type="submit">{common("logout")}</button></form>}</div><h1 className="text-4xl font-semibold md:text-6xl">{nav(section)}</h1><p className="mt-5 text-[var(--muted)]">{common("comingSoon")}</p></section></main>;
}
