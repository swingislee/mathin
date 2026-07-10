import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { selectClass } from "@/features/school/controls";
import { COURSE_TERMS, listCourses, parseCourseFilters } from "@/features/school/courses";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import { Link } from "@/i18n/navigation";
import { requirePerm } from "@/lib/auth";
import { cn } from "@/lib/utils";

export default async function CoursesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, rawSearchParams] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  await requirePerm(locale, "course.view");
  const t = await getTranslations("school.courses");
  const filters = parseCourseFilters(rawSearchParams);
  const { courses, count } = await listCourses(filters);
  const maxPage = count ? Math.max(1, Math.ceil(count / 20)) : filters.page;

  const pageHref = (page: number) => {
    const query = new URLSearchParams();
    if (filters.grade) query.set("grade", String(filters.grade));
    if (filters.term) query.set("term", String(filters.term));
    if (filters.classType) query.set("classType", filters.classType);
    if (filters.status) query.set("status", filters.status);
    if (filters.q) query.set("q", filters.q);
    if (page > 1) query.set("page", String(page));
    const qs = query.toString();
    return `/dashboard/courses${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="mx-auto w-full max-w-6xl">
      <SchoolPageHeader title={t("title")}>
        <p className="mt-1 max-w-3xl text-sm text-muted">{t("intro")}</p>
      </SchoolPageHeader>

      <form className="mt-6 grid gap-3 rounded-xl border border-line bg-card p-4 md:grid-cols-[1fr_140px_140px_140px_140px_auto_auto]">
        <input
          name="q"
          defaultValue={filters.q}
          placeholder={t("search")}
          className="min-w-0 rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-crater"
        />
        <select name="grade" defaultValue={filters.grade ?? ""} className={selectClass}>
          <option value="">{t("allGrades")}</option>
          {Array.from({ length: 6 }, (_, index) => index + 1).map((grade) => (
            <option key={grade} value={grade}>{t("grade", { grade })}</option>
          ))}
        </select>
        <select name="term" defaultValue={filters.term ?? ""} className={selectClass}>
          <option value="">{t("allTerms")}</option>
          {COURSE_TERMS.map((term) => (
            <option key={term.value} value={term.value}>{t(term.labelKey)}</option>
          ))}
        </select>
        <select name="classType" defaultValue={filters.classType ?? ""} className={selectClass}>
          <option value="">{t("allTypes")}</option>
          {["A", "B", "S"].map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
        <select name="status" defaultValue={filters.status ?? ""} className={selectClass}>
          <option value="">{t("allStatuses")}</option>
          <option value="enabled">{t("enabled")}</option>
          <option value="disabled">{t("disabled")}</option>
        </select>
        <button className={cn(buttonVariants({ size: "sm" }), "h-10")} type="submit">{t("filter")}</button>
        <Link href="/dashboard/courses" className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "h-10")}>{t("reset")}</Link>
      </form>

      {courses.length === 0 ? (
        <p className="mt-8 rounded-xl border border-line bg-card p-5 text-sm text-muted">{t("empty")}</p>
      ) : (
        <div className="mt-6 overflow-hidden rounded-xl border border-line bg-card">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="border-b border-line text-xs text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">{t("title")}</th>
                <th className="px-4 py-3 font-medium">{t("productCode")}</th>
                <th className="px-4 py-3 font-medium">{t("term")}</th>
                <th className="px-4 py-3 font-medium">{t("classType")}</th>
                <th className="px-4 py-3 font-medium">{t("lectures")}</th>
                <th className="px-4 py-3 font-medium">{t("status")}</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {courses.map((course) => (
                <tr key={course.id}>
                  <td className="px-4 py-3 font-medium">{course.title}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">{course.productCode ?? "-"}</td>
                  <td className="px-4 py-3">{t("grade", { grade: course.grade })} · {t(COURSE_TERMS.find((term) => term.value === course.term)?.labelKey ?? "summer")}</td>
                  <td className="px-4 py-3">{course.classType || "-"}</td>
                  <td className="px-4 py-3 tabular-nums">{course.lectureCount}</td>
                  <td className="px-4 py-3">{t(course.status)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/dashboard/courses/${course.id}`} className="text-xs text-muted underline underline-offset-2 hover:text-ink">
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
        {filters.page > 1 && (
          <Link href={pageHref(filters.page - 1)} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>{t("previous")}</Link>
        )}
        {filters.page < maxPage && (
          <Link href={pageHref(filters.page + 1)} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>{t("next")}</Link>
        )}
      </div>
    </div>
  );
}
