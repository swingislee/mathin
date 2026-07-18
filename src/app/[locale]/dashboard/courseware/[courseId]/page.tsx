import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import { COURSEWARE_STUDIO_PERMS, loadCoursewareLectures } from "@/features/courseware-studio/data";
import { Link } from "@/i18n/navigation";
import { requireAnyPerm } from "@/lib/auth";

export default async function CoursewareLecturesPage({
  params,
}: {
  params: Promise<{ locale: string; courseId: string }>;
}) {
  const { locale, courseId } = await params;
  setRequestLocale(locale);
  await requireAnyPerm(locale, COURSEWARE_STUDIO_PERMS);
  const t = await getTranslations("coursewareStudio");
  const data = await loadCoursewareLectures(courseId);
  if (!data) notFound();

  return (
    <div className="mx-auto w-full max-w-6xl">
      <SchoolPageHeader title={data.course.title}>
        <p className="mt-1 text-sm text-muted">
          {data.course.product_code ?? "-"} · {t("lectureCount", { count: data.lectures.length })}
        </p>
      </SchoolPageHeader>
      <p className="mt-3">
        <Link href="/dashboard/courseware" className="text-xs text-muted underline underline-offset-2 hover:text-ink">
          {t("backToCourses")}
        </Link>
      </p>

      {data.lectures.length === 0 ? (
        <p className="mt-8 rounded-xl border border-line bg-card p-5 text-sm text-muted">{t("empty")}</p>
      ) : (
        <div className="mt-6 overflow-hidden rounded-xl border border-line bg-card">
          <Table className="w-full border-collapse text-left text-sm">
            <TableHeader className="border-b border-line text-xs text-muted">
              <TableRow>
                <TableHead className="px-4 py-3 font-medium">{t("lectureNo")}</TableHead>
                <TableHead className="px-4 py-3 font-medium">{t("lectureName")}</TableHead>
                <TableHead className="px-4 py-3 font-medium">{t("pages")}</TableHead>
                <TableHead className="px-4 py-3 font-medium">{t("release")}</TableHead>
                <TableHead className="px-4 py-3 font-medium"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-line">
              {data.lectures.map((lecture) => (
                <TableRow key={lecture.id}>
                  <TableCell className="px-4 py-3 tabular-nums">{lecture.no}</TableCell>
                  <TableCell className="px-4 py-3 font-medium">{lecture.name}</TableCell>
                  <TableCell className="px-4 py-3 tabular-nums">{lecture.pageCount}</TableCell>
                  <TableCell className="px-4 py-3">
                    {lecture.released ? (
                      <Badge variant="secondary">{t("releaseNo", { no: lecture.releaseNo ?? 0 })}</Badge>
                    ) : (
                      <span className="text-xs text-muted">{t("notReleased")}</span>
                    )}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-right">
                    <span className="inline-flex items-center gap-3">
                      {lecture.released ? (
                        <Link
                          href={`/dashboard/courseware/${courseId}/${lecture.id}`}
                          className="text-xs text-muted underline underline-offset-2 hover:text-ink"
                        >
                          {t("preview")}
                        </Link>
                      ) : null}
                      <Link
                        href={`/dashboard/courses/${courseId}/lectures/${lecture.id}`}
                        className="text-xs text-muted underline underline-offset-2 hover:text-ink"
                      >
                        {t("templateEditor")}
                      </Link>
                    </span>
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
