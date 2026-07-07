import { getTranslations, setRequestLocale } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { SectionShell } from "@/components/section-shell";

export default async function NotebookPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("notebook.public");
  return <SectionShell section="notebook" intro={t("intro")} wide><EmptyState message={t("empty")} /></SectionShell>;
}
