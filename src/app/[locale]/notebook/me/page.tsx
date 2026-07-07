import { FilePlus2 } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireUser } from "@/lib/auth";

export default async function NotebookWorkspaceHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireUser(locale);
  const t = await getTranslations("notebook.workspace");
  return (
    <div className="grid min-h-full place-items-center px-6 py-16 text-center">
      <div className="max-w-sm"><FilePlus2 className="mx-auto text-muted" strokeWidth={1.5} /><h1 className="mt-5 font-display text-3xl">{t("welcomeTitle")}</h1><p className="mt-3 leading-7 text-muted">{t("welcomeDescription")}</p></div>
    </div>
  );
}
