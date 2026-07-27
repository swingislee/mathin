import { getTranslations, setRequestLocale } from "next-intl/server";
import { ClassBuildWizard } from "@/features/school/ClassBuildWizard";
import { listStaffOptions } from "@/features/school/classes";
import { listSchoolTerms } from "@/features/school/courses";
import { DashboardContentGrid, DashboardMainColumn, DashboardPage } from "@/features/school/dashboard-page";
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
    <DashboardPage
      title={t("title")}
      backHref="/dashboard/classes"
      backLabel={t("back")}
      breadcrumbs={[{ label: tClasses("title"), href: "/dashboard/classes" }, { label: t("title") }]}
    >
      {/* 表单不铺满：主列限宽在页面内部解决，不靠页面根重新居中（§17.3）。 */}
      <DashboardContentGrid>
        <DashboardMainColumn>
          <ClassBuildWizard schoolTerms={schoolTerms} teachers={teachers} initialCourseId={initialCourseId} />
        </DashboardMainColumn>
      </DashboardContentGrid>
    </DashboardPage>
  );
}
