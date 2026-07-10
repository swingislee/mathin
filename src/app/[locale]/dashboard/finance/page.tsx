import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AccountLookupPanel } from "@/features/school/AccountLookupPanel";
import { CouponsPanel } from "@/features/school/CouponsPanel";
import { getMyAccounts, getMyOrders } from "@/features/school/customer";
import { listCoupons, listOrders, listPendingRefunds, listScholarships, parseOrderFilters } from "@/features/school/finance";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import type { PermissionKey } from "@/features/school/permissions";
import { RefundQueuePanel } from "@/features/school/RefundQueuePanel";
import { ScholarshipsPanel } from "@/features/school/ScholarshipsPanel";
import { Link } from "@/i18n/navigation";
import { getMyPerms, getProfile, requireUser } from "@/lib/auth";

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

const FINANCE_PERM_KEYS: readonly PermissionKey[] = [
  "finance.order.view",
  "finance.order.create",
  "finance.payment.record",
  "finance.refund.approve",
  "finance.coupon.manage",
  "finance.scholarship.grant",
  "finance.account.adjust",
  "finance.report.view",
];

export default async function FinancePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, rawSearchParams] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const user = await requireUser(locale);
  const profile = await getProfile(user.id);
  const perms = await getMyPerms(user.id);
  const hasFinancePerm = FINANCE_PERM_KEYS.some((key) => perms.has(key));

  // 学生端去财务（P4C-1 §4.4）：家长管钱，学生直接踢回总览。家长只读分支保留。
  if (profile?.role === "student") {
    redirect(`/${locale}/dashboard`);
  }

  if (!hasFinancePerm && profile?.role === "parent") {
    const customerT = await getTranslations("school.customer");
    const financeT = await getTranslations("school.finance");
    const [orders, accounts] = await Promise.all([safe(getMyOrders, []), safe(getMyAccounts, [])]);
    const balance = accounts[0]?.balance ?? 0;

    return (
      <div className="mx-auto w-full max-w-3xl">
        <SchoolPageHeader title={customerT("myFinanceTitle")} />
        <section className="mt-6 rounded-2xl border bg-card p-5">
          <p className="text-sm">{customerT("myBalance", { balance: balance.toFixed(2) })}</p>
          {orders.length === 0 ? (
            <p className="mt-4 text-sm text-muted">{customerT("myOrdersEmpty")}</p>
          ) : (
            <ul className="mt-4 divide-y">
              {orders.map((order) => (
                <li key={order.orderId} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted">{order.orderNo}</span>
                  <span className="shrink-0 text-xs text-muted">
                    ¥{order.paidTotal.toFixed(2)}/{order.amountDue.toFixed(2)}
                  </span>
                  <span className="shrink-0 rounded-full bg-line/50 px-2 py-0.5 text-xs text-muted">{financeT(order.status)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  if (!hasFinancePerm) redirect(`/${locale}/dashboard`);

  const t = await getTranslations("school.finance");

  const canSeeOrders = perms.has("finance.order.view") || perms.has("finance.order.create") || perms.has("finance.payment.record");
  const canApproveRefunds = perms.has("finance.refund.approve");
  const canManageCoupons = perms.has("finance.coupon.manage");
  const canSeeScholarships = perms.has("finance.scholarship.grant") || perms.has("finance.order.view");
  const canSeeAccounts = perms.has("finance.account.adjust") || perms.has("finance.order.view") || perms.has("finance.scholarship.grant") || perms.has("finance.coupon.manage");

  const filters = parseOrderFilters(rawSearchParams);
  const [ordersResult, pendingRefunds, coupons, scholarships] = await Promise.all([
    canSeeOrders ? listOrders(filters) : Promise.resolve({ orders: [], count: 0 }),
    canApproveRefunds ? listPendingRefunds() : Promise.resolve([]),
    canManageCoupons ? listCoupons() : Promise.resolve([]),
    canSeeScholarships ? listScholarships() : Promise.resolve([]),
  ]);

  const pageHref = (page: number) => {
    const query = new URLSearchParams();
    if (filters.q) query.set("q", filters.q);
    if (filters.status) query.set("status", filters.status);
    if (page > 1) query.set("page", String(page));
    const qs = query.toString();
    return `/dashboard/finance${qs ? `?${qs}` : ""}`;
  };
  const maxPage = ordersResult.count ? Math.max(1, Math.ceil(ordersResult.count / 20)) : filters.page;

  return (
    <div className="mx-auto w-full max-w-6xl">
      <SchoolPageHeader title={t("title")}>
        <p className="mt-1 max-w-3xl text-sm text-muted">{t("intro")}</p>
      </SchoolPageHeader>

      <div className="mt-6 grid gap-6">
        {canSeeOrders && (
          <section className="rounded-xl border border-line bg-card p-5">
            <h2 className="font-medium">{t("orders", { count: ordersResult.count ?? ordersResult.orders.length })}</h2>
            <form className="mt-3 flex gap-2">
              <input name="q" defaultValue={filters.q} placeholder={t("searchOrder")} className="min-w-0 flex-1 rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-crater" />
              <button type="submit" className="rounded-lg border border-line px-3 py-2 text-sm">{t("filter")}</button>
            </form>
            {ordersResult.orders.length === 0 ? (
              <p className="mt-4 text-sm text-muted">{t("noOrders")}</p>
            ) : (
              <ul className="mt-4 divide-y divide-line">
                {ordersResult.orders.map((order) => (
                  <li key={order.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                    <div className="min-w-0">
                      <Link href={`/dashboard/students/${order.studentId}`} className="font-medium hover:underline">{order.studentName}</Link>
                      <span className="ml-2 font-mono text-xs text-muted">{order.orderNo}</span>
                    </div>
                    <span className="shrink-0 text-xs text-muted">
                      ¥{order.paidTotal.toFixed(2)}/{order.amountDue.toFixed(2)} · {t(order.status)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex justify-end gap-2">
              {filters.page > 1 && <Link href={pageHref(filters.page - 1)} className="rounded-lg border border-line px-3 py-1.5 text-xs">{t("previous")}</Link>}
              {filters.page < maxPage && <Link href={pageHref(filters.page + 1)} className="rounded-lg border border-line px-3 py-1.5 text-xs">{t("next")}</Link>}
            </div>
          </section>
        )}

        {canApproveRefunds && <RefundQueuePanel refunds={pendingRefunds} />}
        {canManageCoupons && <CouponsPanel coupons={coupons} />}
        {canSeeScholarships && <ScholarshipsPanel scholarships={scholarships} />}
        {canSeeAccounts && <AccountLookupPanel canAdjust={perms.has("finance.account.adjust")} />}
      </div>
    </div>
  );
}
