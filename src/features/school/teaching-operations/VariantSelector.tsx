import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { COURSE_SEASONS } from "./course-queries";
import type { CourseFamilyDetail } from "./course-family-detail";
import type { CourseScope, CourseSeason } from "./types";

type Variant = CourseFamilyDetail["variants"][number];

function hrefForVariant(familyId: string, variantId: string, scope: CourseScope) {
  return `/dashboard/courses/${familyId}?variant=${variantId}&scope=${scope}`;
}

function pickVariant(variants: Variant[], current: Variant, match: (variant: Variant) => boolean) {
  return variants.find((variant) => match(variant) && variant.courseSeason === current.courseSeason && variant.classType === current.classType)
    ?? variants.find((variant) => match(variant) && variant.classType === current.classType)
    ?? variants.find(match);
}

function OptionLink({
  active,
  label,
  target,
  familyId,
  scope,
}: {
  active: boolean;
  label: string;
  target: Variant | undefined;
  familyId: string;
  scope: CourseScope;
}) {
  if (!target) return <span aria-disabled="true" className="rounded-full border border-line px-3 py-1.5 text-sm text-muted/60">{label}</span>;
  return <Link href={hrefForVariant(familyId, target.id, scope)} aria-current={active ? "page" : undefined} className={cn(buttonVariants({ variant: active ? "primary" : "secondary", size: "sm" }), "min-w-10 px-3 py-1.5")}>{label}</Link>;
}

export async function VariantSelector({ detail, scope }: { detail: CourseFamilyDetail; scope: CourseScope }) {
  const t = await getTranslations("school.courses");
  const current = detail.selectedVariant;
  const currentVariant: Variant = detail.variants.find((variant) => variant.id === current.id) ?? { ...current, trashedAt: null };
  const grades = Array.from(new Set(detail.variants.map((variant) => variant.grade))).sort((a, b) => a - b);
  const classTypes = Array.from(new Set(detail.variants.map((variant) => variant.classType))).sort();

  return <div className="mt-5 space-y-3">
    <SelectorRow label={t("gradeLabel")}>
      {grades.map((grade) => <OptionLink key={grade} active={current.grade === grade} label={String(grade)} target={pickVariant(detail.variants, currentVariant, (variant) => variant.grade === grade)} familyId={detail.family.id} scope={scope} />)}
    </SelectorRow>
    <SelectorRow label={t("classType")}>
      {classTypes.map((classType) => <OptionLink key={classType || "default"} active={current.classType === classType} label={classType || t("defaultClassType")} target={pickVariant(detail.variants, currentVariant, (variant) => variant.classType === classType)} familyId={detail.family.id} scope={scope} />)}
    </SelectorRow>
    <SelectorRow label={t("courseSeason")}>
      {COURSE_SEASONS.map((season) => <OptionLink key={season.value} active={current.courseSeason === season.value} label={t(season.labelKey)} target={pickVariant(detail.variants, currentVariant, (variant) => variant.courseSeason === season.value as CourseSeason)} familyId={detail.family.id} scope={scope} />)}
    </SelectorRow>
  </div>;
}

function SelectorRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-start gap-3"><p className="w-14 shrink-0 pt-1.5 text-sm text-muted">{label}</p><div className="flex min-w-0 gap-2 overflow-x-auto pb-1">{children}</div></div>;
}
