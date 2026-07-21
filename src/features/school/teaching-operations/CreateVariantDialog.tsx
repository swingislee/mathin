"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/components/action-form";
import { useRouter } from "@/i18n/navigation";
import { createCourseVariantAction } from "./actions";
import { COURSE_SEASONS, type CourseSeason } from "./types";

const CLASS_TYPES = ["A", "B", "S"] as const;

export function CreateVariantDialog({
  trigger,
  familyId,
  initialGrade,
  initialSeason,
}: {
  trigger: ReactNode;
  familyId: string;
  initialGrade?: number;
  initialSeason?: CourseSeason;
}) {
  const t = useTranslations("school.courses");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [productCode, setProductCode] = useState("");
  const [grade, setGrade] = useState(initialGrade ?? 1);
  const [courseSeason, setCourseSeason] = useState<CourseSeason>(initialSeason ?? 1);
  const [classType, setClassType] = useState<string>(CLASS_TYPES[0]);

  const createRun = useAction(createCourseVariantAction, {
    successMessage: t("variantCreated"),
    errorMessage: { default: t("actionFailed"), VARIANT_ALREADY_EXISTS: t("variantAlreadyExists") },
    onSuccess: (courseId) => { setOpen(false); router.push(`/dashboard/courses/${familyId}?variant=${courseId}`); },
  });

  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild>{trigger}</DialogTrigger>
    <DialogContent>
      <DialogHeader><DialogTitle>{t("createVariant")}</DialogTitle><DialogDescription>{t("createVariantHint")}</DialogDescription></DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <Label className="grid gap-1 text-xs font-normal text-muted sm:col-span-2">{t("variantTitle")}<Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} /></Label>
        <Label className="grid gap-1 text-xs font-normal text-muted">{t("gradeLabel")}<Input type="number" min={1} max={9} value={grade} onChange={(event) => setGrade(Number(event.target.value))} /></Label>
        <div className="grid gap-1 text-xs text-muted">
          <span>{t("courseSeason")}</span>
          <Select value={String(courseSeason)} onValueChange={(value) => setCourseSeason(Number(value) as CourseSeason)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{COURSE_SEASONS.map((season) => <SelectItem key={season.value} value={String(season.value)}>{t(season.labelKey)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid gap-1 text-xs text-muted">
          <span>{t("classType")}</span>
          <Select value={classType} onValueChange={setClassType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{CLASS_TYPES.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <Label className="grid gap-1 text-xs font-normal text-muted">{t("productCode")}<Input value={productCode} onChange={(event) => setProductCode(event.target.value)} maxLength={40} /></Label>
      </div>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>{t("cancel")}</Button>
        <Button
          type="button"
          disabled={createRun.pending || !title.trim()}
          onClick={() => createRun.run({ familyId, title, productCode, grade, courseSeason, classType })}
        >
          {createRun.pending && <LoaderCircle className="size-4 animate-spin" />}
          {t("create")}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
