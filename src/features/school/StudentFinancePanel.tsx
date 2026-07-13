"use client";

import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { buttonVariants } from "@/components/ui/button";
import { useAction } from "@/components/action-form";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { fromSelectValue, selectClass, toSelectValue } from "./controls";
import {
  adjustAccountAction,
  approveRefundAction,
  getOrderClassroomOptions,
  grantScholarshipAction,
  listAvailableCouponGrantsAction,
  placeOrderAction,
  recordPaymentAction,
  requestRefundAction,
  type OrderItemInput,
} from "./actions";
import type { CouponGrantOption, OrderDetail, OrderKind, PaymentMethod, ScholarshipKind, StudentAccount } from "./finance";

const DEFAULT_ITEM: OrderItemInput = { name: "", category: "course", unitPrice: 0, qty: 1, refundable: true };

export interface StudentFinancePerms {
  canCreateOrder: boolean;
  canRecordPayment: boolean;
  canRequestRefund: boolean;
  canApproveRefund: boolean;
  canGrantScholarship: boolean;
  canAdjustAccount: boolean;
}

export function StudentFinancePanel({
  studentId,
  orders,
  account,
  perms,
}: {
  studentId: string;
  orders: OrderDetail[];
  account: StudentAccount;
  perms: StudentFinancePerms;
}) {
  const t = useTranslations("school.students");
  const router = useRouter();
  const [approvePending, startApprove] = useTransition();

  const [orderOpen, setOrderOpen] = useState(false);
  const [kind, setKind] = useState<OrderKind>("enroll");
  const [classroomId, setClassroomId] = useState("");
  const [classroomOptions, setClassroomOptions] = useState<Array<{ id: string; name: string; courseTitle: string | null }>>([]);
  const [couponGrantId, setCouponGrantId] = useState("");
  const [couponOptions, setCouponOptions] = useState<CouponGrantOption[]>([]);
  const [items, setItems] = useState<OrderItemInput[]>([{ ...DEFAULT_ITEM, name: t("feeCourse") }]);
  const [orderRemark, setOrderRemark] = useState("");

  const [paymentTarget, setPaymentTarget] = useState<OrderDetail | null>(null);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [paymentRemark, setPaymentRemark] = useState("");

  const [refundTarget, setRefundTarget] = useState<OrderDetail | null>(null);
  const [refundAmount, setRefundAmount] = useState(0);
  const [refundReason, setRefundReason] = useState("");

  const [scholarshipOpen, setScholarshipOpen] = useState(false);
  const [scholarshipAmount, setScholarshipAmount] = useState(0);
  const [scholarshipKind, setScholarshipKind] = useState<ScholarshipKind>("deposit");
  const [scholarshipReason, setScholarshipReason] = useState("");
  const [scholarshipOrderId, setScholarshipOrderId] = useState("");

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustDelta, setAdjustDelta] = useState(0);
  const [adjustReason, setAdjustReason] = useState("");

  const openOrder = async () => {
    setOrderOpen(true);
    setKind("enroll");
    setItems([{ ...DEFAULT_ITEM, name: t("feeCourse") }]);
    setCouponGrantId("");
    setOrderRemark("");
    const [classrooms, coupons] = await Promise.all([getOrderClassroomOptions(), listAvailableCouponGrantsAction(studentId)]);
    setClassroomOptions(classrooms);
    setClassroomId(classrooms[0]?.id ?? "");
    setCouponOptions(coupons);
  };

  const orderRun = useAction(placeOrderAction, {
    successMessage: t("orderPlaced"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => { setOrderOpen(false); router.refresh(); },
  });
  const submitOrder = () => orderRun.run({
    studentId,
    classroomId: kind === "deposit" ? null : classroomId || null,
    items: items.filter((item) => item.name.trim()),
    kind,
    couponGrantId: couponGrantId || null,
    remark: orderRemark,
  });

  const paymentRun = useAction(recordPaymentAction, {
    successMessage: t("paymentRecorded"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => { setPaymentTarget(null); router.refresh(); },
  });
  const submitPayment = () => { if (paymentTarget) paymentRun.run(paymentTarget.id, paymentAmount, paymentMethod, paymentRemark); };

  const refundRun = useAction(requestRefundAction, {
    successMessage: t("refundRequested"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => { setRefundTarget(null); router.refresh(); },
  });
  const submitRefund = () => { if (refundTarget) refundRun.run(refundTarget.id, refundAmount, refundReason); };

  const approveRefund = (refundId: string, ok: boolean) => {
    startApprove(async () => {
      const result = await approveRefundAction(refundId, ok);
      if (result.ok) { toast.success(ok ? t("refundApproved") : t("refundRejected")); router.refresh(); }
      else toast.error(t("actionFailed"));
    });
  };

  const scholarshipRun = useAction(grantScholarshipAction, {
    successMessage: t("scholarshipGranted"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => { setScholarshipOpen(false); router.refresh(); },
  });
  const submitScholarship = () => scholarshipRun.run(studentId, scholarshipAmount, scholarshipKind, scholarshipReason, scholarshipKind === "discount" ? scholarshipOrderId || null : null);

  const adjustRun = useAction(adjustAccountAction, {
    successMessage: t("accountAdjusted"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => { setAdjustOpen(false); router.refresh(); },
  });
  const submitAdjust = () => adjustRun.run(studentId, adjustDelta, adjustReason);

  const pending = orderRun.pending || paymentRun.pending || refundRun.pending || approvePending || scholarshipRun.pending || adjustRun.pending;

  const discountableOrders = orders.filter((o) => o.status === "unpaid" || o.status === "partial");

  return (
    <section className="rounded-xl border border-line bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">{t("finance")}</h2>
        <div className="flex flex-wrap gap-2">
          {perms.canCreateOrder && (
            <button type="button" onClick={() => void openOrder()} className={cn(buttonVariants({ size: "sm" }))}>
              {t("placeOrder")}
            </button>
          )}
          {perms.canGrantScholarship && (
            <button type="button" onClick={() => { setScholarshipOpen(true); setScholarshipOrderId(discountableOrders[0]?.id ?? ""); }} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
              {t("grantScholarship")}
            </button>
          )}
          {perms.canAdjustAccount && (
            <button type="button" onClick={() => setAdjustOpen(true)} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
              {t("adjustAccount")}
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-lg bg-line/40 p-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted">{t("accountBalance")}</span>
          <span className="font-medium">¥{account.balance.toFixed(2)}</span>
        </div>
        {account.ledger.length > 0 && (
          <ul className="mt-2 max-h-32 divide-y divide-line overflow-y-auto text-xs text-muted">
            {account.ledger.slice(0, 10).map((entry, index) => (
              <li key={index} className="flex items-center justify-between gap-2 py-1">
                <span>{entry.reason}{entry.operatorName ? ` · ${entry.operatorName}` : ""}</span>
                <span className={entry.delta >= 0 ? "text-crater" : "text-rose"}>{entry.delta >= 0 ? "+" : ""}{entry.delta.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mt-3 rounded-lg bg-line/40 p-3 text-sm">
        <div className="flex items-center justify-between"><span className="text-xs text-muted">{t("lessonBalance")}</span><span className="font-medium">{account.lessonBalance.toFixed(2)}</span></div>
        {account.lessonLedger.length > 0 && <ul className="mt-2 max-h-32 divide-y divide-line overflow-y-auto text-xs text-muted">{account.lessonLedger.slice(0,10).map((entry,index)=><li key={index} className="flex items-center justify-between gap-2 py-1"><span>{t(entry.status)} · {new Intl.DateTimeFormat(undefined,{dateStyle:"short"}).format(new Date(entry.createdAt))}</span><span className={entry.delta>=0?"text-crater":"text-rose"}>{entry.delta>=0?"+":""}{entry.delta.toFixed(2)}</span></li>)}</ul>}
      </div>

      <div className="mt-4">
        {orders.length === 0 ? (
          <p className="text-sm text-muted">{t("noOrders")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {orders.map((order) => (
              <li key={order.id} className="py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-xs text-muted">{order.orderNo}</span>
                  <span className="rounded-full bg-line/50 px-2 py-0.5 text-xs">{t(order.status)}</span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {order.classroomName ?? t("noClassroom")} · {t(order.kind)}
                </p>
                <p className="mt-1">
                  {t("orderAmounts", { due: order.amountDue.toFixed(2), paid: order.paidTotal.toFixed(2), original: order.amountOriginal.toFixed(2) })}
                </p>
                {order.items.length > 0 && (
                  <p className="mt-1 text-xs text-muted">{order.items.map((item) => `${item.name}×${item.qty}(¥${item.unitPrice})`).join(" / ")}</p>
                )}
                {order.refunds.filter((r) => r.status === "pending").map((refund) => (
                  <div key={refund.id} className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-cheek/20 px-3 py-2 text-xs">
                    <span>{t("refundPending", { amount: refund.amount.toFixed(2), reason: refund.reason })}</span>
                    {perms.canApproveRefund && (
                      <span className="flex gap-2">
                        <button type="button" disabled={pending} onClick={() => approveRefund(refund.id, true)} className="text-crater underline underline-offset-2 disabled:opacity-40">{t("approve")}</button>
                        <button type="button" disabled={pending} onClick={() => approveRefund(refund.id, false)} className="text-rose underline underline-offset-2 disabled:opacity-40">{t("reject")}</button>
                      </span>
                    )}
                  </div>
                ))}
                <div className="mt-2 flex flex-wrap gap-3 text-xs">
                  {perms.canRecordPayment && (order.status === "unpaid" || order.status === "partial") && (
                    <button type="button" onClick={() => { setPaymentTarget(order); setPaymentAmount(Math.max(0, order.amountDue - order.paidTotal)); setPaymentMethod("cash"); setPaymentRemark(""); }} className="text-muted underline underline-offset-2 hover:text-ink">
                      {t("recordPayment")}
                    </button>
                  )}
                  {perms.canRequestRefund && order.status !== "refunding" && order.status !== "void" && order.paidTotal > 0 && (
                    <button type="button" onClick={() => { setRefundTarget(order); setRefundAmount(0); setRefundReason(""); }} className="text-muted underline underline-offset-2 hover:text-ink">
                      {t("requestRefund")}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={orderOpen} onOpenChange={setOrderOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("placeOrderDialogTitle")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Select value={kind} onValueChange={(value) => setKind(value as OrderKind)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="enroll">{t("enroll")}</SelectItem>
                <SelectItem value="makeup">{t("makeup")}</SelectItem>
                <SelectItem value="deposit">{t("deposit")}</SelectItem>
              </SelectContent>
            </Select>
            {kind !== "deposit" && (
              <Select value={toSelectValue(classroomId)} onValueChange={(value) => setClassroomId(fromSelectValue(value))}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={toSelectValue("")}>{t("noClassroom")}</SelectItem>
                  {classroomOptions.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}{c.courseTitle ? ` · ${c.courseTitle}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="space-y-2">
              {items.map((item, index) => (
                <div key={index} className="grid grid-cols-[1fr_80px_70px_50px_auto] items-center gap-1.5">
                  <Input value={item.name} onChange={(e) => setItems(items.map((it, i) => (i === index ? { ...it, name: e.target.value } : it)))} placeholder={t("itemName")} className="px-2 py-1.5" />
                  <Input type="number" value={item.unitPrice} onChange={(e) => setItems(items.map((it, i) => (i === index ? { ...it, unitPrice: Number(e.target.value) } : it)))} className="px-2 py-1.5" />
                  <Input type="number" value={item.qty} min={1} onChange={(e) => setItems(items.map((it, i) => (i === index ? { ...it, qty: Number(e.target.value) || 1 } : it)))} className="px-2 py-1.5" />
                  <Label className="flex items-center justify-center text-xs text-muted font-normal" title={t("refundable")}>
                    <Checkbox checked={item.refundable} onCheckedChange={(checked) => setItems(items.map((it, i) => (i === index ? { ...it, refundable: checked === true } : it)))} />
                  </Label>
                  <button type="button" onClick={() => setItems(items.filter((_, i) => i !== index))} disabled={items.length <= 1} className="text-xs text-muted underline underline-offset-2 disabled:opacity-30">{t("remove")}</button>
                </div>
              ))}
              <button type="button" onClick={() => setItems([...items, { ...DEFAULT_ITEM, name: t("feeMaterial"), category: "material", refundable: false }])} className="text-xs text-crater underline underline-offset-2">
                {t("addItem")}
              </button>
            </div>
            {couponOptions.length > 0 && (
              <Select value={toSelectValue(couponGrantId)} onValueChange={(value) => setCouponGrantId(fromSelectValue(value))}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={toSelectValue("")}>{t("noCoupon")}</SelectItem>
                  {couponOptions.map((c) => (
                    <SelectItem key={c.grantId} value={c.grantId}>{c.couponName}（{c.kind === "amount" ? `-¥${c.value}` : `${c.value}%`}）</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Input value={orderRemark} onChange={(e) => setOrderRemark(e.target.value)} placeholder={t("remark")} className={`w-full ${selectClass}`} />
          </div>
          <DialogFooter>
            <button type="button" onClick={() => setOrderOpen(false)} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>{t("cancel")}</button>
            <button type="button" disabled={pending} onClick={submitOrder} className={cn(buttonVariants({ size: "sm" }))}>{t("confirm")}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(paymentTarget)} onOpenChange={(open) => !open && setPaymentTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("recordPaymentDialogTitle", { orderNo: paymentTarget?.orderNo ?? "" })}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input type="number" value={paymentAmount} onChange={(e) => setPaymentAmount(Number(e.target.value))} className={`w-full ${selectClass}`} />
            <Select value={paymentMethod} onValueChange={(value) => setPaymentMethod(value as PaymentMethod)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">{t("cash")}</SelectItem>
                <SelectItem value="scan">{t("scan")}</SelectItem>
                <SelectItem value="transfer">{t("transfer")}</SelectItem>
                <SelectItem value="account">{t("account")}</SelectItem>
              </SelectContent>
            </Select>
            <Input value={paymentRemark} onChange={(e) => setPaymentRemark(e.target.value)} placeholder={t("remark")} className={`w-full ${selectClass}`} />
          </div>
          <DialogFooter>
            <button type="button" onClick={() => setPaymentTarget(null)} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>{t("cancel")}</button>
            <button type="button" disabled={pending || paymentAmount <= 0} onClick={submitPayment} className={cn(buttonVariants({ size: "sm" }))}>{t("confirm")}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(refundTarget)} onOpenChange={(open) => !open && setRefundTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("requestRefundDialogTitle", { orderNo: refundTarget?.orderNo ?? "" })}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input type="number" value={refundAmount} onChange={(e) => setRefundAmount(Number(e.target.value))} className={`w-full ${selectClass}`} />
            <Input value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder={t("refundReason")} className={`w-full ${selectClass}`} />
          </div>
          <DialogFooter>
            <button type="button" onClick={() => setRefundTarget(null)} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>{t("cancel")}</button>
            <button type="button" disabled={pending || refundAmount <= 0} onClick={submitRefund} className={cn(buttonVariants({ size: "sm" }))}>{t("confirm")}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={scholarshipOpen} onOpenChange={setScholarshipOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("grantScholarshipDialogTitle")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Select value={scholarshipKind} onValueChange={(value) => setScholarshipKind(value as ScholarshipKind)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="deposit">{t("scholarshipDeposit")}</SelectItem>
                <SelectItem value="discount">{t("scholarshipDiscount")}</SelectItem>
              </SelectContent>
            </Select>
            {scholarshipKind === "discount" && (
              <Select value={toSelectValue(scholarshipOrderId)} onValueChange={(value) => setScholarshipOrderId(fromSelectValue(value))}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {discountableOrders.length === 0 && <SelectItem value={toSelectValue("")}>{t("noOrders")}</SelectItem>}
                  {discountableOrders.map((o) => <SelectItem key={o.id} value={o.id}>{o.orderNo}（¥{o.amountDue.toFixed(2)}）</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Input type="number" value={scholarshipAmount} onChange={(e) => setScholarshipAmount(Number(e.target.value))} className={`w-full ${selectClass}`} />
            <Input value={scholarshipReason} onChange={(e) => setScholarshipReason(e.target.value)} placeholder={t("remark")} className={`w-full ${selectClass}`} />
          </div>
          <DialogFooter>
            <button type="button" onClick={() => setScholarshipOpen(false)} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>{t("cancel")}</button>
            <button type="button" disabled={pending || scholarshipAmount <= 0 || (scholarshipKind === "discount" && !scholarshipOrderId)} onClick={submitScholarship} className={cn(buttonVariants({ size: "sm" }))}>{t("confirm")}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("adjustAccountDialogTitle")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input type="number" value={adjustDelta} onChange={(e) => setAdjustDelta(Number(e.target.value))} placeholder={t("adjustDeltaHint")} className={`w-full ${selectClass}`} />
            <Input value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder={t("remark")} className={`w-full ${selectClass}`} />
          </div>
          <DialogFooter>
            <button type="button" onClick={() => setAdjustOpen(false)} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>{t("cancel")}</button>
            <button type="button" disabled={pending || adjustDelta === 0} onClick={submitAdjust} className={cn(buttonVariants({ size: "sm" }))}>{t("confirm")}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
