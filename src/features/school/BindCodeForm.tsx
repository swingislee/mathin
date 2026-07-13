"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { LoaderCircle, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    if (!code.trim()) return;
    startTransition(async () => {
      try {
        if (mode === "claim") {
          await claimStudentAccountAction(code);
        } else {
          await bindGuardianAction(code, relation, consents);
        }
        setError(null);
        router.refresh();
      } catch {
        setError(t("bindFailed"));
      }
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
            setError(null);
          }}
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
            submit();
          }}
        >
          {pending ? <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" /> : <LogIn size={15} />}
          {t("bindSubmit")}
        </Button>
      </div>
      {mode==="guardian"&&<div className="flex flex-wrap gap-2 pl-1" aria-label={t("consentTitle")}>{(["profile","learning","video"] as const).map(scope=><Button key={scope} type="button" size="sm" variant={consents[scope]?"primary":"secondary"} aria-pressed={consents[scope]} onClick={()=>setConsents(current=>({...current,[scope]:!current[scope]}))}>{t(`consent_${scope}`)}</Button>)}</div>}
      {error && <p role="alert" className="pl-4 text-xs text-rose">{error}</p>}
    </div>
  );
}
