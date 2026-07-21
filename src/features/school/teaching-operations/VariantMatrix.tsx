"use client";

import { AlertTriangle, Plus } from "lucide-react";
import { Fragment, useState } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { CreateVariantDialog } from "./CreateVariantDialog";
import type { CourseFamilyDetail } from "./course-family-detail";
import { COURSE_SEASONS, type CourseSeason } from "./types";

type Variant = CourseFamilyDetail["variants"][number];

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
    {variant.hasRisk && <AlertTriangle size={11} className="absolute -right-1 -top-1 text-amber-600" aria-label={t("hasRisk")} />}
    <span className="font-medium">{variant.classType || t("defaultClassType")}</span>
    <span className="tabular-nums text-[10px] text-muted">{variant.releasedLectureCount}/{variant.lectureCount}</span>
    {variant.classroomCount > 0 && <span className="text-[10px] text-muted">· {t("classroomCountShort", { count: variant.classroomCount })}</span>}
  </Link>;
}

function EmptyCell({ familyId, grade, courseSeason, canManage }: { familyId: string; grade: number; courseSeason: CourseSeason; canManage: boolean }) {
  const t = useTranslations("school.courses");
  if (!canManage) return <span className="flex min-w-[3.25rem] items-center justify-center rounded-lg border border-dashed border-line px-2 py-1.5 text-xs text-muted/50">—</span>;
  return <CreateVariantDialog
    familyId={familyId}
    initialGrade={grade}
    initialSeason={courseSeason}
    trigger={<button type="button" aria-label={t("createVariant")} className="flex min-w-[3.25rem] items-center justify-center rounded-lg border border-dashed border-line px-2 py-1.5 text-muted transition hover:border-crater hover:text-crater"><Plus size={14} /></button>}
  />;
}

function AddGradeRow({ familyId, existingGrades }: { familyId: string; existingGrades: number[] }) {
  const t = useTranslations("school.courses");
  const [grade, setGrade] = useState<number | "">("");
  const gradeIsNew = typeof grade === "number" && !existingGrades.includes(grade);
  return <div className="mt-3 flex items-center gap-2 border-t border-line pt-3 text-sm text-muted">
    <span>{t("addGradeRow")}</span>
    <Input type="number" min={1} max={9} value={grade} onChange={(event) => setGrade(event.target.value === "" ? "" : Number(event.target.value))} className="h-8 w-20" />
    <CreateVariantDialog
      key={grade}
      familyId={familyId}
      initialGrade={typeof grade === "number" ? grade : undefined}
      trigger={<button type="button" disabled={!gradeIsNew} aria-label={t("createVariant")} className="flex items-center justify-center rounded-lg border border-dashed border-line p-1.5 text-muted transition hover:border-crater hover:text-crater disabled:pointer-events-none disabled:opacity-40"><Plus size={14} /></button>}
    />
  </div>;
}

export function VariantMatrix({ familyId, variants, canManage }: { familyId: string; variants: Variant[]; canManage: boolean }) {
  const t = useTranslations("school.courses");
  const grades = Array.from(new Set(variants.map((variant) => variant.grade))).sort((a, b) => a - b);

  if (grades.length === 0) {
    return <section className="rounded-2xl border border-dashed border-line bg-card p-8 text-center">
      <p className="text-sm text-muted">{t("noVariantsYet")}</p>
      {canManage && <div className="mt-4 flex justify-center">
        <CreateVariantDialog
          familyId={familyId}
          trigger={<button type="button" className="rounded-full border border-crater/40 bg-crater/10 px-4 py-2 text-sm font-medium text-crater transition hover:bg-crater/15"><Plus size={14} className="mr-1.5 inline" />{t("createFirstVariant")}</button>}
        />
      </div>}
    </section>;
  }

  return <section className="overflow-x-auto rounded-2xl border border-line bg-card p-4">
    <h2 className="mb-3 font-medium text-ink">{t("versionMatrix")}</h2>
    <div className="grid min-w-[640px] gap-2" style={{ gridTemplateColumns: `5rem repeat(${COURSE_SEASONS.length}, 1fr)` }}>
      <div />
      {COURSE_SEASONS.map((season) => <div key={season.value} className="px-2 text-center text-xs font-medium uppercase text-muted">{t(season.labelKey)}</div>)}
      {grades.map((grade) => <Fragment key={grade}>
        <div className="flex items-center px-2 text-sm font-medium text-ink">{t("gradeRowLabel", { grade })}</div>
        {COURSE_SEASONS.map((season) => {
          const cellVariants = variants.filter((variant) => variant.grade === grade && variant.courseSeason === season.value);
          return <div key={season.value} className="flex flex-wrap items-center justify-center gap-1.5 rounded-lg bg-paper/60 p-1.5">
            {cellVariants.length === 0
              ? <EmptyCell familyId={familyId} grade={grade} courseSeason={season.value} canManage={canManage} />
              : cellVariants.map((variant) => <VariantBadge key={variant.id} familyId={familyId} variant={variant} />)}
          </div>;
        })}
      </Fragment>)}
    </div>
    {canManage && <AddGradeRow familyId={familyId} existingGrades={grades} />}
  </section>;
}
