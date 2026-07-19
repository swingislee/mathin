import { getTranslations } from "next-intl/server";
import { NotFoundActions } from "@/components/not-found-actions";
import { SiteHeader } from "@/components/site-header";
import { Star4 } from "@/components/star4";

/** 站点自维护的 404。已下线的地址（如 P4G-1 改名前的拼音概念 URL）会落到这里：
 *  路由层给真 404 状态码，页面给和站内一致的外壳与去处。 */
export default async function NotFound() {
  const t = await getTranslations("notFound");
  return (
    <main data-planet="geographer" className="flex min-h-screen flex-col">
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-6 pb-24 text-center">
        <Star4 size={20} />
        <p className="mt-6 font-serif text-sm tracking-widest text-[var(--p-accent)]">404</p>
        <h1 className="mt-3 font-display text-3xl md:text-4xl">{t("title")}</h1>
        <p className="mt-4 leading-7 text-muted">{t("description")}</p>
        <NotFoundActions />
      </div>
    </main>
  );
}
