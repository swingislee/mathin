"use client";

import { LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import {
  listStudentGuardiansAction,
  setGuardianScopeAction,
  type GuardianScopeRow,
} from "./customer-actions";

const scopes = ["grades", "video", "finance"] as const;

export function GuardianScopePanel({ studentId }: { studentId: string }) {
  const t = useTranslations("school.students");
  const loadingT = useTranslations("school.session");
  const [loaded, setLoaded] = useState<{
    studentId: string | null;
    rows: GuardianScopeRow[];
    failed: boolean;
  }>({ studentId: null, rows: [], failed: false });
  const loading = loaded.studentId !== studentId;
  const rows = loading ? [] : loaded.rows;
  const failed = !loading && loaded.failed;

  useEffect(() => {
    let live = true;
    listStudentGuardiansAction(studentId).then((result) => {
      if (!live) return;
      setLoaded({
        studentId,
        rows: result.ok ? result.data : [],
        failed: !result.ok,
      });
    });

    return () => {
      live = false;
    };
  }, [studentId]);

  const setScopeAction = async (
    sid: string,
    guardianId: string,
    scope: string[],
  ): Promise<ActionResult<{ guardianId: string; scope: string[] }>> => {
    const result = await setGuardianScopeAction(sid, guardianId, scope);
    return result.ok ? { ok: true, data: { guardianId, scope } } : result;
  };
  const { run: toggleRun, pending } = useAction(setScopeAction, {
    successMessage: t("guardianScopeSaved"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: (data) => setLoaded((current) => ({
      ...current,
      rows: current.rows.map((item) => (
        item.guardianId === data.guardianId ? { ...item, scope: data.scope } : item
      )),
    })),
  });
  const toggle = (row: GuardianScopeRow, key: string) => {
    const scope = row.scope.includes(key)
      ? row.scope.filter((value) => value !== key)
      : [...row.scope, key];
    toggleRun(studentId, row.guardianId, scope);
  };

  return (
    <section className="rounded-2xl border border-line bg-card p-4">
      <h2 className="text-base font-medium text-ink">{t("guardians")}</h2>
      {loading && (
        <p className="mt-2 flex items-center gap-2 text-sm text-muted" aria-live="polite">
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
          {loadingT("loading")}
        </p>
      )}
      {!loading && rows.length === 0 && !failed && (
        <p className="mt-2 text-sm text-muted">{t("noGuardians")}</p>
      )}
      <ul className="mt-3 divide-y divide-line">
        {rows.map((row) => (
          <li key={row.guardianId} className="flex flex-wrap items-center gap-2 py-3">
            <span className="min-w-36 text-sm font-medium">
              {row.displayName}{row.relation ? ` · ${row.relation}` : ""}
            </span>
            {row.isPrimary && <Badge variant="secondary">{t("primaryGuardian")}</Badge>}
            <div
              className="ml-auto flex flex-wrap gap-2"
              role="group"
              aria-label={t("guardianScopeFor", { name: row.displayName })}
            >
              {scopes.map((key) => (
                <Button
                  key={key}
                  type="button"
                  size="sm"
                  disabled={pending}
                  variant={row.scope.includes(key) ? "primary" : "secondary"}
                  aria-pressed={row.scope.includes(key)}
                  onClick={() => toggle(row, key)}
                >
                  {t(`guardianScope_${key}`)}
                </Button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {failed && <p role="alert" className="mt-2 text-xs text-rose">{t("actionFailed")}</p>}
    </section>
  );
}
