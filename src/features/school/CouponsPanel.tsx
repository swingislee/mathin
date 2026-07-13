"use client";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { buttonVariants } from "@/components/ui/button";
import { useAction } from "@/components/action-form";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { createCouponAction, grantCouponAction, searchStudentsForFinance, setCouponStatusAction, type StudentSearchResult } from "./actions";
import { selectClass } from "./controls";
import type { CouponKind, CouponRow } from "./finance";

export function CouponsPanel({ coupons }: { coupons: CouponRow[] }) {
  const t = useTranslations("school.finance");
  const router = useRouter();

  const [createOpen, setCreateOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<CouponKind>("amount");
  const [value, setValue] = useState(0);

  const [grantTarget, setGrantTarget] = useState<CouponRow | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StudentSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const [togglePending, startToggle] = useTransition();
  const toggle = (coupon: CouponRow) => {
    const next = coupon.status === "enabled" ? "disabled" : "enabled";
    startToggle(async () => {
      const result = await setCouponStatusAction(coupon.id, next);
      if (result.ok) { toast.success(next === "enabled" ? t("couponEnabled") : t("couponDisabled")); router.refresh(); }
      else toast.error(t("actionFailed"));
    });
  };

  const createRun = useAction(createCouponAction, {
    successMessage: t("couponCreated"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => { setCreateOpen(false); setCode(""); setName(""); setValue(0); router.refresh(); },
  });
  const submitCreate = () => createRun.run({ code, name, kind, value, validFrom: null, validTo: null });

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

  const grantRun = useAction(grantCouponAction, {
    successMessage: t("couponGranted"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => { setGrantTarget(null); setQuery(""); setResults([]); router.refresh(); },
  });
  const grant = (studentId: string) => { if (grantTarget) grantRun.run(grantTarget.id, studentId); };

  const pending = togglePending || createRun.pending || grantRun.pending;

  return (
    <section className="rounded-xl border border-line bg-card p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">{t("coupons", { count: coupons.length })}</h2>
        <button type="button" onClick={() => setCreateOpen(true)} className={cn(buttonVariants({ size: "sm" }))}>{t("createCoupon")}</button>
      </div>
      {coupons.length === 0 ? (
        <p className="mt-4 text-sm text-muted">{t("noCoupons")}</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {coupons.map((coupon) => (
            <li key={coupon.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
              <div className="min-w-0">
                <p>{coupon.name}{coupon.code ? ` · ${coupon.code}` : ""}</p>
                <p className="text-xs text-muted">{coupon.kind === "amount" ? `-¥${coupon.value}` : `${coupon.value}%`} · {t(coupon.status)}</p>
              </div>
              <span className="flex shrink-0 gap-3 text-xs">
                <button type="button" disabled={pending} onClick={() => setGrantTarget(coupon)} className="text-crater underline underline-offset-2 disabled:opacity-40">{t("grant")}</button>
                <button type="button" disabled={pending} onClick={() => toggle(coupon)} className="text-muted underline underline-offset-2 disabled:opacity-40">
                  {coupon.status === "enabled" ? t("disable") : t("enable")}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("createCouponDialogTitle")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("couponName")} className={`w-full ${selectClass}`} />
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t("couponCode")} className={`w-full ${selectClass}`} />
            <Select value={kind} onValueChange={(value) => setKind(value as CouponKind)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="amount">{t("couponAmount")}</SelectItem>
                <SelectItem value="percent">{t("couponPercent")}</SelectItem>
              </SelectContent>
            </Select>
            <Input type="number" value={value} onChange={(e) => setValue(Number(e.target.value))} className={`w-full ${selectClass}`} />
          </div>
          <DialogFooter>
            <button type="button" onClick={() => setCreateOpen(false)} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>{t("cancel")}</button>
            <button type="button" disabled={pending || !name.trim() || value <= 0} onClick={submitCreate} className={cn(buttonVariants({ size: "sm" }))}>{t("confirm")}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(grantTarget)} onOpenChange={(open) => !open && setGrantTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("grantCouponDialogTitle", { name: grantTarget?.name ?? "" })}</DialogTitle></DialogHeader>
          <Input
            value={query}
            onChange={(event) => void search(event.target.value)}
            placeholder={t("searchStudent")}
            className={`w-full ${selectClass}`}
          />
          <div className="mt-2 max-h-64 overflow-y-auto">
            {searching && <p className="px-1 py-2 text-xs text-muted">{t("searching")}</p>}
            {!searching && query && results.length === 0 && <p className="px-1 py-2 text-xs text-muted">{t("noMatch")}</p>}
            <ul className="divide-y divide-line">
              {results.map((student) => (
                <li key={student.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span>{student.name}</span>
                  <button type="button" disabled={pending} onClick={() => grant(student.id)} className="text-xs text-crater underline underline-offset-2 disabled:opacity-40">{t("grant")}</button>
                </li>
              ))}
            </ul>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
