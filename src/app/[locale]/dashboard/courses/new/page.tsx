import { getTranslations, setRequestLocale } from "next-intl/server";
import { listStaffOptions } from "@/features/school/classes";
import { DashboardContentGrid, DashboardMainColumn, DashboardPage } from "@/features/school/dashboard-page";
import { CourseProductWizard } from "@/features/school/teaching-operations/CourseProductWizard";
import { requirePerm } from "@/lib/auth";

// doc22 §5.15/§2.6：本轮唯一新增的创建路由。course.product.create 这枚权限键从 P4B
// 起就存在却一直没有消费方——课程工作区能在已有 Course Family 下建 Variant，却没有
// 从零建立课程产品的入口。这是那个缺口，不是为了目录对称补出来的 /new。
export default async function NewCourseProductPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePerm(locale, "course.product.create");

  const [t, tCourses, staffOptions] = await Promise.all([
    getTranslations("school.courseProduct"),
    getTranslations("school.courses"),
    listStaffOptions(),
  ]);

  return (
    <DashboardPage
      title={t("title")}
      backHref="/dashboard/courses"
      backLabel={tCourses("backToLibrary")}
      breadcrumbs={[{ label: tCourses("title"), href: "/dashboard/courses" }, { label: t("title") }]}
    >
      {/* 表单不铺满：主列限宽在页面内部解决，不靠页面根重新居中（doc21 §17.3）。 */}
      <DashboardContentGrid>
        <DashboardMainColumn>
          <CourseProductWizard staffOptions={staffOptions} />
        </DashboardMainColumn>
      </DashboardContentGrid>
    </DashboardPage>
  );
}
