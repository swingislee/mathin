"use client";

import { KeyRound, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useAction } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "@/i18n/navigation";
import { updateRegistrationInviteAction } from "./actions/registration";
import type { RegistrationInviteSettings } from "./registration";

export function RegistrationInvitePanel({ initial, updatedLabel }: { initial: RegistrationInviteSettings; updatedLabel: string }) {
  const t = useTranslations("school.registration");
  const router = useRouter();
  const [code, setCode] = useState(initial.code);
  const [active, setActive] = useState(initial.isActive);
  const save = useAction(updateRegistrationInviteAction, {
    successMessage: t("saved"),
    errorMessage: {
      VALIDATION: t("invalid"),
      INVALID_INVITE_CODE: t("invalid"),
      default: t("saveError"),
    },
    onSuccess: () => router.refresh(),
  });

  return (
    <section className="max-w-2xl rounded-2xl border border-line bg-card p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-moon/45 text-crater">
          <KeyRound size={20} strokeWidth={1.7} />
        </span>
        <div className="min-w-0 flex-1">
          <Label htmlFor="registrationInviteCode">{t("code")}</Label>
          <Input
            id="registrationInviteCode"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            minLength={6}
            maxLength={32}
            autoComplete="off"
            spellCheck={false}
            className="mt-2 h-11 max-w-sm rounded-full font-mono uppercase tracking-[0.14em]"
          />
          <p className="mt-2 text-xs leading-5 text-muted">{t("codeHint")}</p>
        </div>
      </div>

      <div className="mt-6 flex items-start gap-3 border-t border-line pt-5">
        <Checkbox id="registrationInviteActive" checked={active} onCheckedChange={(checked) => setActive(checked === true)} className="mt-0.5 size-5" />
        <div>
          <Label htmlFor="registrationInviteActive">{t("active")}</Label>
          <p className="mt-1 text-xs leading-5 text-muted">{t("activeHint")}</p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">{updatedLabel}</p>
        <Button type="button" disabled={save.pending || code.trim().length < 6} onClick={() => save.run(code, active)}>
          {save.pending && <LoaderCircle size={15} className="animate-spin" />}
          {t("save")}
        </Button>
      </div>
    </section>
  );
}
