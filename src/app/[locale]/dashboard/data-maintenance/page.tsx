import { getTranslations, setRequestLocale } from "next-intl/server";
import { CoursewareZeroReferenceReport } from "@/features/school/CoursewareZeroReferenceReport";
import { DataQualityPanel } from "@/features/school/DataQualityPanel";
import { DataRepairPanel } from "@/features/school/DataRepairPanel";
import { PurgeConfirmDialog } from "@/features/school/PurgeConfirmDialog";
import { purgeTestClassroomAction, purgeTestCourseFamilyAction } from "@/features/school/actions/testdata";
import { getLatestDataQualityRun } from "@/features/school/data-quality";
import { listDataRepairCapabilities, listDataRepairPlans } from "@/features/school/data-repair";
import { DashboardCard, DashboardPage } from "@/features/school/dashboard-page";
import { listPurgeableClassrooms, listPurgeableCourseFamilies, listZeroReferenceAssets } from "@/features/school/testdata";
import { getMyPerms, requirePerm } from "@/lib/auth";

// R1-7：audit.view 可读取质量与修复账本；扫描/修复、零引用报告和永久清理继续按各自权限裁剪。
// 页面把检测和维护放在同一入口；修复只经显式预览计划执行，扫描本身不会自动改写业务数据。
export default async function DataMaintenancePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requirePerm(locale, "audit.view");
  const perms = await getMyPerms(user.id);
  const canRunQualityScan = perms.has("system.operations.manage");
  const canPurge = perms.has("testdata.purge");
  const canViewAssets = canPurge || perms.has("courseware.asset.manage");

  const [t, latestQualityRun, repairCapabilities, repairPlans, zeroReferenceAssets, purgeableFamilies, purgeableClassrooms] = await Promise.all([
    getTranslations("school.testdata"),
    getLatestDataQualityRun(),
    listDataRepairCapabilities(),
    listDataRepairPlans(),
    canViewAssets ? listZeroReferenceAssets() : Promise.resolve([]),
    canPurge ? listPurgeableCourseFamilies() : Promise.resolve([]),
    canPurge ? listPurgeableClassrooms() : Promise.resolve([]),
  ]);

  return (
    <DashboardPage
      title={t("pageTitle")}
      summary={(
        <div className="grid gap-2">
          <p className="rounded-xl border border-line bg-moon/10 px-4 py-3 text-sm text-muted">{t("qualityReadOnlyNotice")}</p>
          {canPurge ? (
            <p role="alert" className="rounded-xl border border-rose/30 bg-rose/5 px-4 py-3 text-sm text-rose">
              {t("pageIrreversibleNotice")}
            </p>
          ) : null}
        </div>
      )}
    >
      <div className="grid gap-6">
        <DataQualityPanel initialRun={latestQualityRun} canRun={canRunQualityScan} />
        <DataRepairPanel
          latestRun={latestQualityRun}
          initialCapabilities={repairCapabilities}
          initialPlans={repairPlans}
          canManage={canRunQualityScan}
        />

        {canViewAssets ? <CoursewareZeroReferenceReport assets={zeroReferenceAssets} /> : null}

        {canPurge ? (
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
        ) : null}
      </div>
    </DashboardPage>
  );
}