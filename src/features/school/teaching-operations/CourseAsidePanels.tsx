import { AlertTriangle } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { CourseFamilyDetail } from "./course-family-detail";

/**
 * 课程页侧栏的只读摘要（doc 23 §8）。
 *
 * 这些数字原来散在两处：产品页底部一个"责任"面板，版本页顶部一张统计卡（还重复了
 * ObjectBar 已经说过的身份）。都在正文里，都要滚动才看得见，于是"这个产品到底齐不齐"
 * 这种决策前提反而排在教学计划后面。现在统一进 Aside——侧栏承担稳定摘要，
 * 主栏承担当前工作（§7.2）。
 *
 * 只读、无 action、不请求数据：全部来自已加载的 detail，因此可以是 Server Component。
 */

function SummaryCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-card p-4">
      <h2 className="text-sm font-medium text-ink">{title}</h2>
      {children}
    </section>
  );
}

function StatList({ items }: { items: readonly { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-xs text-muted">{item.label}</dt>
          <dd className="mt-0.5 text-lg font-medium tabular-nums text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** 产品摘要：整个 family 跨全部版本的规模与就绪度。 */
export async function CourseFamilySummary({ variants }: { variants: CourseFamilyDetail["variants"] }) {
  const t = await getTranslations("school.courses");
  const live = variants.filter((variant) => variant.trashedAt === null);
  const totals = live.reduce(
    (accumulator, variant) => ({
      lectures: accumulator.lectures + variant.lectureCount,
      released: accumulator.released + variant.releasedLectureCount,
      classrooms: accumulator.classrooms + variant.classroomCount,
    }),
    { lectures: 0, released: 0, classrooms: 0 },
  );

  return (
    <SummaryCard title={t("familySummary")}>
      <StatList
        items={[
          { label: t("variants"), value: live.length },
          { label: t("lectures"), value: totals.lectures },
          { label: t("publishedLectures"), value: totals.released },
          { label: t("usingClasses"), value: totals.classrooms },
        ]}
      />
    </SummaryCard>
  );
}

/**
 * 版本风险 / 缺失提示。风险在矩阵里只是一个 11px 的角标，这里把它展开成"哪个版本、
 * 缺什么、点进去",让侧栏回答"下一步该修哪一个"。
 */
export async function CourseFamilyRisks({
  familyId,
  variants,
}: {
  familyId: string;
  variants: CourseFamilyDetail["variants"];
}) {
  const t = await getTranslations("school.courses");
  const rows = variants
    .filter((variant) => variant.trashedAt === null)
    .map((variant) => {
      const missing = Math.max(0, variant.lectureCount - variant.releasedLectureCount);
      const reasons: string[] = [];
      if (variant.lectureCount === 0) reasons.push(t("riskNoLectures"));
      else if (missing > 0) reasons.push(t("riskIncompleteLectures", { count: missing }));
      if (variant.hasRisk) reasons.push(t("hasRisk"));
      return { variant, reasons };
    })
    .filter((row) => row.reasons.length > 0);

  return (
    <SummaryCard title={t("familyRisks")}>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{t("familyRisksNone")}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {rows.map(({ variant, reasons }) => (
            <li key={variant.id} className="flex items-start gap-2 text-sm">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" aria-hidden />
              <span className="min-w-0">
                <Link href={`/dashboard/courses/${familyId}?variant=${variant.id}`} className="text-ink hover:text-crater">
                  {variant.title}
                </Link>
                <span className="block text-xs text-muted">{reasons.join(" · ")}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </SummaryCard>
  );
}

/** 版本就绪度：讲次、已发布、未完成、页数。原来是版本页顶部统计卡的内容。 */
export async function CourseVariantReadiness({ readiness }: { readiness: CourseFamilyDetail["readiness"] }) {
  const t = await getTranslations("school.courses");
  const incomplete = Math.max(0, readiness.lectureCount - readiness.releasedLectureCount);

  return (
    <SummaryCard title={t("readiness")}>
      <StatList
        items={[
          { label: t("lectures"), value: readiness.lectureCount },
          { label: t("publishedLectures"), value: readiness.releasedLectureCount },
          { label: t("incompleteLectures"), value: incomplete },
          { label: t("pagesLabel"), value: readiness.pageCount },
        ]}
      />
      <p className="mt-3 text-xs text-muted">
        {incomplete === 0 && readiness.lectureCount > 0 ? t("readinessComplete") : t("readinessIssues", { count: incomplete })}
      </p>
    </SummaryCard>
  );
}
