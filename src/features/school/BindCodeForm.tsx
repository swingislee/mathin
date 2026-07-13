"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { LoaderCircle, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAction } from "@/components/action-form";
import type { ActionResult } from "@/lib/action-result";
import { useRouter } from "@/i18n/navigation";
import { bindGuardianAction, claimStudentAccountAction } from "./customer-actions";

interface BindCodeFormProps {
  mode: "claim" | "guardian";
}

export function BindCodeForm({ mode }: BindCodeFormProps) {
  const t = useTranslations("school.customer");
  const router = useRouter();
  const [code, setCode] = useState("");
  const [relation, setRelation] = useState("");
  const [consents,setConsents]=useState({profile:false,learning:false,video:false});

  const submitAction = (): Promise<ActionResult> =>
    mode === "claim" ? claimStudentAccountAction(code) : bindGuardianAction(code, relation, consents);
  const { run: submit, pending } = useAction(submitAction, {
    successMessage: t("bindSuccess"),
    errorMessage: { default: t("bindFailed") },
    onSuccess: () => router.refresh(),
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder={t("bindCodePlaceholder")}
          maxLength={16}
          aria-label={t("bindCodePlaceholder")}
          className="h-9 w-48 rounded-full bg-transparent font-mono"
        />
        {mode === "guardian" && (
          <Input
            value={relation}
            onChange={(event) => setRelation(event.target.value)}
            placeholder={t("relationPlaceholder")}
            maxLength={20}
            aria-label={t("relationPlaceholder")}
            className="h-9 w-32 rounded-full bg-transparent"
          />
        )}
        <Button
          variant="secondary"
          size="sm"
          className="gap-1.5"
          disabled={pending || !code.trim() || (mode==="guardian"&&!consents.profile)}
          onClick={(event) => {
            event.preventDefault();
            if (code.trim()) submit();
          }}
        >
          {pending ? <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" /> : <LogIn size={15} />}
          {t("bindSubmit")}
        </Button>
      </div>
      {mode==="guardian"&&<div className="flex flex-wrap gap-2 pl-1" aria-label={t("consentTitle")}>{(["profile","learning","video"] as const).map(scope=><Button key={scope} type="button" size="sm" variant={consents[scope]?"primary":"secondary"} aria-pressed={consents[scope]} onClick={()=>setConsents(current=>({...current,[scope]:!current[scope]}))}>{t(`consent_${scope}`)}</Button>)}</div>}
    </div>
  );
}
