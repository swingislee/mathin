import { getTranslations, setRequestLocale } from "next-intl/server";
import { CoursewareZeroReferenceReport } from "@/features/school/CoursewareZeroReferenceReport";
import { PurgeConfirmDialog } from "@/features/school/PurgeConfirmDialog";
import { purgeTestClassroomAction, purgeTestCourseFamilyAction } from "@/features/school/actions/testdata";
import { DashboardCard, DashboardPage } from "@/features/school/dashboard-page";
import { listPurgeableClassrooms, listPurgeableCourseFamilies, listZeroReferenceAssets } from "@/features/school/testdata";
import { requirePerm } from "@/lib/auth";

// doc22 §5.26：跨资源维护工具（测试数据清理、零引用素材、课程产品与班级清理、
// 级联影响与高危确认），不是 system-health 的子页面——两者只是同属"系统"导航组。
export default async function DataMaintenancePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePerm(locale, "testdata.purge");

  const [t, zeroReferenceAssets, purgeableFamilies, purgeableClassrooms] = await Promise.all([
    getTranslations("school.testdata"),
    listZeroReferenceAssets(),
    listPurgeableCourseFamilies(),
    listPurgeableClassrooms(),
  ]);

  return (
    <DashboardPage
      title={t("pageTitle")}
      summary={
        <p role="alert" className="rounded-xl border border-rose/30 bg-rose/5 px-4 py-3 text-sm text-rose">
          {t("pageIrreversibleNotice")}
        </p>
      }
    >
      {/* §22.4：说明与警告（summary）+ 两列普通操作 + 独立危险区。可清理清单是普通
          浏览内容，摆两列；不可逆的清除动作留在各自卡片内、不与浏览内容混排。 */}
      <div className="grid gap-6">
        <CoursewareZeroReferenceReport assets={zeroReferenceAssets} />

        <div className="grid gap-6 @4xl/page:grid-cols-2">
        <DashboardCard
          title={t("purgeableFamiliesTitle", { count: purgeableFamilies.length })}
          description={t("purgeableFamiliesHint")}
        >
          {purgeableFamilies.length === 0 ? (
            <p className="text-sm text-muted">{t("purgeableFamiliesEmpty")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {purgeableFamilies.map((family) => (
                <li key={family.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{family.title}</p>
                    <p className="text-xs text-muted">
                      {t("purgeableFamilyImpact", { variants: family.variantCount, lectures: family.lectureCount, releases: family.releaseCount })}
                    </p>
                  </div>
                  <PurgeConfirmDialog
                    objectName={family.title}
                    impactSummary={<p>{t("purgeableFamilyImpact", { variants: family.variantCount, lectures: family.lectureCount, releases: family.releaseCount })}</p>}
                    onConfirm={(confirmName) => purgeTestCourseFamilyAction(family.id, confirmName)}
                    triggerLabel={t("purgeAction")}
                  />
                </li>
              ))}
            </ul>
          )}
        </DashboardCard>

        <DashboardCard
          title={t("purgeableClassroomsTitle", { count: purgeableClassrooms.length })}
          description={t("purgeableClassroomsHint")}
        >
          {purgeableClassrooms.length === 0 ? (
            <p className="text-sm text-muted">{t("purgeableClassroomsEmpty")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {purgeableClassrooms.map((classroom) => (
                <li key={classroom.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{classroom.name}</p>
                    <p className="text-xs text-muted">
                      {t("purgeableClassroomImpact", { enrollments: classroom.enrollmentCount, sessions: classroom.sessionCount })}
                    </p>
                  </div>
                  <PurgeConfirmDialog
                    objectName={classroom.name}
                    impactSummary={<p>{t("purgeableClassroomImpact", { enrollments: classroom.enrollmentCount, sessions: classroom.sessionCount })}</p>}
                    onConfirm={(confirmName) => purgeTestClassroomAction(classroom.id, confirmName)}
                    triggerLabel={t("purgeAction")}
                  />
                </li>
              ))}
            </ul>
          )}
        </DashboardCard>
        </div>
      </div>
    </DashboardPage>
  );
}
