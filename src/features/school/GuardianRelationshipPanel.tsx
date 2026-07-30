"use client";

import { Link2Off, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { revokeMyGuardianRelationshipAction } from "./customer-actions";

export function GuardianRelationshipPanel({
  studentId,
  studentName,
}: {
  studentId: string;
  studentName: string;
}) {
  const t = useTranslations("school.students");
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  const revoke = () => startTransition(async () => {
    const result = await revokeMyGuardianRelationshipAction(studentId);
    if (!result.ok) {
      setMessage(t("guardianRelationshipRevokeFailed"));
      return;
    }
    setMessage(t("guardianRelationshipRevoked"));
    router.refresh();
  });

  return (
    <section className="rounded-2xl border border-line bg-card p-4">
      <h2 className="text-base font-medium text-ink">{t("guardianRelationship")}</h2>
      <p className="mt-2 text-sm text-muted">{t("guardianRelationshipHint", { name: studentName })}</p>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="mt-3 text-rose hover:text-rose-deep">
            <Link2Off size={15} />
            {t("guardianRelationshipRevoke")}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("guardianRelationshipRevokeTitle", { name: studentName })}</AlertDialogTitle>
            <AlertDialogDescription>{t("guardianRelationshipRevokeDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("guardianRelationshipKeep")}</AlertDialogCancel>
            <AlertDialogAction onClick={revoke} disabled={pending}>
              {pending && <LoaderCircle size={15} className="animate-spin" />}
              {t("guardianRelationshipRevokeConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {message && <p className="mt-2 text-xs text-muted" aria-live="polite">{message}</p>}
    </section>
  );
}
