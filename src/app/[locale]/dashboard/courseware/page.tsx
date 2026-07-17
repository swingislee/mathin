import { getTranslations, setRequestLocale } from "next-intl/server";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import { COURSEWARE_STUDIO_PERMS, loadCoursewareCourses } from "@/features/courseware-studio/data";
import { Link } from "@/i18n/navigation";
import { requireAnyPerm } from "@/lib/auth";

export default async function CoursewareCoursesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAnyPerm(locale, COURSEWARE_STUDIO_PERMS);
  const t = await getTranslations("coursewareStudio");
  const courses = await loadCoursewareCourses();

  return (
    <div className="mx-auto w-full max-w-6xl">
      <SchoolPageHeader title={t("title")}>
        <p className="mt-1 max-w-3xl text-sm text-muted">{t("intro")}</p>
      </SchoolPageHeader>

      {courses.length === 0 ? (
        <p className="mt-8 rounded-xl border border-line bg-card p-5 text-sm text-muted">{t("empty")}</p>
      ) : (
        <div className="mt-6 overflow-hidden rounded-xl border border-line bg-card">
          <Table className="w-full border-collapse text-left text-sm">
            <TableHeader className="border-b border-line text-xs text-muted">
              <TableRow>
                <TableHead className="px-4 py-3 font-medium">{t("course")}</TableHead>
                <TableHead className="px-4 py-3 font-medium">{t("productCode")}</TableHead>
                <TableHead className="px-4 py-3 font-medium">{t("lectures")}</TableHead>
                <TableHead className="px-4 py-3 font-medium">{t("releasedLectures")}</TableHead>
                <TableHead className="px-4 py-3 font-medium"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-line">
              {courses.map((course) => (
                <TableRow key={course.id}>
                  <TableCell className="px-4 py-3 font-medium">{course.title}</TableCell>
                  <TableCell className="px-4 py-3 font-mono text-xs text-muted">{course.productCode ?? "-"}</TableCell>
                  <TableCell className="px-4 py-3 tabular-nums">{course.lectureCount}</TableCell>
                  <TableCell className="px-4 py-3 tabular-nums">{course.releasedCount}</TableCell>
                  <TableCell className="px-4 py-3 text-right">
                    <Link
                      href={`/dashboard/courseware/${course.id}`}
                      className="text-xs text-muted underline underline-offset-2 hover:text-ink"
                    >
                      {t("open")}
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
