import { getTranslations, setRequestLocale } from "next-intl/server";
import { ClassBuildWizard } from "@/features/school/ClassBuildWizard";
import { listStaffOptions } from "@/features/school/classes";
import { listSchoolTerms } from "@/features/school/courses";
import { DashboardContentGrid, DashboardMainColumn, DashboardPage } from "@/features/school/dashboard-page";
import { getOrganizationTimezoneV2, getScheduleDefaultsV2, listActiveRoomOptionsV2 } from "@/features/school/organization-locations";
import { requirePerm } from "@/lib/auth";
import { getCourseMaterialOptions } from "@/features/school/class-material";
import { z } from "zod";

export default async function NewClassPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ courseId?: string | string[]; inheritMaterialFrom?: string | string[] }>;
}) {
  const { locale } = await params;
  const { courseId, inheritMaterialFrom } = await searchParams;
  setRequestLocale(locale);
  await requirePerm(locale, "class.create");

  const [t, tClasses, schoolTerms, teachers, roomOptions, scheduleDefaults, timeZone] = await Promise.all([
    getTranslations("school.classBuild"),
    getTranslations("school.classes"),
    listSchoolTerms(),
    listStaffOptions(),
    listActiveRoomOptionsV2(),
    getScheduleDefaultsV2(),
    getOrganizationTimezoneV2(),
  ]);
  const initialCourseId = typeof courseId === "string" ? courseId : undefined;
  const inheritance = z.string().uuid().safeParse(inheritMaterialFrom);
  const sourceId = inheritance.success ? inheritance.data : undefined;
  const materialOptions = await getCourseMaterialOptions("production", sourceId ?? null);

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
          <ClassBuildWizard
            schoolTerms={schoolTerms}
            teachers={teachers}
            roomOptions={roomOptions}
            defaultDurationMinutes={scheduleDefaults.defaultDurationMinutes}
            timeZone={timeZone}
            initialCourseId={initialCourseId}
            initialMaterialOptions={materialOptions}
            inheritMaterialFrom={sourceId}
          />
        </DashboardMainColumn>
      </DashboardContentGrid>
    </DashboardPage>
  );
}
