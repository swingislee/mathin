"use server";

// ---------------------------------------------------------------------------
// 财务（P4B-6 §5.6）：下单/收款/退费走 security definer RPC，金额一律服务端算，
// 这里只做入参校验 + 权限双闸第二道；表本身不给 insert/update，第三道 RLS 兜底只读。
// 金额校验（非负、有限、上限）在此收口——RLS 挡越权，挡不住合法用户提交负数金额。
// ---------------------------------------------------------------------------

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import {
  COUPON_KINDS,
  PAYMENT_METHODS,
  SCHOLARSHIP_KINDS,
  getStudentAccount,
  listAvailableCouponGrants,
  type CouponGrantOption,
  type CouponKind,
  type PaymentMethod,
  type ScholarshipKind,
  type StudentAccount,
} from "../finance";
import { authorizedClient, financeClient, nullableRpcArg } from "./guards";
import { COMMON_CODES, dateOnly, intInRange, money, parse, requiredText, searchQuery, signedMoney, text, uuid } from "./schemas";
import type { ConsumeRule, OrderItemInput, StudentSearchResult } from "./types";

const placeOrderSchema = z.object({
  studentId: uuid,
  classroomId: uuid.nullable(),
  items: z
    .array(
      z.object({
        name: requiredText(100),
        category: z.enum(["course", "material", "other"]),
        unitPrice: money,
        qty: intInRange(1, 999),
        refundable: z.boolean(),
      }),
    )
    .min(1)
    .max(50),
  kind: z.enum(["enroll", "makeup", "deposit"]),
  couponGrantId: uuid.nullable(),
  remark: text(500),
});

export async function placeOrderAction(input: {
  studentId: string;
  classroomId: string | null;
  items: OrderItemInput[];
  kind: "enroll" | "makeup" | "deposit";
  couponGrantId: string | null;
  remark: string;
}): Promise<ActionResult<string>> {
  try {
    const value = parse(placeOrderSchema, input);
    const { supabase } = await authorizedClient("finance.order.create");
    const { data, error } = await supabase.rpc("place_order", {
      p_student_id: value.studentId,
      p_classroom_id: nullableRpcArg(value.classroomId),
      p_items: value.items.map((item) => ({
        name: item.name,
        category: item.category,
        unit_price: item.unitPrice,
        qty: item.qty,
        refundable: item.refundable,
      })),
      p_kind: value.kind,
      p_coupon_grant_id: value.couponGrantId ?? undefined,
      p_remark: value.remark,
    });
    if (error) throw new Error(error.message);
    return { ok: true, data: data as string };
  } catch (error) {
    return actionError<string>(error, COMMON_CODES);
  }
}

const paymentSchema = z.object({ orderId: uuid, amount: money.positive(), method: z.enum(PAYMENT_METHODS), remark: text(500) });

export async function recordPaymentAction(orderId: string, amount: number, method: PaymentMethod, remark: string): Promise<ActionResult> {
  try {
    const value = parse(paymentSchema, { orderId, amount, method, remark });
    const { supabase } = await authorizedClient("finance.payment.record");
    const { error } = await supabase.rpc("record_payment", {
      p_order_id: value.orderId,
      p_amount: value.amount,
      p_method: value.method,
      p_remark: value.remark,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, COMMON_CODES);
  }
}

const refundSchema = z.object({ orderId: uuid, amount: money.positive(), reason: text(500) });

export async function requestRefundAction(orderId: string, amount: number, reason: string): Promise<ActionResult> {
  try {
    const value = parse(refundSchema, { orderId, amount, reason });
    const { supabase } = await authorizedClient("finance.refund.request");
    const { error } = await supabase.rpc("request_refund", {
      p_order_id: value.orderId,
      p_amount: value.amount,
      p_reason: value.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, COMMON_CODES);
  }
}

export async function approveRefundAction(refundId: string, ok: boolean): Promise<ActionResult> {
  try {
    const value = parse(z.object({ refundId: uuid, ok: z.boolean() }), { refundId, ok });
    const { supabase } = await authorizedClient("finance.refund.approve");
    const { error } = await supabase.rpc("approve_refund", { p_refund_id: value.refundId, p_ok: value.ok });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, COMMON_CODES);
  }
}

const couponSchema = z.object({
  code: requiredText(40),
  name: requiredText(100),
  kind: z.enum(COUPON_KINDS),
  // 折扣券的 value 是百分比，满减券是金额；上限各自不同，故按 kind 分支校验。
  value: money.positive(),
  validFrom: dateOnly.nullable(),
  validTo: dateOnly.nullable(),
}).refine((input) => input.kind !== "percent" || input.value <= 100);

export async function createCouponAction(input: {
  code: string;
  name: string;
  kind: CouponKind;
  value: number;
  validFrom: string | null;
  validTo: string | null;
}): Promise<ActionResult<string>> {
  try {
    const value = parse(couponSchema, input);
    const { supabase } = await authorizedClient("finance.coupon.manage");
    const { data, error } = await supabase.rpc("create_coupon", {
      p_code: value.code,
      p_name: value.name,
      p_kind: value.kind,
      p_value: value.value,
      p_scope: {},
      p_valid_from: value.validFrom ?? undefined,
      p_valid_to: value.validTo ?? undefined,
    });
    if (error) throw new Error(error.message);
    return { ok: true, data: data as string };
  } catch (error) {
    return actionError<string>(error, COMMON_CODES);
  }
}

export async function setCouponStatusAction(couponId: string, status: "enabled" | "disabled"): Promise<ActionResult> {
  try {
    const value = parse(z.object({ couponId: uuid, status: z.enum(["enabled", "disabled"]) }), { couponId, status });
    const { supabase } = await authorizedClient("finance.coupon.manage");
    const { error } = await supabase.rpc("set_coupon_status", { p_coupon_id: value.couponId, p_status: value.status });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, COMMON_CODES);
  }
}

export async function grantCouponAction(couponId: string, studentId: string): Promise<ActionResult> {
  try {
    const value = parse(z.object({ couponId: uuid, studentId: uuid }), { couponId, studentId });
    const { supabase } = await authorizedClient("finance.coupon.manage");
    const { error } = await supabase.rpc("grant_coupon", { p_coupon_id: value.couponId, p_student_id: value.studentId });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, COMMON_CODES);
  }
}

export async function revokeCouponAction(grantId: string): Promise<ActionResult> {
  try {
    const id = parse(uuid, grantId);
    const { supabase } = await authorizedClient("finance.coupon.manage");
    const { error } = await supabase.rpc("revoke_coupon", { p_grant_id: id });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, COMMON_CODES);
  }
}

const scholarshipSchema = z.object({
  studentId: uuid,
  amount: money.positive(),
  kind: z.enum(SCHOLARSHIP_KINDS),
  reason: text(500),
  orderId: uuid.nullable(),
});

export async function grantScholarshipAction(
  studentId: string,
  amount: number,
  kind: ScholarshipKind,
  reason: string,
  orderId: string | null,
): Promise<ActionResult> {
  try {
    const value = parse(scholarshipSchema, { studentId, amount, kind, reason, orderId });
    const { supabase } = await authorizedClient("finance.scholarship.grant");
    const { error } = await supabase.rpc("grant_scholarship", {
      p_student_id: value.studentId,
      p_amount: value.amount,
      p_kind: value.kind,
      p_reason: value.reason,
      p_order_id: value.orderId ?? undefined,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, COMMON_CODES);
  }
}

// 调账是唯一允许负数的金额入口（扣减），故走 signedMoney 而非 money。
const adjustSchema = z.object({ studentId: uuid, delta: signedMoney, reason: text(500) });

export async function adjustAccountAction(studentId: string, delta: number, reason: string): Promise<ActionResult> {
  try {
    const value = parse(adjustSchema, { studentId, delta, reason });
    const { supabase } = await authorizedClient("finance.account.adjust");
    const { error } = await supabase.rpc("adjust_account", {
      p_student_id: value.studentId,
      p_delta: value.delta,
      p_reason: value.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, COMMON_CODES);
  }
}

export async function getConsumeRuleAction(classroomId: string): Promise<ActionResult<ConsumeRule>> {
  try {
    const id = parse(uuid, classroomId);
    const { supabase } = await authorizedClient("finance.account.adjust");
    const { data, error } = await supabase
      .from("consume_rules")
      .select("present_lessons,late_lessons,absent_lessons,leave_lessons")
      .eq("classroom_id", id)
      .maybeSingle<{ present_lessons: number; late_lessons: number; absent_lessons: number; leave_lessons: number }>();
    if (error) throw new Error(error.message);
    return {
      ok: true,
      data: {
        present: data?.present_lessons ?? 1,
        late: data?.late_lessons ?? 1,
        absent: data?.absent_lessons ?? 1,
        leave: data?.leave_lessons ?? 0,
      },
    };
  } catch (error) {
    return actionError<ConsumeRule>(error, COMMON_CODES);
  }
}

const lessonCount = z.number().min(0).max(10);
const consumeRuleSchema = z.object({
  classroomId: uuid,
  rule: z.object({ present: lessonCount, late: lessonCount, absent: lessonCount, leave: lessonCount }),
});

export async function setConsumeRuleAction(classroomId: string, rule: ConsumeRule): Promise<ActionResult> {
  try {
    const value = parse(consumeRuleSchema, { classroomId, rule });
    const { supabase } = await authorizedClient("finance.account.adjust");
    const { error } = await supabase.rpc("set_consume_rule", {
      p_classroom_id: value.classroomId,
      p_present: value.rule.present,
      p_late: value.rule.late,
      p_absent: value.rule.absent,
      p_leave: value.rule.leave,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, COMMON_CODES);
  }
}

export async function getOrderClassroomOptions(): Promise<Array<{ id: string; name: string; courseTitle: string | null }>> {
  const { supabase } = await financeClient(["finance.order.create"]);
  const { data, error } = await supabase.rpc("get_order_classroom_options");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ id: string; name: string; course_title: string | null }>).map((row) => ({
    id: row.id,
    name: row.name || "-",
    courseTitle: row.course_title,
  }));
}

export async function getStudentAccountAction(studentId: string): Promise<StudentAccount> {
  const id = parse(uuid, studentId);
  await financeClient(["finance.order.view", "finance.account.adjust", "finance.scholarship.grant", "finance.coupon.manage"]);
  return getStudentAccount(id);
}

export async function listAvailableCouponGrantsAction(studentId: string): Promise<CouponGrantOption[]> {
  const id = parse(uuid, studentId);
  await authorizedClient("finance.order.create");
  return listAvailableCouponGrants(id);
}

export async function searchStudentsForFinance(query: string): Promise<StudentSearchResult[]> {
  const trimmed = parse(searchQuery, query);
  const { supabase } = await financeClient([
    "finance.order.view",
    "finance.order.create",
    "finance.payment.record",
    "finance.refund.request",
    "finance.refund.approve",
    "finance.coupon.manage",
    "finance.scholarship.grant",
    "finance.account.adjust",
  ]);
  if (!trimmed) return [];
  const escaped = trimmed.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
  const { data, error } = await supabase
    .from("students")
    .select("id,name,grade,status")
    .is("deleted_at", null)
    .ilike("name", `%${escaped}%`)
    .limit(10)
    .returns<StudentSearchResult[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}
