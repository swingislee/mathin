import { createClient } from "@/lib/supabase/server";

export const ORDER_KINDS = ["enroll", "makeup", "deposit"] as const;
export const ORDER_STATUSES = ["unpaid", "partial", "paid", "refunding", "refunded", "void"] as const;
export const PAYMENT_METHODS = ["cash", "scan", "transfer", "account"] as const;
export const REFUND_STATUSES = ["pending", "approved", "rejected", "done"] as const;
export const COUPON_KINDS = ["amount", "percent"] as const;
export const SCHOLARSHIP_KINDS = ["discount", "deposit"] as const;

export type OrderKind = (typeof ORDER_KINDS)[number];
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type RefundStatus = (typeof REFUND_STATUSES)[number];
export type CouponKind = (typeof COUPON_KINDS)[number];
export type ScholarshipKind = (typeof SCHOLARSHIP_KINDS)[number];

export interface OrderItemRow {
  id: string;
  name: string;
  category: string;
  unitPrice: number;
  qty: number;
  refundable: boolean;
}

export interface PaymentRow {
  id: string;
  amount: number;
  method: PaymentMethod;
  paidAt: string;
  operatorName: string;
  remark: string;
}

export interface RefundRow {
  id: string;
  orderId: string;
  amount: number;
  reason: string;
  status: RefundStatus;
  requestedByName: string;
  requestedAt: string;
  approvedByName: string;
  approvedAt: string | null;
}

export interface OrderSummary {
  id: string;
  orderNo: string;
  studentId: string;
  studentName: string;
  classroomId: string | null;
  classroomName: string | null;
  kind: OrderKind;
  amountOriginal: number;
  amountDiscount: number;
  amountDue: number;
  status: OrderStatus;
  remark: string;
  createdAt: string;
  paidTotal: number;
}

export interface OrderDetail extends OrderSummary {
  items: OrderItemRow[];
  payments: PaymentRow[];
  refunds: RefundRow[];
}

interface OrderDetailRow {
  id: string;
  order_no: string;
  student_id: string;
  classroom_id: string | null;
  kind: OrderKind;
  amount_original: number;
  amount_discount: number;
  amount_due: number;
  status: OrderStatus;
  remark: string;
  created_at: string;
  students: { name: string } | null;
  classrooms: { name: string } | null;
  order_items: Array<{ id: string; name: string; category: string; unit_price: number; qty: number; refundable: boolean }>;
  payments: Array<{ id: string; amount: number; method: PaymentMethod; paid_at: string; remark: string; profiles: { display_name: string } | null }>;
  refunds: Array<{
    id: string;
    order_id: string;
    amount: number;
    reason: string;
    status: RefundStatus;
    requested_at: string;
    approved_at: string | null;
    requester: { display_name: string } | null;
    approver: { display_name: string } | null;
  }>;
}

const ORDER_DETAIL_SELECT = `
  id, order_no, student_id, classroom_id, kind, amount_original, amount_discount, amount_due, status, remark, created_at,
  students(name), classrooms(name),
  order_items(id,name,category,unit_price,qty,refundable),
  payments(id,amount,method,paid_at,remark,profiles(display_name)),
  refunds(id,order_id,amount,reason,status,requested_at,approved_at,requester:profiles!refunds_requested_by_fkey(display_name),approver:profiles!refunds_approved_by_fkey(display_name))
`;

function toOrderDetail(row: OrderDetailRow): OrderDetail {
  const paidTotal = (row.payments ?? []).reduce((sum, p) => sum + p.amount, 0);
  return {
    id: row.id,
    orderNo: row.order_no,
    studentId: row.student_id,
    studentName: row.students?.name || "-",
    classroomId: row.classroom_id,
    classroomName: row.classrooms?.name ?? null,
    kind: row.kind,
    amountOriginal: row.amount_original,
    amountDiscount: row.amount_discount,
    amountDue: row.amount_due,
    status: row.status,
    remark: row.remark,
    createdAt: row.created_at,
    paidTotal,
    items: (row.order_items ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      unitPrice: item.unit_price,
      qty: item.qty,
      refundable: item.refundable,
    })),
    payments: (row.payments ?? [])
      .map((p) => ({
        id: p.id,
        amount: p.amount,
        method: p.method,
        paidAt: p.paid_at,
        operatorName: p.profiles?.display_name || "",
        remark: p.remark,
      }))
      .sort((a, b) => (a.paidAt < b.paidAt ? 1 : -1)),
    refunds: (row.refunds ?? [])
      .map((r) => ({
        id: r.id,
        orderId: r.order_id,
        amount: r.amount,
        reason: r.reason,
        status: r.status,
        requestedByName: r.requester?.display_name || "",
        requestedAt: r.requested_at,
        approvedByName: r.approver?.display_name || "",
        approvedAt: r.approved_at,
      }))
      .sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1)),
  };
}

export async function getStudentOrders(studentId: string): Promise<OrderDetail[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_DETAIL_SELECT)
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .returns<OrderDetailRow[]>();
  if (error) throw new Error(error.message);
  return (data ?? []).map(toOrderDetail);
}

export interface OrderFilters {
  q?: string;
  status?: OrderStatus;
  page: number;
}

const PAGE_SIZE = 20;

export function parseOrderFilters(searchParams: Record<string, string | string[] | undefined>): OrderFilters {
  const pick = (key: string) => {
    const value = searchParams[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const status = pick("status");
  const page = Math.max(1, Number(pick("page")) || 1);
  return {
    q: pick("q")?.trim().slice(0, 80) || undefined,
    status: ORDER_STATUSES.includes(status as OrderStatus) ? (status as OrderStatus) : undefined,
    page,
  };
}

export async function listOrders(filters: OrderFilters): Promise<{ orders: OrderSummary[]; count: number | null }> {
  const supabase = await createClient();
  const from = (filters.page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  let query = supabase
    .from("orders")
    .select(
      "id,order_no,student_id,classroom_id,kind,amount_original,amount_discount,amount_due,status,remark,created_at,students(name),classrooms(name),payments(amount)",
      { count: "estimated" },
    );
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.q) {
    const escaped = filters.q.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
    // 顶层 .or() 不可靠地支持内嵌资源列（students.name），改为先查匹配的学生 id
    // 再并入 or 子句，避免依赖 PostgREST 对跨表 or 的隐式 inner join 行为。
    const { data: matchedStudents, error: studentError } = await supabase
      .from("students")
      .select("id")
      .is("deleted_at", null)
      .ilike("name", `%${escaped}%`)
      .limit(50)
      .returns<Array<{ id: string }>>();
    if (studentError) throw new Error(studentError.message);
    const studentIds = (matchedStudents ?? []).map((row) => row.id);
    const orParts = [`order_no.ilike.%${escaped}%`];
    if (studentIds.length > 0) orParts.push(`student_id.in.(${studentIds.join(",")})`);
    query = query.or(orParts.join(","));
  }
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(from, to)
    .returns<Array<Omit<OrderDetailRow, "order_items" | "refunds">>>();
  if (error) throw new Error(error.message);
  return {
    orders: (data ?? []).map((row) => ({
      id: row.id,
      orderNo: row.order_no,
      studentId: row.student_id,
      studentName: row.students?.name || "-",
      classroomId: row.classroom_id,
      classroomName: row.classrooms?.name ?? null,
      kind: row.kind,
      amountOriginal: row.amount_original,
      amountDiscount: row.amount_discount,
      amountDue: row.amount_due,
      status: row.status,
      remark: row.remark,
      createdAt: row.created_at,
      paidTotal: (row.payments ?? []).reduce((sum, p) => sum + p.amount, 0),
    })),
    count,
  };
}

export interface PendingRefundRow {
  id: string;
  orderId: string;
  orderNo: string;
  studentName: string;
  amount: number;
  reason: string;
  requestedByName: string;
  requestedAt: string;
}

export async function listPendingRefunds(): Promise<PendingRefundRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("refunds")
    .select("id,order_id,amount,reason,requested_at,orders(order_no,students(name)),requester:profiles!refunds_requested_by_fkey(display_name)")
    .eq("status", "pending")
    .order("requested_at", { ascending: true })
    .returns<
      Array<{
        id: string;
        order_id: string;
        amount: number;
        reason: string;
        requested_at: string;
        orders: { order_no: string; students: { name: string } | null } | null;
        requester: { display_name: string } | null;
      }>
    >();
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    orderId: row.order_id,
    orderNo: row.orders?.order_no || "-",
    studentName: row.orders?.students?.name || "-",
    amount: row.amount,
    reason: row.reason,
    requestedByName: row.requester?.display_name || "",
    requestedAt: row.requested_at,
  }));
}

export async function countPendingRefunds(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase.from("refunds").select("*", { count: "exact", head: true }).eq("status", "pending");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export interface CouponRow {
  id: string;
  code: string | null;
  name: string;
  kind: CouponKind;
  value: number;
  status: "enabled" | "disabled";
  validFrom: string | null;
  validTo: string | null;
  createdAt: string;
}

export async function listCoupons(): Promise<CouponRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("coupons")
    .select("id,code,name,kind,value,status,valid_from,valid_to,created_at")
    .order("created_at", { ascending: false })
    .returns<Array<{ id: string; code: string | null; name: string; kind: CouponKind; value: number; status: "enabled" | "disabled"; valid_from: string | null; valid_to: string | null; created_at: string }>>();
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind,
    value: row.value,
    status: row.status,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    createdAt: row.created_at,
  }));
}

export interface CouponGrantOption {
  grantId: string;
  couponId: string;
  couponName: string;
  kind: CouponKind;
  value: number;
}

export async function listAvailableCouponGrants(studentId: string): Promise<CouponGrantOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("coupon_grants")
    .select("id,coupon_id,coupons(name,kind,value)")
    .eq("student_id", studentId)
    .eq("status", "granted")
    .returns<Array<{ id: string; coupon_id: string; coupons: { name: string; kind: CouponKind; value: number } | null }>>();
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((row) => row.coupons)
    .map((row) => ({
      grantId: row.id,
      couponId: row.coupon_id,
      couponName: row.coupons?.name || "-",
      kind: row.coupons?.kind ?? "amount",
      value: row.coupons?.value ?? 0,
    }));
}

export interface ScholarshipRow {
  id: string;
  studentId: string;
  studentName: string;
  amount: number;
  kind: ScholarshipKind;
  reason: string;
  grantedByName: string;
  grantedAt: string;
}

export async function listScholarships(limit = 50): Promise<ScholarshipRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("scholarships")
    .select("id,student_id,amount,kind,reason,granted_at,students(name),profiles!scholarships_granted_by_fkey(display_name)")
    .order("granted_at", { ascending: false })
    .limit(limit)
    .returns<
      Array<{
        id: string;
        student_id: string;
        amount: number;
        kind: ScholarshipKind;
        reason: string;
        granted_at: string;
        students: { name: string } | null;
        profiles: { display_name: string } | null;
      }>
    >();
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    studentId: row.student_id,
    studentName: row.students?.name || "-",
    amount: row.amount,
    kind: row.kind,
    reason: row.reason,
    grantedByName: row.profiles?.display_name || "",
    grantedAt: row.granted_at,
  }));
}

export interface LedgerEntry {
  delta: number;
  reason: string;
  operatorName: string;
  createdAt: string;
}

export interface StudentAccount {
  studentId: string;
  balance: number;
  ledger: LedgerEntry[];
  lessonBalance: number;
  lessonLedger: Array<{ delta: number; status: string; createdAt: string }>;
}

export async function getStudentAccount(studentId: string): Promise<StudentAccount> {
  const supabase = await createClient();
  const [{ data: accountRow, error: accountError }, { data: ledgerRows, error: ledgerError }, { data: lessonRows, error: lessonError }] = await Promise.all([
    supabase.from("student_accounts").select("balance,lesson_balance").eq("student_id", studentId).maybeSingle<{ balance: number; lesson_balance: number }>(),
    supabase
      .from("account_ledger")
      .select("delta,reason,created_at,profiles(display_name)")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false })
      .limit(50)
      .returns<Array<{ delta: number; reason: string; created_at: string; profiles: { display_name: string } | null }>>(),
    supabase.from("lesson_ledger").select("lesson_delta,attendance_status,created_at").eq("student_id", studentId).order("created_at", { ascending: false }).limit(50)
      .returns<Array<{ lesson_delta: number; attendance_status: string; created_at: string }>>(),
  ]);
  if (accountError) throw new Error(accountError.message);
  if (ledgerError) throw new Error(ledgerError.message);
  if (lessonError) throw new Error(lessonError.message);
  return {
    studentId,
    balance: accountRow?.balance ?? 0,
    lessonBalance: accountRow?.lesson_balance ?? 0,
    ledger: (ledgerRows ?? []).map((row) => ({
      delta: row.delta,
      reason: row.reason,
      operatorName: row.profiles?.display_name || "",
      createdAt: row.created_at,
    })),
    lessonLedger: (lessonRows ?? []).map((row) => ({ delta: row.lesson_delta, status: row.attendance_status, createdAt: row.created_at })),
  };
}
