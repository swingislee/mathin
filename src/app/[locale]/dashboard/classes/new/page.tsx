import { getTranslations, setRequestLocale } from "next-intl/server";
import { ClassBuildWizard } from "@/features/school/ClassBuildWizard";
import { listStaffOptions } from "@/features/school/classes";
import { listSchoolTerms } from "@/features/school/courses";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import { requirePerm } from "@/lib/auth";

export default async function NewClassPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ courseId?: string | string[] }>;
}) {
  const { locale } = await params;
  const { courseId } = await searchParams;
  setRequestLocale(locale);
  await requirePerm(locale, "class.create");

  const [t, tClasses, schoolTerms, teachers] = await Promise.all([
    getTranslations("school.classBuild"),
    getTranslations("school.classes"),
    listSchoolTerms(),
    listStaffOptions(),
  ]);
  const initialCourseId = typeof courseId === "string" ? courseId : undefined;

  return (
    <div className="mx-auto w-full max-w-4xl">
      <SchoolPageHeader
        title={t("title")}
        backHref="/dashboard/classes"
        backLabel={t("back")}
        breadcrumbs={[{ label: tClasses("title"), href: "/dashboard/classes" }, { label: t("title") }]}
      >
        <p className="mt-1 max-w-2xl text-sm text-muted">{t("intro")}</p>
      </SchoolPageHeader>

      <div className="mt-6">
        <ClassBuildWizard schoolTerms={schoolTerms} teachers={teachers} initialCourseId={initialCourseId} />
      </div>
    </div>
  );
}
