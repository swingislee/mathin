import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { getStudentDetail } from "@/features/school/students";
import { Link } from "@/i18n/navigation";
import { requireAnyPerm } from "@/lib/auth";
import { cn } from "@/lib/utils";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function StudentDetailPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireAnyPerm(locale, ["student.view.all", "student.view.assigned"]);
  if (!UUID_PATTERN.test(id)) notFound();

  const [t, student] = await Promise.all([
    getTranslations("school.students"),
    getStudentDetail(id),
  ]);
  if (!student) notFound();

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <Link href="/dashboard/students" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
        {t("back")}
      </Link>

      <section className="mt-5 rounded-xl border border-line bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl">{student.name}</h1>
            <p className="mt-2 text-sm text-muted">
              {student.grade ? t("grade", { grade: student.grade }) : "-"} · {t(student.status)} · {t(student.followUpStatus)}
            </p>
          </div>
          <span className="rounded-full bg-line/60 px-3 py-1 font-mono text-xs text-muted">{student.bindCode}</span>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1fr]">
        <section className="rounded-xl border border-line bg-card p-5">
          <h2 className="font-medium">{t("profile")}</h2>
          <dl className="mt-4 grid gap-3 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-muted">{t("gradeCol")}</dt><dd>{student.grade ? t("grade", { grade: student.grade }) : "-"}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">{t("contact")}</dt><dd>{student.phone || student.wechat || "-"}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">{t("assignedTo")}</dt><dd>{student.assignedName || t("none")}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">{t("bindCode")}</dt><dd className="font-mono">{student.bindCode}</dd></div>
          </dl>
          {student.remark && <p className="mt-4 rounded-lg bg-background p-3 text-sm text-muted">{student.remark}</p>}
        </section>

        <section className="rounded-xl border border-line bg-card p-5">
          <h2 className="font-medium">{t("guardian")}</h2>
          <dl className="mt-4 grid gap-3 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-muted">{t("name")}</dt><dd>{student.parentName || "-"}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">{t("contact")}</dt><dd>{student.parentPhone || "-"}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">{t("status")}</dt><dd>{student.parentRelation || "-"}</dd></div>
          </dl>
        </section>
      </div>

      <section className="mt-6 rounded-xl border border-line bg-card p-5">
        <h2 className="font-medium">{t("followUps")}</h2>
        {student.followUps.length === 0 ? (
          <p className="mt-4 text-sm text-muted">{t("noFollowUps")}</p>
        ) : (
          <ol className="mt-4 divide-y divide-line">
            {student.followUps.map((followUp) => (
              <li key={followUp.id} className="py-4 text-sm">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span>{followUp.authorName || t("none")}</span>
                  <span>{followUp.kind}</span>
                  <time>{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(followUp.createdAt))}</time>
                </div>
                <p className="mt-2 whitespace-pre-wrap">{followUp.content}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
