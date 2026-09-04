"use client";

import { FilePenLine, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { startInvitationTeacherAssessmentAction } from "./teacher-assessment-actions";

export function TeacherAssessmentEntryButton({
  registrationId,
  invitationId,
}: {
  registrationId: string | null;
  invitationId: string | null;
}) {
  const t = useTranslations("school.teacherAssessment");
  const router = useRouter();
  const [pending, setPending] = useState(false);

  if (registrationId) {
    return (
      <Link
        href={`/dashboard/assessments/${registrationId}`}
        className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "h-7 px-2 text-[11px]")}
        onClick={(event) => event.stopPropagation()}
      >
        <FilePenLine className="size-3.5" />
        {t("openQuestionEntry")}
      </Link>
    );
  }
  if (!invitationId) return null;

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className="h-7 px-2 text-[11px]"
      disabled={pending}
      onClick={(event) => {
        event.stopPropagation();
        setPending(true);
        void startInvitationTeacherAssessmentAction(invitationId).then((result) => {
          if (!result.ok) {
            toast.error(t("startFailed"));
            setPending(false);
            return;
          }
          router.push(`/dashboard/assessments/${result.data.registrationId}`);
        });
      }}
    >
      {pending ? <LoaderCircle className="size-3.5 animate-spin" /> : <FilePenLine className="size-3.5" />}
      {t("startQuestionEntry")}
    </Button>
  );
}
