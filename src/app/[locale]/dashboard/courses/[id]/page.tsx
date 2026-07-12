import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { CourseCrudPanel } from "@/features/school/CourseCrud";
import { COURSE_TERMS, getCourseDetail } from "@/features/school/courses";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import { Link } from "@/i18n/navigation";
import { getMyPerms, requirePerm } from "@/lib/auth";
import { cn } from "@/lib/utils";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CourseDetailPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const user = await requirePerm(locale, "course.view");
  if (!UUID_PATTERN.test(id)) notFound();

  const [t, course, perms] = await Promise.all([
    getTranslations("school.courses"),
    getCourseDetail(id),
    getMyPerms(user.id),
  ]);
  if (!course) notFound();
  const canEditTemplate = perms.has("courseware.template.edit");
  const canManage = perms.has("course.manage");
  const termKey = COURSE_TERMS.find((term) => term.value === course.term)?.labelKey ?? "summer";

  return (
    <div className="mx-auto w-full max-w-5xl">
      <SchoolPageHeader
        title={course.title}
        backHref="/dashboard/courses"
        backLabel={t("detailBack")}
        breadcrumbs={[{label:t("title"),href:"/dashboard/courses"},{label:course.title}]}
        actions={
          <Link href="/dashboard/courses" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
            {t("detailBack")}
          </Link>
        }
      >
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
          <span>
            {course.productCode ?? "-"} · {t("grade", { grade: course.grade })} · {t(termKey)} · {course.classType || "-"}
          </span>
          <span className="rounded-full bg-line/60 px-3 py-1 text-xs text-muted">{t(course.status)}</span>
        </div>
      </SchoolPageHeader>

      {canManage ? <CourseCrudPanel course={course} canEditTemplate={canEditTemplate} /> : <section className="mt-6 overflow-hidden rounded-xl border border-line bg-card">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="border-b border-line text-xs text-muted">
            <tr>
              <th className="w-20 px-4 py-3 font-medium">No.</th>
              <th className="px-4 py-3 font-medium">{t("lectures")}</th>
              <th className="px-4 py-3 font-medium">{t("objectives")}</th>
              <th className="w-28 px-4 py-3 font-medium">{t("templatePages")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {course.lectures.map((lecture) => (
              <tr key={lecture.id}>
                <td className="px-4 py-3 font-mono text-xs text-muted">{lecture.no}</td>
                <td className="px-4 py-3 font-medium">{lecture.name}</td>
                <td className="px-4 py-3 text-muted">{lecture.objectives || t("noObjectives")}</td>
                <td className="px-4 py-3 tabular-nums">
                  {canEditTemplate ? (
                    <Link
                      href={`/dashboard/courses/${course.id}/lectures/${lecture.id}`}
                      className="underline underline-offset-2 hover:text-ink"
                    >
                      {lecture.templatePageCount}
                    </Link>
                  ) : (
                    lecture.templatePageCount
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>}
    </div>
  );
}
