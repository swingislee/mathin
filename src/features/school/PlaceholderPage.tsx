import { getTranslations } from "next-intl/server";
import { SectionShell } from "@/components/section-shell";

export async function SchoolPlaceholderPage({ labelKey }: { labelKey: string }) {
  const t = await getTranslations("school");
  return (
    <SectionShell section="dashboard" wide>
      <section className="rounded-2xl border bg-card p-5">
        <h1 className="font-display text-2xl">{t(`nav.${labelKey}`)}</h1>
        <p className="mt-3 text-sm text-muted">{t("home.staffIntro")}</p>
      </section>
    </SectionShell>
  );
}
