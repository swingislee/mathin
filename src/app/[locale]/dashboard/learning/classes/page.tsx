import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { JoinClassroomForm } from "@/features/classroom/ListActions";
import { listMyClassrooms } from "@/features/classroom/actions";
import {
  DashboardCard,
  DashboardContentGrid,
  DashboardMainColumn,
  DashboardPage,
} from "@/features/school/dashboard-page";
import { Link } from "@/i18n/navigation";
import { requireDashboardEnvironment } from "@/lib/auth";

export default async function LearningClassesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireDashboardEnvironment(locale, ["learning"]);
  const [t, format, classrooms] = await Promise.all([
    getTranslations("classroom.list"),
    getFormatter(),
    listMyClassrooms(),
  ]);

  return (
    <DashboardPage title={t("title")} description={t("intro")} summary={<JoinClassroomForm />}>
      <DashboardContentGrid>
        <DashboardMainColumn>
          {classrooms.length === 0 ? (
            <DashboardCard>
              <p className="text-sm text-muted">{t("empty")}</p>
            </DashboardCard>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {classrooms.map((classroom) => (
                <li key={classroom.id}>
                  <Link href={"/dashboard/learning/classes/" + classroom.id} className="block h-full">
                    <DashboardCard className="h-full transition-colors hover:border-crater">
                      <div className="flex items-center gap-2">
                        <h2 className="min-w-0 flex-1 truncate text-base font-medium">{classroom.name || t("untitled")}</h2>
                        <span className="shrink-0 rounded-full bg-moon/50 px-2 py-0.5 text-xs text-ink">
                          {t("studying")}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-muted">
                        {t("createdAt", { date: format.dateTime(new Date(classroom.createdAt), { dateStyle: "medium" }) })}
                      </p>
                    </DashboardCard>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </DashboardMainColumn>
      </DashboardContentGrid>
    </DashboardPage>
  );
}