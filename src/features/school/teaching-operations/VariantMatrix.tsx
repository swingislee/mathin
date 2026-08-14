"use client";

import { AlertTriangle, Plus } from "lucide-react";
import { Fragment, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DashboardEmptyCard } from "@/features/school/dashboard-page";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { CreateVariantDialog } from "./CreateVariantDialog";
import type { CourseFamilyDetail } from "./course-family-detail";
import { compareCourseDifficulty } from "./course-difficulty";
import { COURSE_SEASONS, type CourseSeason } from "./types";

type Variant = CourseFamilyDetail["variants"][number];
type CatalogVersion = CourseFamilyDetail["catalogVersions"][number];

function statusTone(variant: Variant) {
  if (variant.status === "enabled") return "border-crater/30 bg-crater/10 text-ink";
  if (variant.status === "draft") return "border-dashed border-line text-muted";
  return "border-line bg-moon/30 text-muted opacity-60";
}

function VariantBadge({ familyId, variant }: { familyId: string; variant: Variant }) {
  const t = useTranslations("school.courses");
  return <Link
    href={`/dashboard/courses/${familyId}?variant=${variant.id}`}
    className={cn("relative flex min-w-[3.25rem] flex-col items-center rounded-lg border px-2 py-1 text-xs transition hover:border-crater", statusTone(variant))}
  >
    {variant.hasRisk && <AlertTriangle size={11} className="absolute -right-1 -top-1 text-amber-700 dark:text-amber-300" aria-label={t("hasRisk")} />}
    <span className="font-medium">{variant.classType || t("defaultClassType")}</span>
    {variant.supersededByCourseId && <span className="text-[10px] text-muted">{t("supersededShort")}</span>}
    <span className="tabular-nums text-[10px] text-muted">{variant.releasedLectureCount}/{variant.lectureCount}</span>
    {variant.classroomCount > 0 && <span className="text-[10px] text-muted">· {t("classroomCountShort", { count: variant.classroomCount })}</span>}
  </Link>;
}

function EmptyCell({ familyId, catalogVersionId, grade, courseSeason, canManage }: { familyId: string; catalogVersionId: string | null; grade: number; courseSeason: CourseSeason; canManage: boolean }) {
  const t = useTranslations("school.courses");
  if (!canManage) return <span className="flex min-w-[3.25rem] items-center justify-center rounded-lg border border-dashed border-line px-2 py-1.5 text-xs text-muted/50">—</span>;
  return <CreateVariantDialog
    familyId={familyId}
    catalogVersionId={catalogVersionId}
    initialGrade={grade}
    initialSeason={courseSeason}
    trigger={<button type="button" aria-label={t("createVariant")} className="flex min-w-[3.25rem] items-center justify-center rounded-lg border border-dashed border-line px-2 py-1.5 text-muted transition hover:border-crater hover:text-crater"><Plus size={14} /></button>}
  />;
}

function AddGradeRow({ familyId, catalogVersionId, existingGrades }: { familyId: string; catalogVersionId: string | null; existingGrades: number[] }) {
  const t = useTranslations("school.courses");
  const [grade, setGrade] = useState<number | "">("");
  const gradeIsNew = typeof grade === "number" && !existingGrades.includes(grade);
  return <div className="mt-3 flex items-center gap-2 border-t border-line pt-3 text-sm text-muted">
    <span>{t("addGradeRow")}</span>
    {/* doc24 §5.4：旁边那句 `<span>` 是视觉标签，不是可访问名称——读屏用户听到的只是
        "编辑框"。文案已有，补一个 aria-label 就够，不必再造一个 <label>。 */}
    <Input aria-label={t("addGradeRow")} type="number" min={1} max={9} value={grade} onChange={(event) => setGrade(event.target.value === "" ? "" : Number(event.target.value))} className="h-8 w-20" />
    <CreateVariantDialog
      key={grade}
      familyId={familyId}
      catalogVersionId={catalogVersionId}
      initialGrade={typeof grade === "number" ? grade : undefined}
      trigger={<button type="button" disabled={!gradeIsNew} aria-label={t("createVariant")} className="flex items-center justify-center rounded-lg border border-dashed border-line p-1.5 text-muted transition hover:border-crater hover:text-crater disabled:pointer-events-none disabled:opacity-40"><Plus size={14} /></button>}
    />
  </div>;
}

export function VariantMatrix({ familyId, variants, catalogVersions, canManage }: { familyId: string; variants: Variant[]; catalogVersions: CatalogVersion[]; canManage: boolean }) {
  const t = useTranslations("school.courses");
  // 年级 × 季节 × 班型这三维在教材年度换代后会整体重叠（2025 与 2026 的一年级秋季 A
  // 是两门不同的课）。矩阵先按版本分面，否则同一格里会并排出现看起来一样的徽标。
  const defaultVersion = catalogVersions.find((version) => version.isCurrent) ?? catalogVersions[0];
  const [activeVersionId, setActiveVersionId] = useState<string | null>(defaultVersion?.id ?? null);
  const showVersionTabs = catalogVersions.length >= 2;
  const activeVersion = catalogVersions.find((version) => version.id === activeVersionId) ?? defaultVersion;
  const scopedVariants = showVersionTabs && activeVersion
    ? variants.filter((variant) => variant.catalogVersionId === activeVersion.id)
    : variants;
  const grades = Array.from(new Set(scopedVariants.map((variant) => variant.grade))).sort((a, b) => a - b);
  const createVersionId = activeVersion?.id ?? null;

  const versionTabs = showVersionTabs && <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label={t("catalogVersion")}>
    {catalogVersions.map((version) => <button
      key={version.id}
      type="button"
      role="tab"
      aria-selected={version.id === activeVersion?.id}
      onClick={() => setActiveVersionId(version.id)}
      className={cn(
        "rounded-full border px-3 py-1 text-xs transition",
        version.id === activeVersion?.id ? "border-crater bg-crater/10 text-ink" : "border-line text-muted hover:border-crater",
      )}
    >
      {version.title}
      <span className="ml-1 tabular-nums text-[10px] text-muted">{version.variantCount}</span>
    </button>)}
  </div>;

  if (grades.length === 0) {
    return <section className="rounded-2xl border border-line bg-card p-4">
      <h2 className="mb-3 text-base font-medium text-ink">{t("versionMatrix")}</h2>
      {versionTabs}
      <DashboardEmptyCard
        action={canManage ? <CreateVariantDialog
            familyId={familyId}
            catalogVersionId={createVersionId}
            // 手搓的 rounded-full 描边按钮已退休：同一页里的"新建版本"和空状态里的
            // "创建第一个版本"是同一件事，不该长成两种按钮（AGENTS.md UI 组件约束）。
            trigger={<Button type="button" variant="secondary" size="sm"><Plus size={14} />{t("createFirstVariant")}</Button>}
          /> : undefined}
      >{t("noVariantsYet")}</DashboardEmptyCard>
    </section>;
  }

  return <section className="overflow-x-auto rounded-2xl border border-line bg-card p-4">
    <h2 className="mb-3 text-base font-medium text-ink">{t("versionMatrix")}</h2>
    {versionTabs}
    <div className="grid min-w-[640px] gap-2" style={{ gridTemplateColumns: `5rem repeat(${COURSE_SEASONS.length}, 1fr)` }}>
      <div />
      {COURSE_SEASONS.map((season) => <div key={season.value} className="px-2 text-center text-xs font-medium uppercase text-muted">{t(season.labelKey)}</div>)}
      {grades.map((grade) => <Fragment key={grade}>
        <div className="flex items-center px-2 text-sm font-medium text-ink">{t("gradeRowLabel", { grade })}</div>
        {COURSE_SEASONS.map((season) => {
          const cellVariants = scopedVariants
            .filter((variant) => variant.grade === grade && variant.courseSeason === season.value)
            .sort((left, right) => compareCourseDifficulty(left.classType, right.classType));
          return <div key={season.value} className="flex flex-wrap items-center justify-center gap-1.5 rounded-lg bg-paper/60 p-1.5">
            {cellVariants.length === 0
              ? <EmptyCell familyId={familyId} catalogVersionId={createVersionId} grade={grade} courseSeason={season.value} canManage={canManage} />
              : cellVariants.map((variant) => <VariantBadge key={variant.id} familyId={familyId} variant={variant} />)}
          </div>;
        })}
      </Fragment>)}
    </div>
    {canManage && <AddGradeRow familyId={familyId} catalogVersionId={createVersionId} existingGrades={grades} />}
  </section>;
}
