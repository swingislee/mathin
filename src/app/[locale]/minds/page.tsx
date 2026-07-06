import { getTranslations, setRequestLocale } from "next-intl/server";
import { SectionShell } from "@/components/section-shell";
import { Lamp } from "@/features/minds/lamp";
import { getMinds } from "@/lib/content";
import { Link } from "@/i18n/navigation";

export default async function MindsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("mindsSection");
  const minds = getMinds();
  return (
    <SectionShell section="minds" intro={t("intro")}>
      {/* 一条街道的灯：纵向单列（docs/plan/05-3.3） */}
      <div className="space-y-3">
        {minds.map((m) => (
          <Link key={m.slug} href={`/minds/${m.slug}`} className="group flex items-center gap-5 rounded-2xl border bg-card p-5 transition duration-200 hover:-translate-y-0.5">
            <Lamp slug={m.slug} litLabel={t("lit")} unlitLabel={t("unlit")} />
            <div>
              <p className="font-medium transition-colors duration-200 group-hover:text-ink">{m.title}</p>
              <p className="mt-1 text-sm leading-6 text-muted">{m.summary}</p>
            </div>
          </Link>
        ))}
      </div>
    </SectionShell>
  );
}
