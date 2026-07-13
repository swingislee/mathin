import { getTranslations, setRequestLocale } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { ImportStudentsPanel } from "@/features/school/ImportStudentsPanel";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import { Link } from "@/i18n/navigation";
import { requirePerm } from "@/lib/auth";
import { cn } from "@/lib/utils";

export default async function ImportStudentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePerm(locale, "student.import");
  const t = await getTranslations("school.students");

  return (
    <div className="mx-auto w-full max-w-6xl">
      <SchoolPageHeader
        title={t("importTitle")}
        actions={<Link href="/dashboard/students" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>{t("back")}</Link>}
      >
        <p className="mt-1 max-w-3xl text-sm text-muted">{t("importIntro")}</p>
      </SchoolPageHeader>
      <ImportStudentsPanel />
    </div>
  );
}
