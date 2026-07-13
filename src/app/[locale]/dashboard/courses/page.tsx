import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { CourseCreateDialog } from "@/features/school/CourseCrud";
import { toSelectValue } from "@/features/school/controls";
import { COURSE_TERMS, listCourses, listSchoolTerms, parseCourseFilters } from "@/features/school/courses";
import { TermManager } from "@/features/school/TermManager";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import { Link } from "@/i18n/navigation";
import { getMyPerms, requirePerm } from "@/lib/auth";
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
  const user = await requirePerm(locale, "course.view");
  const t = await getTranslations("school.courses");
  const filters = parseCourseFilters(rawSearchParams);
  const [{ courses, count }, perms, schoolTerms] = await Promise.all([listCourses(filters), getMyPerms(user.id),listSchoolTerms()]);
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
      <SchoolPageHeader title={t("title")} actions={perms.has("course.manage") ? <CourseCreateDialog /> : undefined}>
        <p className="mt-1 max-w-3xl text-sm text-muted">{t("intro")}</p>
      </SchoolPageHeader>
      {perms.has("course.manage")&&<TermManager terms={schoolTerms}/>}

      <form className="mt-6 grid gap-3 rounded-xl border border-line bg-card p-4 md:grid-cols-[1fr_140px_140px_140px_140px_auto_auto]">
        <Input
          name="q"
          defaultValue={filters.q}
          placeholder={t("search")}
          className="min-w-0"
        />
        <Select name="grade" defaultValue={toSelectValue(String(filters.grade ?? ""))}>
          <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={toSelectValue("")}>{t("allGrades")}</SelectItem>
            {Array.from({ length: 9 }, (_, index) => index + 1).map((grade) => (
              <SelectItem key={grade} value={String(grade)}>{t("grade", { grade })}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select name="term" defaultValue={toSelectValue(String(filters.term ?? ""))}>
          <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={toSelectValue("")}>{t("allTerms")}</SelectItem>
            {COURSE_TERMS.map((term) => (
              <SelectItem key={term.value} value={String(term.value)}>{t(term.labelKey)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select name="classType" defaultValue={toSelectValue(filters.classType ?? "")}>
          <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={toSelectValue("")}>{t("allTypes")}</SelectItem>
            {["A", "B", "S"].map((type) => (
              <SelectItem key={type} value={type}>{type}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select name="status" defaultValue={toSelectValue(filters.status ?? "")}>
          <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={toSelectValue("")}>{t("allStatuses")}</SelectItem>
            <SelectItem value="enabled">{t("enabled")}</SelectItem>
            <SelectItem value="disabled">{t("disabled")}</SelectItem>
          </SelectContent>
        </Select>
        <button className={cn(buttonVariants({ size: "sm" }), "h-10")} type="submit">{t("filter")}</button>
        <Link href="/dashboard/courses" className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "h-10")}>{t("reset")}</Link>
      </form>

      {courses.length === 0 ? (
        <p className="mt-8 rounded-xl border border-line bg-card p-5 text-sm text-muted">{t("empty")}</p>
      ) : (
        <div className="mt-6 overflow-hidden rounded-xl border border-line bg-card">
          <Table className="w-full border-collapse text-left text-sm">
            <TableHeader className="border-b border-line text-xs text-muted">
              <TableRow>
                <TableHead className="px-4 py-3 font-medium">{t("title")}</TableHead>
                <TableHead className="px-4 py-3 font-medium">{t("productCode")}</TableHead>
                <TableHead className="px-4 py-3 font-medium">{t("term")}</TableHead>
                <TableHead className="px-4 py-3 font-medium">{t("classType")}</TableHead>
                <TableHead className="px-4 py-3 font-medium">{t("lectures")}</TableHead>
                <TableHead className="px-4 py-3 font-medium">{t("status")}</TableHead>
                <TableHead className="px-4 py-3 font-medium"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-line">
              {courses.map((course) => (
                <TableRow key={course.id}>
                  <TableCell className="px-4 py-3 font-medium">{course.title}</TableCell>
                  <TableCell className="px-4 py-3 font-mono text-xs text-muted">{course.productCode ?? "-"}</TableCell>
                  <TableCell className="px-4 py-3">{t("grade", { grade: course.grade })} · {t(COURSE_TERMS.find((term) => term.value === course.term)?.labelKey ?? "summer")}</TableCell>
                  <TableCell className="px-4 py-3">{course.classType || "-"}</TableCell>
                  <TableCell className="px-4 py-3 tabular-nums">{course.lectureCount}</TableCell>
                  <TableCell className="px-4 py-3">{t(course.status)}</TableCell>
                  <TableCell className="px-4 py-3 text-right">
                    <Link href={`/dashboard/courses/${course.id}`} className="text-xs text-muted underline underline-offset-2 hover:text-ink">
                      {t("open")}
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
