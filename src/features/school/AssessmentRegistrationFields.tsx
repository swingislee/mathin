"use client";

import { useId, type ComponentProps, type ReactNode } from "react";
import { Award, Gauge, GraduationCap, Signpost } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { ACTIVITY_ROUTES, ASSESSMENT_BANDS, type ActivityRouteKind, type StoredAssessmentBand } from "./activity-workflow-contract";
import { FollowupChoice, type FollowupTone } from "./dashboard-page/FollowupChoice";
import { FollowupFieldIcon } from "./FollowupFieldIcon";
import type { FollowupEntryFields } from "./FollowupEntryFields";

/** 同一控制器提供常驻标签、阶段字段和右栏；切换阶段保留唯一草稿。 */
export interface AssessmentEntryParts {
  tags: ReactNode;
  fields: ReactNode;
  followup: ComponentProps<typeof FollowupEntryFields>;
  dirty: boolean;
}

export function AssessmentEntrySurface({ entry, render }: { entry: AssessmentEntryParts; render: (entry: AssessmentEntryParts) => ReactNode }) {
  return render(entry);
}

interface RegistrationValues {
  assessmentBand: StoredAssessmentBand | null;
  score: number | null;
  recommendedClass: string;
}

function bandTone(band: string): FollowupTone {
  if (band === "x_plus" || band === "below_a") return "unhealthy";
  if (band === "g_plus") return "attention";
  return "healthy";
}

/** 测评字段沿用首联的浅色字段图标与紧凑控件；各入口继续维护自己的草稿和保存。 */
export function AssessmentRegistrationFields({ value, onChange, disabled, routing }: {
  value: RegistrationValues;
  onChange: (patch: Partial<RegistrationValues>) => void;
  disabled: boolean;
  routing?: { value: ActivityRouteKind | null; onChange: (value: ActivityRouteKind | null) => void };
}) {
  const t = useTranslations("school.activities");
  const routeT = useTranslations("school.enrollmentWorkflow");
  const quickT = useTranslations("school.assessmentQuickEntry");
  const id = useId();

  return <div data-assessment-registration-fields className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2">
    <div data-assessment-field="band" className="flex min-h-8 min-w-0 max-w-full items-center gap-2">
      <FollowupFieldIcon id={`${id}-band`} icon={Award} label={t("assessmentBand")}
        className="fill-leaf/50 text-[color:color-mix(in_srgb,var(--leaf-deep)_40%,var(--leaf))]" />
      <FollowupChoice value={value.assessmentBand ?? "none"} label={t("assessmentBand")} disabled={disabled}
        className="w-28 min-h-8 py-1"
        options={[
          { value: "none", label: t("notEntered"), tone: "neutral" },
          ...(value.assessmentBand === "below_a" ? [{ value: "below_a", label: t("band_below_a"), tone: "unhealthy" as const }] : []),
          ...ASSESSMENT_BANDS.map((band) => ({ value: band, label: t(`band_${band}`), tone: bandTone(band) })),
        ]}
        onValueChange={(band) => onChange({ assessmentBand: band === "none" ? null : band as StoredAssessmentBand })} />
    </div>
    <div data-assessment-field="score" className="flex min-h-8 min-w-0 max-w-full items-center gap-2">
      <FollowupFieldIcon id={`${id}-score`} icon={Gauge} label={t("scoreShort")} className="fill-moon/60 text-crater" />
      <Input type="number" min={0} max={10000} value={value.score ?? ""} disabled={disabled}
        aria-labelledby={`${id}-score`} placeholder={t("scoreShort")} className="h-8 w-20 min-w-0 bg-card text-xs"
        onChange={(event) => onChange({ score: event.target.value === "" ? null : Number(event.target.value) })} />
    </div>
    <div data-assessment-field="class" className="flex min-h-8 min-w-0 max-w-full items-center gap-2">
      <FollowupFieldIcon id={`${id}-class`} icon={GraduationCap} label={t("recommendedClass")}
        className="fill-cheek/60 text-[color:color-mix(in_srgb,var(--rose)_35%,var(--cheek))]" />
      <Input value={value.recommendedClass} maxLength={200} disabled={disabled} aria-labelledby={`${id}-class`}
        placeholder={t("recommendedClass")} className="h-8 w-40 min-w-0 bg-card text-xs"
        onChange={(event) => onChange({ recommendedClass: event.target.value })} />
    </div>
    {routing ? <div data-assessment-field="route" className="flex min-h-8 min-w-0 max-w-full items-center gap-2">
      <FollowupFieldIcon id={`${id}-route`} icon={Signpost} label={routeT("nextStep")} className="fill-moon text-crater" />
      <FollowupChoice value={routing.value ?? "none"} label={routeT("nextStep")} disabled={disabled}
        className="w-48 min-h-8 py-1"
        options={[{ value: "none", label: quickT("routeUnchanged") }, ...ACTIVITY_ROUTES.filter((route) => route !== "enrollment_pending" || routing.value === route)
          .map((route) => ({ value: route, label: routeT(`route_${route}`) }))]}
        onValueChange={(route) => routing.onChange(route === "none" ? null : route as ActivityRouteKind)} />
    </div> : null}
  </div>;
}
