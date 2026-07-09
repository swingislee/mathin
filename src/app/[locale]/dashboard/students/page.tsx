import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { FOLLOW_UP_STATUSES, listStudents, parseStudentFilters, STUDENT_STATUSES } from "@/features/school/students";
import { Link } from "@/i18n/navigation";
import { requireAnyPerm } from "@/lib/auth";
import { cn } from "@/lib/utils";

export default async function StudentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, rawSearchParams] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  await requireAnyPerm(locale, ["student.view.all", "student.view.assigned"]);
  const t = await getTranslations("school.students");
  const filters = parseStudentFilters(rawSearchParams);
  const { students, count } = await listStudents(filters);
  const maxPage = count ? Math.max(1, Math.ceil(count / 20)) : filters.page;

  const pageHref = (page: number) => {
    const query = new URLSearchParams();
    if (filters.status) query.set("status", filters.status);
    if (filters.followUpStatus) query.set("followUpStatus", filters.followUpStatus);
    if (filters.grade) query.set("grade", String(filters.grade));
    if (filters.q) query.set("q", filters.q);
    if (page > 1) query.set("page", String(page));
    const qs = query.toString();
    return `/dashboard/students${qs ? `?${qs}` : ""}`;
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <h1 className="font-display text-2xl">{t("title")}</h1>
      <p className="mt-2 max-w-3xl text-sm text-muted">{t("intro")}</p>

      <form className="mt-6 grid gap-3 rounded-xl border border-line bg-card p-4 md:grid-cols-[1fr_150px_150px_140px_auto_auto]">
        <input
          name="q"
          defaultValue={filters.q}
          placeholder={t("search")}
          className="min-w-0 rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-crater"
        />
        <select name="status" defaultValue={filters.status ?? ""} className="rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-crater">
          <option value="">{t("allStatuses")}</option>
          {STUDENT_STATUSES.map((status) => <option key={status} value={status}>{t(status)}</option>)}
        </select>
        <select name="followUpStatus" defaultValue={filters.followUpStatus ?? ""} className="rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-crater">
          <option value="">{t("allFollowUps")}</option>
          {FOLLOW_UP_STATUSES.map((status) => <option key={status} value={status}>{t(status)}</option>)}
        </select>
        <select name="grade" defaultValue={filters.grade ?? ""} className="rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-crater">
          <option value="">{t("allGrades")}</option>
          {Array.from({ length: 9 }, (_, index) => index + 1).map((grade) => (
            <option key={grade} value={grade}>{t("grade", { grade })}</option>
          ))}
        </select>
        <button className={cn(buttonVariants({ size: "sm" }), "h-10")} type="submit">{t("filter")}</button>
        <Link href="/dashboard/students" className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "h-10")}>{t("reset")}</Link>
      </form>

      {students.length === 0 ? (
        <p className="mt-8 rounded-xl border border-line bg-card p-5 text-sm text-muted">{t("empty")}</p>
      ) : (
        <div className="mt-6 overflow-hidden rounded-xl border border-line bg-card">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="border-b border-line text-xs text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">{t("name")}</th>
                <th className="px-4 py-3 font-medium">{t("gradeCol")}</th>
                <th className="px-4 py-3 font-medium">{t("status")}</th>
                <th className="px-4 py-3 font-medium">{t("followUp")}</th>
                <th className="px-4 py-3 font-medium">{t("assignedTo")}</th>
                <th className="px-4 py-3 font-medium">{t("nextFollowUp")}</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {students.map((student) => (
                <tr key={student.id}>
                  <td className="px-4 py-3 font-medium">{student.name}</td>
                  <td className="px-4 py-3">{student.grade ? t("grade", { grade: student.grade }) : "-"}</td>
                  <td className="px-4 py-3">{t(student.status)}</td>
                  <td className="px-4 py-3">{t(student.followUpStatus)}</td>
                  <td className="px-4 py-3">{student.assignedName || t("none")}</td>
                  <td className="px-4 py-3 text-muted">
                    {student.nextFollowUpAt ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(student.nextFollowUpAt)) : "-"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/dashboard/students/${student.id}`} className="text-xs text-muted underline underline-offset-2 hover:text-ink">
                      {t("open")}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        {filters.page > 1 && <Link href={pageHref(filters.page - 1)} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>{t("previous")}</Link>}
        {filters.page < maxPage && <Link href={pageHref(filters.page + 1)} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>{t("next")}</Link>}
      </div>
    </main>
  );
}
