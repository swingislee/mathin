import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { SiteHeader } from "@/components/site-header";

export default async function HomePage() {
  const t = await getTranslations("home");
  return <main className="min-h-screen overflow-hidden"><SiteHeader /><section className="mx-auto grid min-h-[calc(100vh-120px)] max-w-7xl place-items-center px-6 pb-10"><div className="relative flex w-full max-w-3xl flex-col items-center text-center"><p className="mb-3 text-sm uppercase tracking-[0.28em] text-[var(--muted)]">{t("eyebrow")}</p><p className="max-w-xl text-sm leading-7 text-[var(--muted)] md:text-base">{t("description")}</p><Image src="/Main.png" alt="小王子坐在月球上观察玫瑰" width={1521} height={1521} priority className="mt-1 h-auto w-full max-w-[680px] object-contain dark:brightness-90" /></div></section></main>;
}
