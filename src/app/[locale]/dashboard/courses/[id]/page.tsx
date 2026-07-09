import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { COURSE_TERMS, getCourseDetail } from "@/features/school/courses";
import { Link } from "@/i18n/navigation";
import { requirePerm } from "@/lib/auth";
import { cn } from "@/lib/utils";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CourseDetailPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePerm(locale, "course.view");
  if (!UUID_PATTERN.test(id)) notFound();

  const [t, course] = await Promise.all([
    getTranslations("school.courses"),
    getCourseDetail(id),
  ]);
  if (!course) notFound();
  const termKey = COURSE_TERMS.find((term) => term.value === course.term)?.labelKey ?? "summer";

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <Link href="/dashboard/courses" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
        {t("detailBack")}
      </Link>

      <section className="mt-5 rounded-xl border border-line bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl">{course.title}</h1>
            <p className="mt-2 text-sm text-muted">
              {course.productCode ?? "-"} · {t("grade", { grade: course.grade })} · {t(termKey)} · {course.classType || "-"}
            </p>
          </div>
          <span className="rounded-full bg-line/60 px-3 py-1 text-xs text-muted">{t(course.status)}</span>
        </div>
      </section>

      <section className="mt-6 overflow-hidden rounded-xl border border-line bg-card">
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
                <td className="px-4 py-3 tabular-nums">{lecture.templatePageCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
