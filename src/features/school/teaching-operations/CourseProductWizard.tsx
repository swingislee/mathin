"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/components/action-form";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { SELECT_ALL_VALUE, fromSelectValue, toSelectValue } from "../controls";
import type { StaffOption } from "../classes";
import { createCourseFamilyAction } from "./actions";
import { COURSE_SEASONS, type CoursePurpose, type CourseSeason } from "./types";

const CLASS_TYPES = ["A", "B", "S"] as const;
const STEPS = ["identity", "ownership", "variant", "confirm"] as const;
type Step = (typeof STEPS)[number];

/**
 * doc22 §5.15 的四步创建流程：产品身份 → 负责人和用途 → 可选首个版本 → 确认创建。
 *
 * 之所以是独立页面而不是 Dialog（对比同目录的 CreateVariantDialog）：课程产品要一次
 * 决定身份、用途、责任归属和是否顺带开第一个版本，字段跨四组、需要回看确认，属于
 * §2.5 里"不适合轻量 Dialog"的那一类。版本创建仍然留在 Course Family 内的 Dialog。
 */
export function CourseProductWizard({ staffOptions }: { staffOptions: StaffOption[] }) {
  const t = useTranslations("school.courseProduct");
  const tCourses = useTranslations("school.courses");
  const router = useRouter();

  const [step, setStep] = useState<Step>("identity");
  const [title, setTitle] = useState("");
  const [publisher, setPublisher] = useState("");
  const [stage, setStage] = useState("");
  const [subject, setSubject] = useState("");
  const [edition, setEdition] = useState("");
  const [description, setDescription] = useState("");
  const [purpose, setPurpose] = useState<CoursePurpose>("production");
  const [ownerId, setOwnerId] = useState("");
  const [withVariant, setWithVariant] = useState(false);
  const [variantTitle, setVariantTitle] = useState("");
  const [productCode, setProductCode] = useState("");
  const [grade, setGrade] = useState(1);
  const [courseSeason, setCourseSeason] = useState<CourseSeason>(1);
  const [classType, setClassType] = useState<string>(CLASS_TYPES[0]);

  const createRun = useAction(createCourseFamilyAction, {
    successMessage: t("created"),
    errorMessage: {
      default: tCourses("actionFailed"),
      INVALID_STAFF: t("invalidOwner"),
      VARIANT_ALREADY_EXISTS: tCourses("variantAlreadyExists"),
    },
    onSuccess: (familyId) => router.push(`/dashboard/courses/${familyId}`),
  });

  const identityReady = title.trim().length > 0;
  const variantReady = !withVariant || variantTitle.trim().length > 0;
  const stepIndex = STEPS.indexOf(step);
  const canAdvance = step === "identity" ? identityReady : step === "variant" ? variantReady : true;

  function submit() {
    createRun.run({
      title: title.trim(),
      publisher: publisher.trim(),
      stage: stage.trim(),
      subject: subject.trim(),
      edition: edition.trim(),
      description: description.trim(),
      purpose,
      ownerId: ownerId || null,
      firstVariant: withVariant
        ? { title: variantTitle.trim(), productCode: productCode.trim(), grade, courseSeason, classType }
        : null,
    });
  }

  const ownerName = staffOptions.find((option) => option.id === ownerId)?.name ?? t("noOwner");
  const seasonLabel = tCourses(COURSE_SEASONS.find((season) => season.value === courseSeason)?.labelKey ?? "summer");

  return (
    <div className="space-y-6">
      <ol className="flex flex-wrap gap-2" aria-label={t("steps")}>
        {STEPS.map((name, index) => (
          <li key={name}>
            <Badge variant={index === stepIndex ? "secondary" : "outline"} aria-current={index === stepIndex ? "step" : undefined}>
              {index + 1}. {t(`step_${name}`)}
            </Badge>
          </li>
        ))}
      </ol>

      <section className="rounded-2xl border border-line bg-card p-5">
        {step === "identity" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Label className="grid gap-1.5 text-xs font-normal text-muted sm:col-span-2">
              {t("productTitle")}
              <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} />
            </Label>
            <Label className="grid gap-1.5 text-xs font-normal text-muted">
              {t("publisher")}
              <Input value={publisher} onChange={(event) => setPublisher(event.target.value)} maxLength={60} />
            </Label>
            <Label className="grid gap-1.5 text-xs font-normal text-muted">
              {t("stage")}
              <Input value={stage} onChange={(event) => setStage(event.target.value)} maxLength={40} />
            </Label>
            <Label className="grid gap-1.5 text-xs font-normal text-muted">
              {t("subject")}
              <Input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={40} />
            </Label>
            <Label className="grid gap-1.5 text-xs font-normal text-muted">
              {t("edition")}
              <Input value={edition} onChange={(event) => setEdition(event.target.value)} maxLength={60} />
            </Label>
            <Label className="grid gap-1.5 text-xs font-normal text-muted sm:col-span-2">
              {t("description")}
              <Textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} rows={4} />
            </Label>
          </div>
        )}

        {step === "ownership" && (
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="grid gap-1.5 text-xs text-muted">
              <span>{t("purpose")}</span>
              <Select value={purpose} onValueChange={(value) => setPurpose(value as CoursePurpose)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="production">{t("purpose_production")}</SelectItem>
                  <SelectItem value="test">{t("purpose_test")}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted">{t("purposeHint")}</p>
            </div>
            <div className="grid gap-1.5 text-xs text-muted">
              <span>{t("owner")}</span>
              <Select value={toSelectValue(ownerId)} onValueChange={(value) => setOwnerId(fromSelectValue(value))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={SELECT_ALL_VALUE}>{t("noOwner")}</SelectItem>
                  {staffOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted">{t("ownerHint")}</p>
            </div>
          </div>
        )}

        {step === "variant" && (
          <div className="grid gap-4">
            <Label className="flex items-center gap-2 text-sm font-normal">
              <Checkbox checked={withVariant} onCheckedChange={(value) => setWithVariant(value === true)} />
              {t("withVariant")}
            </Label>
            <p className="text-xs text-muted">{t("withVariantHint")}</p>
            {withVariant && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Label className="grid gap-1.5 text-xs font-normal text-muted sm:col-span-2">
                  {tCourses("variantTitle")}
                  <Input value={variantTitle} onChange={(event) => setVariantTitle(event.target.value)} maxLength={100} />
                </Label>
                <Label className="grid gap-1.5 text-xs font-normal text-muted">
                  {tCourses("gradeLabel")}
                  <Input type="number" min={1} max={9} value={grade} onChange={(event) => setGrade(Number(event.target.value))} />
                </Label>
                <div className="grid gap-1.5 text-xs text-muted">
                  <span>{tCourses("courseSeason")}</span>
                  <Select value={String(courseSeason)} onValueChange={(value) => setCourseSeason(Number(value) as CourseSeason)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {COURSE_SEASONS.map((season) => (
                        <SelectItem key={season.value} value={String(season.value)}>{tCourses(season.labelKey)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5 text-xs text-muted">
                  <span>{tCourses("classType")}</span>
                  <Select value={classType} onValueChange={setClassType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CLASS_TYPES.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Label className="grid gap-1.5 text-xs font-normal text-muted">
                  {tCourses("productCode")}
                  <Input value={productCode} onChange={(event) => setProductCode(event.target.value)} maxLength={40} />
                </Label>
              </div>
            )}
          </div>
        )}

        {step === "confirm" && (
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted">{t("productTitle")}</dt>
              <dd className="mt-0.5 font-medium text-ink">{title.trim()}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted">{t("identitySummary")}</dt>
              <dd className="mt-0.5">{[publisher, stage, subject, edition].map((value) => value.trim()).filter(Boolean).join(" · ") || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{t("purpose")}</dt>
              <dd className="mt-0.5">{t(`purpose_${purpose}`)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{t("owner")}</dt>
              <dd className="mt-0.5">{ownerName}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted">{t("step_variant")}</dt>
              <dd className="mt-0.5">
                {withVariant
                  ? `${variantTitle.trim()} · ${tCourses("grade", { grade })} · ${seasonLabel} · ${classType}`
                  : t("noVariant")}
              </dd>
            </div>
          </dl>
        )}
      </section>

      <div className={cn("flex items-center gap-3", stepIndex === 0 ? "justify-end" : "justify-between")}>
        {stepIndex > 0 && (
          <Button type="button" variant="secondary" onClick={() => setStep(STEPS[stepIndex - 1])}>
            <ChevronLeft className="size-4" />
            {t("back")}
          </Button>
        )}
        {step === "confirm" ? (
          <Button type="button" disabled={createRun.pending || !identityReady} onClick={submit}>
            {createRun.pending && <LoaderCircle className="size-4 animate-spin" />}
            {t("create")}
          </Button>
        ) : (
          <Button type="button" disabled={!canAdvance} onClick={() => setStep(STEPS[stepIndex + 1])}>
            {t("next")}
            <ChevronRight className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
