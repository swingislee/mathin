import { getTranslations, setRequestLocale } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { ClassBuildWizard } from "@/features/school/ClassBuildWizard";
import { listEnabledCoursesWithLectures, listStaffOptions } from "@/features/school/classes";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import { Link } from "@/i18n/navigation";
import { requirePerm } from "@/lib/auth";
import { cn } from "@/lib/utils";

export default async function NewClassPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePerm(locale, "class.create");

  const [t, { courses, lecturesByCourse }, teachers] = await Promise.all([
    getTranslations("school.classBuild"),
    listEnabledCoursesWithLectures(),
    listStaffOptions(),
  ]);

  return (
    <div className="mx-auto w-full max-w-4xl">
      <SchoolPageHeader
        title={t("title")}
        actions={
          <Link href="/dashboard/classes" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
            {t("back")}
          </Link>
        }
      >
        <p className="mt-1 max-w-2xl text-sm text-muted">{t("intro")}</p>
      </SchoolPageHeader>

      <div className="mt-6">
        <ClassBuildWizard courses={courses} lecturesByCourse={lecturesByCourse} teachers={teachers} />
      </div>
    </div>
  );
}
