"use client";

import { Input } from "@/components/ui/input";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { useAction } from "@/components/action-form";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { grantScholarshipAction, searchStudentsForFinance, type StudentSearchResult } from "./actions";
import type { ScholarshipRow } from "./finance";

export function ScholarshipsPanel({ scholarships }: { scholarships: ScholarshipRow[] }) {
  const t = useTranslations("school.finance");
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StudentSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<StudentSearchResult | null>(null);
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState("");

  const search = async (value: string) => {
    setQuery(value);
    setSelected(null);
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

  const { run: submitRun, pending } = useAction(grantScholarshipAction, {
    successMessage: t("scholarshipGranted"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => { setOpen(false); setQuery(""); setResults([]); setSelected(null); setAmount(0); setReason(""); router.refresh(); },
  });
  const submit = () => { if (selected) submitRun(selected.id, amount, "deposit", reason, null); };

  return (
    <section className="rounded-xl border border-line bg-card p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">{t("scholarships")}</h2>
        <button type="button" onClick={() => setOpen(true)} className={cn(buttonVariants({ size: "sm" }))}>{t("grantScholarship")}</button>
      </div>
      {scholarships.length === 0 ? (
        <p className="mt-4 text-sm text-muted">{t("noScholarships")}</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {scholarships.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span>{row.studentName} · {t(row.kind === "deposit" ? "scholarshipDeposit" : "scholarshipDiscount")}</span>
              <span className="text-xs text-muted">¥{row.amount.toFixed(2)} · {row.grantedByName}</span>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("grantScholarshipDialogTitle")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input
              value={query}
              onChange={(event) => void search(event.target.value)}
              placeholder={t("searchStudent")}
            />
            {!selected && (
              <div className="max-h-40 overflow-y-auto">
                {searching && <p className="px-1 py-2 text-xs text-muted">{t("searching")}</p>}
                {!searching && query && results.length === 0 && <p className="px-1 py-2 text-xs text-muted">{t("noMatch")}</p>}
                <ul className="divide-y divide-line">
                  {results.map((student) => (
                    <li key={student.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span>{student.name}</span>
                      <button type="button" onClick={() => setSelected(student)} className="text-xs text-crater underline underline-offset-2">{t("select")}</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {selected && <p className="text-sm">{t("selectedStudent", { name: selected.name })}</p>}
            <Input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} placeholder={t("amount")} />
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("remark")} />
          </div>
          <DialogFooter>
            <button type="button" onClick={() => setOpen(false)} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>{t("cancel")}</button>
            <button type="button" disabled={pending || !selected || amount <= 0} onClick={submit} className={cn(buttonVariants({ size: "sm" }))}>{t("confirm")}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
