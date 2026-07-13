import { getTranslations, setRequestLocale } from "next-intl/server";
import { ClassBuildWizard } from "@/features/school/ClassBuildWizard";
import { listEnabledCoursesWithLectures, listStaffOptions } from "@/features/school/classes";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import { requirePerm } from "@/lib/auth";

export default async function NewClassPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePerm(locale, "class.create");

  const [t, tClasses, { courses, lecturesByCourse }, teachers] = await Promise.all([
    getTranslations("school.classBuild"),
    getTranslations("school.classes"),
    listEnabledCoursesWithLectures(),
    listStaffOptions(),
  ]);

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
        <ClassBuildWizard courses={courses} lecturesByCourse={lecturesByCourse} teachers={teachers} />
      </div>
    </div>
  );
}
