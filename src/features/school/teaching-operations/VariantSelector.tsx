import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { COURSE_SEASONS } from "./course-queries";
import type { CourseFamilyDetail, SelectedCourseVariant } from "./course-family-detail";
import type { CourseSeason } from "./types";

type Variant = CourseFamilyDetail["variants"][number];

function hrefForVariant(familyId: string, variantId: string) {
  return `/dashboard/courses/${familyId}?variant=${variantId}`;
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
}: {
  active: boolean;
  label: string;
  target: Variant | undefined;
  familyId: string;
}) {
  if (!target) return <span aria-disabled="true" className="flex h-7 min-w-7 items-center justify-center rounded-md px-2 text-xs text-muted/50">{label}</span>;
  return <Link
    href={hrefForVariant(familyId, target.id)}
    aria-current={active ? "page" : undefined}
    className={cn(
      "flex h-7 min-w-7 items-center justify-center whitespace-nowrap rounded-md px-2 text-xs transition-all",
      active ? "bg-card font-medium text-ink shadow-sm" : "text-muted hover:text-ink",
    )}
  >{label}</Link>;
}

export async function VariantSelector({
  familyId,
  variants,
  catalogVersions,
  current,
}: {
  familyId: string;
  variants: CourseFamilyDetail["variants"];
  catalogVersions: CourseFamilyDetail["catalogVersions"];
  current: SelectedCourseVariant;
}) {
  const t = await getTranslations("school.courses");
  const currentVariant: Variant = variants.find((variant) => variant.id === current.id) ?? { ...current, trashedAt: null, lectureCount: 0, releasedLectureCount: 0, classroomCount: 0, hasRisk: false };
  // 年级/班型/季节三个切换组只在当前教材年度版本内跳转：跨版本跳转会在用户以为自己
  // 只换了个年级时把课程换成另一套教材，这正是版本层要防的事。换版本是显式的第四组。
  const scoped = variants.filter((variant) => variant.catalogVersionId === current.catalogVersionId);
  const grades = Array.from(new Set(scoped.map((variant) => variant.grade))).sort((a, b) => a - b);
  const classTypes = Array.from(new Set(scoped.map((variant) => variant.classType))).sort();

  // doc23 §8.2：三行按钮阵列压成一条。它现在住在 sticky 的导航行里（ObjectContextSwitcher），
  // 原来那种"每维一整行 + h-9 药丸"会把顶部撑到接近 200px，移动端预算是整条不超过视口约四分之一。
  return <div className="flex min-w-0 flex-wrap items-center gap-2">
    {catalogVersions.length >= 2 && <SelectorGroup label={t("catalogVersion")}>
      {catalogVersions.map((version) => <OptionLink
        key={version.id}
        active={current.catalogVersionId === version.id}
        label={version.title}
        target={pickVariant(
          variants.filter((variant) => variant.catalogVersionId === version.id),
          currentVariant,
          (variant) => variant.grade === current.grade,
        )}
        familyId={familyId}
      />)}
    </SelectorGroup>}
    <SelectorGroup label={t("gradeLabel")}>
      {grades.map((grade) => <OptionLink key={grade} active={current.grade === grade} label={String(grade)} target={pickVariant(scoped, currentVariant, (variant) => variant.grade === grade)} familyId={familyId} />)}
    </SelectorGroup>
    <SelectorGroup label={t("classType")}>
      {classTypes.map((classType) => <OptionLink key={classType || "default"} active={current.classType === classType} label={classType || t("defaultClassType")} target={pickVariant(scoped, currentVariant, (variant) => variant.classType === classType)} familyId={familyId} />)}
    </SelectorGroup>
    <SelectorGroup label={t("courseSeason")}>
      {COURSE_SEASONS.map((season) => <OptionLink key={season.value} active={current.courseSeason === season.value} label={t(season.labelKey)} target={pickVariant(scoped, currentVariant, (variant) => variant.courseSeason === season.value as CourseSeason)} familyId={familyId} />)}
    </SelectorGroup>
  </div>;
}

function SelectorGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex shrink-0 items-center gap-1 rounded-lg bg-line/40 p-1" aria-label={label} role="group">
    <span className="px-1 text-[11px] text-muted">{label}</span>
    {children}
  </div>;
}
