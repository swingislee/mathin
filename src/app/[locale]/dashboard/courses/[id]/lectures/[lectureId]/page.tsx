import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { CoursewareTemplateEditor } from "@/features/school/CoursewareTemplateEditor";
import { getLectureDetail } from "@/features/school/courses";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import { Link } from "@/i18n/navigation";
import { requirePerm } from "@/lib/auth";
import { cn } from "@/lib/utils";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function LectureTemplatePage({
  params,
}: {
  params: Promise<{ locale: string; id: string; lectureId: string }>;
}) {
  const { locale, id, lectureId } = await params;
  setRequestLocale(locale);
  await requirePerm(locale, "courseware.template.edit");
  if (!UUID_PATTERN.test(id) || !UUID_PATTERN.test(lectureId)) notFound();

  const [t, lecture] = await Promise.all([
    getTranslations("school.courseware"),
    getLectureDetail(lectureId),
  ]);
  if (!lecture || lecture.courseId !== id) notFound();

  return (
    <div className="mx-auto w-full max-w-4xl">
      <SchoolPageHeader
        eyebrow={lecture.courseTitle}
        title={`${t("lectureNo", { no: lecture.no })} · ${lecture.name}`}
        actions={
          <Link href={`/dashboard/courses/${id}`} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
            {t("backToCourse")}
          </Link>
        }
      />

      <section className="mt-6 rounded-xl border border-line bg-card p-5">
        <CoursewareTemplateEditor courseId={lecture.courseId} lectureId={lecture.id} initialPages={lecture.coursewareTemplate} />
      </section>
    </div>
  );
}
