"use client";

import { Input } from "@/components/ui/input";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { adjustAccountAction, getStudentAccountAction, searchStudentsForFinance, type StudentSearchResult } from "./actions";
import type { StudentAccount } from "./finance";

export function AccountLookupPanel({ canAdjust }: { canAdjust: boolean }) {
  const t = useTranslations("school.finance");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StudentSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<StudentSearchResult | null>(null);
  const [account, setAccount] = useState<StudentAccount | null>(null);

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [delta, setDelta] = useState(0);
  const [reason, setReason] = useState("");

  const search = async (value: string) => {
    setQuery(value);
    if (!value.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      setResults(await searchStudentsForFinance(value));
    } finally {
      setSearching(false);
    }
  };

  const select = (student: StudentSearchResult) => {
    setError(null);
    setSelected(student);
    setResults([]);
    setQuery("");
    startTransition(async () => {
      try {
        setAccount(await getStudentAccountAction(student.id));
      } catch {
        setError(t("actionFailed"));
      }
    });
  };

  const submitAdjust = () => {
    if (!selected) return;
    setError(null);
    startTransition(async () => {
      try {
        await adjustAccountAction(selected.id, delta, reason);
        setAccount(await getStudentAccountAction(selected.id));
        setAdjustOpen(false);
        setDelta(0);
        setReason("");
      } catch {
        setError(t("actionFailed"));
      }
    });
  };

  return (
    <section className="rounded-xl border border-line bg-card p-5">
      <h2 className="font-medium">{t("accounts")}</h2>
      {error && <p className="mt-3 text-xs text-rose">{error}</p>}
      <Input
        value={query}
        onChange={(event) => void search(event.target.value)}
        placeholder={t("searchStudent")}
        className="mt-3"
      />
      {results.length > 0 && (
        <ul className="mt-2 max-h-40 divide-y divide-line overflow-y-auto">
          {results.map((student) => (
            <li key={student.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>{student.name}</span>
              <button type="button" onClick={() => select(student)} className="text-xs text-crater underline underline-offset-2">{t("select")}</button>
            </li>
          ))}
        </ul>
      )}
      {searching && <p className="mt-2 text-xs text-muted">{t("searching")}</p>}

      {selected && account && (
        <div className="mt-4 rounded-lg bg-line/40 p-3 text-sm">
          <div className="flex items-center justify-between">
            <span>{selected.name}</span>
            <span className="flex items-center gap-3">
              <span className="font-medium">¥{account.balance.toFixed(2)}</span>
              {canAdjust && (
                <button type="button" onClick={() => setAdjustOpen(true)} className="text-xs text-crater underline underline-offset-2">{t("adjustAccount")}</button>
              )}
            </span>
          </div>
          {account.ledger.length > 0 && (
            <ul className="mt-2 max-h-40 divide-y divide-line overflow-y-auto text-xs text-muted">
              {account.ledger.map((entry, index) => (
                <li key={index} className="flex items-center justify-between gap-2 py-1">
                  <span>{entry.reason}{entry.operatorName ? ` · ${entry.operatorName}` : ""}</span>
                  <span className={entry.delta >= 0 ? "text-crater" : "text-rose"}>{entry.delta >= 0 ? "+" : ""}{entry.delta.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("adjustAccountDialogTitle")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input type="number" value={delta} onChange={(e) => setDelta(Number(e.target.value))} placeholder={t("adjustDeltaHint")} />
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("remark")} />
          </div>
          <DialogFooter>
            <button type="button" onClick={() => setAdjustOpen(false)} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>{t("cancel")}</button>
            <button type="button" disabled={pending || delta === 0} onClick={submitAdjust} className={cn(buttonVariants({ size: "sm" }))}>{t("confirm")}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
