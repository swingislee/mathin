"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { LoaderCircle, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    if (!code.trim()) return;
    startTransition(async () => {
      try {
        if (mode === "claim") {
          await claimStudentAccountAction(code);
        } else {
          await bindGuardianAction(code, relation);
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
        <input
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
            setError(null);
          }}
          placeholder={t("bindCodePlaceholder")}
          maxLength={16}
          aria-label={t("bindCodePlaceholder")}
          className="w-40 rounded-full border border-line bg-transparent px-4 py-2 font-mono text-sm outline-none transition focus:ring-2 focus:ring-moon"
        />
        {mode === "guardian" && (
          <input
            value={relation}
            onChange={(event) => setRelation(event.target.value)}
            placeholder={t("relationPlaceholder")}
            maxLength={20}
            aria-label={t("relationPlaceholder")}
            className="w-28 rounded-full border border-line bg-transparent px-4 py-2 text-sm outline-none transition focus:ring-2 focus:ring-moon"
          />
        )}
        <Button
          variant="secondary"
          size="sm"
          className="gap-1.5"
          disabled={pending || !code.trim()}
          onClick={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {pending ? <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" /> : <LogIn size={15} />}
          {t("bindSubmit")}
        </Button>
      </div>
      {error && <p role="alert" className="pl-4 text-xs text-rose">{error}</p>}
    </div>
  );
}
