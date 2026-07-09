import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { SectionShell } from "@/components/section-shell";
import { getMyProfileRole, listMyClassrooms } from "@/features/classroom/actions";
import { CreateClassroomButton, JoinClassroomForm } from "@/features/classroom/ListActions";
import { Link } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth";

export default async function ClassroomListPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireUser(locale);
  const [t, format, classrooms, profileRole] = await Promise.all([
    getTranslations("classroom.list"),
    getFormatter(),
    listMyClassrooms(),
    getMyProfileRole(),
  ]);
  const isTeacher = profileRole === "staff" || profileRole === "admin";
  return (
    <SectionShell section="classroom" intro={t("intro")} wide>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <JoinClassroomForm />
        {isTeacher && <CreateClassroomButton />}
      </div>
      {classrooms.length === 0 ? (
        <EmptyState message={t("empty")} />
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {classrooms.map((classroom) => (
            <li key={classroom.id} className="group relative rounded-2xl border border-line p-5 transition-colors hover:border-crater">
              <Link href={`/classroom/${classroom.id}`} className="block">
                <span className="absolute inset-0" aria-hidden />
                <div className="flex items-center gap-2">
                  <h2 className="min-w-0 flex-1 truncate font-medium">{classroom.name || t("untitled")}</h2>
                  <span className="shrink-0 rounded-full bg-moon/50 px-2 py-0.5 text-xs text-ink">
                    {classroom.myRole === "teacher" ? t("teaching") : t("studying")}
                  </span>
                </div>
                <p className="mt-2 text-xs text-muted">
                  {t("createdAt", { date: format.dateTime(new Date(classroom.createdAt), { dateStyle: "medium" }) })}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionShell>
  );
}
