import { Select, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AccountLookupPanel } from "@/features/school/AccountLookupPanel";
import { CouponsPanel } from "@/features/school/CouponsPanel";
import { getMyAccounts, getMyOrders } from "@/features/school/customer";
import { getFinanceOverview, type FinanceOverview } from "@/features/school/dashboard";
import { countPendingRefunds, listCoupons, listOrders, listPendingRefunds, listScholarships, ORDER_STATUSES, parseOrderFilters } from "@/features/school/finance";
import { toSelectValue } from "@/features/school/controls";
import {
  DashboardAside,
  DashboardCommandFilters,
  DashboardCommandPanel,
  DashboardContentGrid,
  DashboardMainColumn,
  DashboardPage,
} from "@/features/school/dashboard-page";
import { FilterBar, FilterBarReset, FilterBarSubmit, FilterSearchInput, FilterSelectTrigger } from "@/features/school/FilterBar";
import { withReturnTo } from "@/features/school/object-workspace";
import type { PermissionKey } from "@/features/school/permissions";
import { RefundQueuePanel } from "@/features/school/RefundQueuePanel";
import { ScholarshipsPanel } from "@/features/school/ScholarshipsPanel";
import { StatusStrip, type StatusStripItem } from "@/features/school/dashboard-page";
import { Link } from "@/i18n/navigation";
import { getMyPerms, requireDashboardEnvironment } from "@/lib/auth";

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
  // doc22 §10：财务是唯一横跨两个环境的业务页，分派依据必须是**当前使用环境**而不是
  // profiles.role。员工兼家长切到家庭视角时该看到家庭账单，切回工作台才是全校财务台；
  // 按 role 分派会让这类账号永远只看得到员工分支。学习环境（学生）根本进不来
  // ——家长管钱，学生只关心课/作业/成绩（P4C-1 §4.4）。
  const { user, environment } = await requireDashboardEnvironment(locale, ["staff", "family"]);
  const perms = await getMyPerms(user.id);
  const hasFinancePerm = FINANCE_PERM_KEYS.some((key) => perms.has(key));

  if (environment === "family") {
    const customerT = await getTranslations("school.customer");
    const financeT = await getTranslations("school.finance");
    const [orders, accounts] = await Promise.all([safe(getMyOrders, []), safe(getMyAccounts, [])]);
    const balance = accounts[0]?.balance ?? 0;

    return (
      <DashboardPage title={customerT("myFinanceTitle")}>
        <DashboardContentGrid>
        <DashboardMainColumn className="rounded-2xl border border-line bg-card p-5">
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
        </DashboardMainColumn>
        </DashboardContentGrid>
      </DashboardPage>
    );
  }

  if (!hasFinancePerm) redirect(`/${locale}/dashboard`);

  const [t, homeT] = await Promise.all([getTranslations("school.finance"), getTranslations("school.home")]);

  const canSeeOrders = perms.has("finance.order.view") || perms.has("finance.order.create") || perms.has("finance.payment.record");
  const canApproveRefunds = perms.has("finance.refund.approve");
  const canManageCoupons = perms.has("finance.coupon.manage");
  const canSeeScholarships = perms.has("finance.scholarship.grant") || perms.has("finance.order.view");
  const canSeeAccounts = perms.has("finance.account.adjust") || perms.has("finance.order.view") || perms.has("finance.scholarship.grant") || perms.has("finance.coupon.manage");
  const canFinanceOverview = perms.has("finance.report.view");

  const filters = parseOrderFilters(rawSearchParams);
  const emptyOverview: FinanceOverview = { dueTotal: 0, paidTotal: 0, refundTotal: 0, overdueOrderCount: 0 };
  const [ordersResult, pendingRefunds, coupons, scholarships, financeOverview, pendingRefundCount] = await Promise.all([
    canSeeOrders ? listOrders(filters) : Promise.resolve({ orders: [], count: 0 }),
    canApproveRefunds ? listPendingRefunds() : Promise.resolve([]),
    canManageCoupons ? listCoupons() : Promise.resolve([]),
    canSeeScholarships ? listScholarships() : Promise.resolve([]),
    canFinanceOverview ? safe(getFinanceOverview, emptyOverview) : Promise.resolve(emptyOverview),
    canApproveRefunds ? safe(countPendingRefunds, 0) : Promise.resolve(0),
  ]);
  const cny = new Intl.NumberFormat(locale, { style: "currency", currency: "CNY" });
  const statusItems: StatusStripItem[] = [
    ...(canFinanceOverview
      ? [
          { label: homeT("financeDue"), value: cny.format(financeOverview.dueTotal) },
          { label: homeT("financePaid"), value: cny.format(financeOverview.paidTotal) },
          { label: homeT("financeRefunded"), value: cny.format(financeOverview.refundTotal) },
          { label: homeT("financeOverdueOrders"), value: financeOverview.overdueOrderCount, tone: financeOverview.overdueOrderCount > 0 ? "warning" as const : "default" as const },
        ]
      : []),
    ...(canApproveRefunds && pendingRefundCount > 0 ? [{ label: homeT("refundQueueLabel"), value: pendingRefundCount, tone: "warning" as const }] : []),
  ];

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
    <DashboardPage
      title={t("title")}
      summary={statusItems.length > 0 ? <StatusStrip items={statusItems} /> : null}
      commandPanel={
        canSeeOrders ? (
          <DashboardCommandPanel>
            <DashboardCommandFilters>
              <FilterBar aria-label={t("filter")}>
                <FilterSearchInput name="q" defaultValue={filters.q} placeholder={t("searchOrder")} aria-label={t("searchOrder")} />
                <Select name="status" defaultValue={toSelectValue(filters.status ?? "")}>
                  <FilterSelectTrigger><SelectValue /></FilterSelectTrigger>
                  <SelectContent>
                    <SelectItem value={toSelectValue("")}>{t("allStatuses")}</SelectItem>
                    {ORDER_STATUSES.map((status) => <SelectItem key={status} value={status}>{t(status)}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FilterBarSubmit>{t("filter")}</FilterBarSubmit>
                {(filters.q || filters.status) && <FilterBarReset href="/dashboard/finance" label={t("reset")} />}
              </FilterBar>
            </DashboardCommandFilters>
          </DashboardCommandPanel>
        ) : null
      }
    >
      {/*
        §22.1：财务过去是一列业务模块纵向堆叠，统一全宽后会显得稀疏且看不出模块关系。
        改成主次两列——订单是这一页真正的工作流，退款/优惠券/奖学金/账户查询是围绕它的
        辅助面板，放侧栏而不是继续往下排。
      */}
      <DashboardContentGrid>
        {canSeeOrders && (
          <DashboardMainColumn className="rounded-2xl border border-line bg-card p-5">
            <h2 className="text-base font-medium text-ink">{t("orders", { count: ordersResult.count ?? ordersResult.orders.length })}</h2>
            {ordersResult.orders.length === 0 ? (
              <p className="mt-4 text-sm text-muted">{t("noOrders")}</p>
            ) : (
              <ul className="mt-4 divide-y divide-line">
                {ordersResult.orders.map((order) => (
                  <li key={order.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                    <div className="min-w-0">
                      <Link href={withReturnTo(`/dashboard/students/${order.studentId}?tab=finance`, pageHref(filters.page))} className="font-medium hover:underline">{order.studentName}</Link>
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
          </DashboardMainColumn>
        )}

        <DashboardAside className="space-y-4">
          {canApproveRefunds && <RefundQueuePanel refunds={pendingRefunds} />}
          {canManageCoupons && <CouponsPanel coupons={coupons} />}
          {canSeeScholarships && <ScholarshipsPanel scholarships={scholarships} />}
          {canSeeAccounts && <AccountLookupPanel canAdjust={perms.has("finance.account.adjust")} />}
        </DashboardAside>
      </DashboardContentGrid>
    </DashboardPage>
  );
}
