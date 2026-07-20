import { getTranslations, setRequestLocale } from "next-intl/server";
import { CoursewareZeroReferenceReport } from "@/features/school/CoursewareZeroReferenceReport";
import { PurgeConfirmDialog } from "@/features/school/PurgeConfirmDialog";
import { purgeTestClassroomAction, purgeTestCourseFamilyAction } from "@/features/school/actions/testdata";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import { listPurgeableClassrooms, listPurgeableCourseFamilies, listZeroReferenceAssets } from "@/features/school/testdata";
import { requirePerm } from "@/lib/auth";

export default async function TestDataCleanupPage({ params }: { params: Promise<{ locale: string }> }) {
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
    <div className="mx-auto w-full max-w-5xl">
      <SchoolPageHeader title={t("pageTitle")}>
        <p className="mt-1 max-w-2xl text-sm text-rose">{t("pageIrreversibleNotice")}</p>
      </SchoolPageHeader>

      <div className="mt-6 grid gap-6">
        <CoursewareZeroReferenceReport assets={zeroReferenceAssets} />

        <section className="rounded-2xl border border-line bg-card p-5">
          <h2 className="font-medium text-ink">{t("purgeableFamiliesTitle", { count: purgeableFamilies.length })}</h2>
          <p className="mt-1 text-sm text-muted">{t("purgeableFamiliesHint")}</p>
          {purgeableFamilies.length === 0 ? (
            <p className="mt-4 text-sm text-muted">{t("purgeableFamiliesEmpty")}</p>
          ) : (
            <ul className="mt-4 divide-y divide-line">
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
        </section>

        <section className="rounded-2xl border border-line bg-card p-5">
          <h2 className="font-medium text-ink">{t("purgeableClassroomsTitle", { count: purgeableClassrooms.length })}</h2>
          <p className="mt-1 text-sm text-muted">{t("purgeableClassroomsHint")}</p>
          {purgeableClassrooms.length === 0 ? (
            <p className="mt-4 text-sm text-muted">{t("purgeableClassroomsEmpty")}</p>
          ) : (
            <ul className="mt-4 divide-y divide-line">
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
        </section>
      </div>
    </div>
  );
}
