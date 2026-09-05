"use client";

import { LoaderCircle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DashboardCommandPanel,
  DashboardCommandState,
  DashboardPage,
  DashboardSection,
} from "./dashboard-page";
import { useRouter } from "@/i18n/navigation";
import { updateLongTermOpportunityAction } from "./actions/renewals";
import type {
  CourseOpportunityStage,
  LongTermOpportunityRow,
  RenewalCourseOption,
  RenewalStaffOption,
  RenewalTermOption,
} from "./renewal-contract";
import { FollowupTabs } from "./FollowupTabs";
import { FollowupChoice } from "./dashboard-page/FollowupChoice";

const EDITABLE_STAGES = [
  "planning",
  "contacted",
  "considering",
  "committed",
  "payment_pending",
  "not_enrolled",
  "nurturing",
] as const satisfies readonly CourseOpportunityStage[];

function dateTime(value: string | null, locale: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function RenewalOpportunityDetail({
  opportunity,
  owners,
  courses,
  terms,
  canWrite,
}: {
  opportunity: LongTermOpportunityRow;
  owners: RenewalStaffOption[];
  courses: RenewalCourseOption[];
  terms: RenewalTermOption[];
  canWrite: boolean;
}) {
  const t = useTranslations("school.renewals");
  const locale = useLocale();
  const router = useRouter();
  const [stage, setStage] = useState<CourseOpportunityStage>(opportunity.stage);
  const [ownerId, setOwnerId] = useState(opportunity.ownerId);
  const [courseId, setCourseId] = useState(opportunity.courseId);
  const [termId, setTermId] = useState(opportunity.termId);
  const [nextAction, setNextAction] = useState(opportunity.nextAction);
  const [nextActionAt, setNextActionAt] = useState(opportunity.nextActionAt ?? "");
  const [note, setNote] = useState(opportunity.note);
  const backHref = opportunity.opportunityType === "renewal" ? "/dashboard/followups/renewals" : "/dashboard/followups/renewals/growth";
  const action = useAction(updateLongTermOpportunityAction, {
    successMessage: t("opportunitySaved"),
    errorMessage: {
      default: t("actionFailed"),
      INVALID_OPPORTUNITY_TRANSITION: t("invalidOpportunityTransition"),
      OPPORTUNITY_ENROLLED: t("opportunityEnrolled"),
      OPPORTUNITY_TARGET_CONFLICT: t("opportunityTargetConflict"),
      COURSE_NOT_AVAILABLE: t("courseUnavailable"),
      TERM_NOT_FOUND: t("termUnavailable"),
      OWNER_NOT_AVAILABLE: t("ownerUnavailable"),
      FORBIDDEN_OWNER_ASSIGNMENT: t("ownerAssignmentForbidden"),
    },
    onSuccess: () => router.refresh(),
  });
  const immutable = opportunity.stage === "enrolled" || !canWrite;

  return <DashboardPage
    title={opportunity.studentName}
    eyebrow={t(`type_${opportunity.opportunityType}`)}
    backHref={backHref}
    backLabel={t("backToWorkspace")}
    breadcrumbs={[{ label: t("title"), href: "/dashboard/followups/renewals" }, { label: opportunity.studentName }]}
    commandPanel={<DashboardCommandPanel><DashboardCommandState><FollowupTabs /></DashboardCommandState></DashboardCommandPanel>}
  >
    <DashboardSection>
      <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-xs text-muted">{t("student")}</dt><dd className="mt-1 font-medium text-ink">{opportunity.studentName}</dd></div>
        <div><dt className="text-xs text-muted">{t("type")}</dt><dd className="mt-1"><Badge variant="outline">{t(`type_${opportunity.opportunityType}`)}</Badge></dd></div>
        <div><dt className="text-xs text-muted">{t("cycle")}</dt><dd className="mt-1 text-ink">{opportunity.cycleName || "—"}</dd></div>
        <div><dt className="text-xs text-muted">{t("sourceClass")}</dt><dd className="mt-1 text-ink">{opportunity.sourceClassroomName || "—"}</dd></div>
      </dl>
    </DashboardSection>

    <DashboardSection>
      <div className="grid gap-4 lg:grid-cols-2">
        <Label>{t("stage")}<FollowupChoice label={t("stage")} value={stage} disabled={immutable} onValueChange={value => setStage(value as CourseOpportunityStage)} options={(opportunity.stage === "enrolled" ? ["enrolled"] : EDITABLE_STAGES).map(value => ({ value, label: t("stage_" + value), tone: value === "enrolled" || value === "committed" ? "healthy" : value === "not_enrolled" ? "unhealthy" : "neutral" }))} className="mt-1 w-full" /></Label>
        <Label>{t("owner")}<FollowupChoice label={t("owner")} value={ownerId} disabled={immutable} onValueChange={setOwnerId} options={owners.map(owner => ({ value: owner.id, label: owner.name }))} className="mt-1 w-full" /></Label>
        <Label>{t("targetCourse")}<FollowupChoice label={t("targetCourse")} value={courseId} disabled={immutable} onValueChange={setCourseId} options={courses.map(course => ({ value: course.id, label: course.title }))} className="mt-1 w-full" /></Label>
        <Label>{t("targetTerm")}<FollowupChoice label={t("targetTerm")} value={termId} disabled={immutable} onValueChange={setTermId} options={terms.map(term => ({ value: term.id, label: term.name }))} className="mt-1 w-full" /></Label>
        <Label>{t("nextAction")}<Input className="mt-1" disabled={immutable} value={nextAction} onChange={(event) => setNextAction(event.target.value)} maxLength={500} /></Label>
        <Label>{t("nextActionAt")}<DateTimePicker className="mt-1" mode="datetime" disabled={immutable} value={nextActionAt} onValueChange={setNextActionAt} /></Label>
        <Label className="lg:col-span-2">{t("note")}<Textarea className="mt-1" disabled={immutable} value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} rows={4} /></Label>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">{t("lastUpdated", { time: dateTime(opportunity.updatedAt, locale) })}</p>
        {canWrite ? <Button disabled={action.pending || immutable} onClick={() => action.run({
          opportunityId: opportunity.id,
          opportunityType: opportunity.opportunityType,
          courseId,
          termId,
          stage: stage === "enrolled" ? "committed" : stage,
          ownerId,
          nextAction,
          nextActionAt: nextActionAt || null,
          note,
        })}>{action.pending ? <LoaderCircle className="size-4 animate-spin" /> : null}{t("saveOpportunity")}</Button> : null}
      </div>
    </DashboardSection>
  </DashboardPage>;
}
