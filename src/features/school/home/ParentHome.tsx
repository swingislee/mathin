import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { BindCodeForm } from "@/features/school/BindCodeForm";
import { getWeekSchedule } from "@/features/school/actions/schedule";
import { getMyLearningSummary, getMySessionReviews, getMySessionReviewStates } from "@/features/school/customer";
import { addDays } from "@/features/school/schedule";
import {
  CHILD_TILE_PREFIX,
  mergeTileLayout,
  parentDefaultOrder,
  TILE_REGISTRY,
  type EligibleTile,
} from "@/features/school/tiles";
import { TileWorkspace } from "@/features/school/TileWorkspace";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import {
  buildTileItems,
  CompactBody,
  MinimalBody,
  safe,
  type HomeProps,
  type TileExtra,
} from "./shared";

/** 家长首屏：以孩子为中心组织课表、待办与风险，不混入家长自己的内容产品数据。 */
export async function ParentHome({ locale, user, profile }: HomeProps) {
  const supabase = await createClient();
  const [schoolT, customerT, studentsT, layoutRow] = await Promise.all([
    getTranslations("school"),
    getTranslations("school.customer"),
    getTranslations("school.students"),
    supabase.from("dashboard_layouts").select("tiles").eq("user_id", user.id).maybeSingle<{ tiles: unknown }>(),
  ]);
  const userTiles = layoutRow.data?.tiles ?? null;
  const dateLine = new Intl.DateTimeFormat(locale, { dateStyle: "full" }).format(new Date());
  const subtitle = `${schoolT("home.staffGreeting", { name: profile?.displayName || "" })} · ${dateLine}`;
  const shortFmt = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });
  const labels = new Map<string, string>();
  const contents = new Map<string, ReactNode>();
  const extras = new Map<string, TileExtra>();
  const now = new Date();
  const [summaries, parentWeekSchedule, parentReviews, parentReviewStates] = await Promise.all([
    safe(getMyLearningSummary, []),
    safe(() => getWeekSchedule(now.toISOString(), addDays(now, 7).toISOString()), []),
    safe(() => getMySessionReviews(addDays(now, -180).toISOString(), now.toISOString()), []),
    safe(() => getMySessionReviewStates(addDays(now, -180).toISOString(), now.toISOString()), []),
  ]);
  const weekFmt = new Intl.DateTimeFormat(locale, { weekday: "short", hour: "2-digit", minute: "2-digit" });

  for (const child of summaries) {
    const key = `${CHILD_TILE_PREFIX}${child.studentId}`;
    const nextAt = child.nextSessionAt ? shortFmt.format(new Date(child.nextSessionAt)) : "—";
    const pendingCount = child.pendingAssignmentCount ?? 0;
    const needsAttention = pendingCount > 0 || child.paymentStatus === "overdue";
    const childTimes = parentWeekSchedule
      .filter((entry) => entry.studentId === child.studentId)
      .slice(0, 2)
      .map((entry) => weekFmt.format(new Date(entry.scheduledAt)))
      .join(locale === "zh" ? "、" : ", ");
    const weekLine = child.weekSessionCount > 0 && childTimes
      ? customerT("weekSessionsValue", { count: child.weekSessionCount, times: childTimes })
      : customerT("weekSessionsCount", { count: child.weekSessionCount });
    const recentReview = parentReviews.find((review) => review.studentId === child.studentId);
    const recentReviewState = parentReviewStates.find((state) => state.studentId === child.studentId);

    labels.set(key, child.studentName);
    extras.set(key, {
      href: `/dashboard/children?child=${child.studentId}`,
      tone: needsAttention ? "rose" : undefined,
      minimal: <MinimalBody value={nextAt} rose={needsAttention} />,
      compact: (
        <CompactBody
          value={nextAt}
          rose={needsAttention}
          line={`${customerT("pendingAssignmentsTitle")} · ${child.pendingAssignmentCount ?? "—"}`}
        />
      ),
    });
    contents.set(
      key,
      <>
        {child.grade !== null && <p className="shrink-0 text-xs text-muted">{studentsT("grade", { grade: child.grade })}</p>}
        <dl className="mt-2 grid flex-1 content-start gap-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">{customerT("nextSession")}</dt>
            <dd>{nextAt}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="shrink-0 text-muted">{customerT("weekSessions")}</dt>
            <dd className="min-w-0 truncate text-right">{weekLine}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">{customerT("pendingAssignmentsTitle")}</dt>
            <dd className={cn("tabular-nums", pendingCount > 0 && "font-medium text-rose")}>
              {child.pendingAssignmentCount ?? "—"}
            </dd>
          </div>
          {recentReview ? (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{customerT("recentReview")}</dt>
              <dd className="min-w-0 truncate text-right">
                {customerT("recentReviewValue", { entry: recentReview.entryScore ?? "—", exit: recentReview.exitScore ?? "—" })}
              </dd>
            </div>
          ) : recentReviewState ? (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{customerT("recentReview")}</dt>
              <dd className="min-w-0 truncate text-right">{studentsT(`reviewStatus_${recentReviewState.availabilityState}`)}</dd>
            </div>
          ) : (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{customerT("starTotal")}</dt>
              <dd className="tabular-nums">{child.starTotal}</dd>
            </div>
          )}
          {child.paymentStatus !== "closed" && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{customerT("paymentStatus")}</dt>
              <dd>
                {child.paymentStatus === "overdue" ? (
                  <span className="rounded-full bg-rose/10 px-2 py-0.5 text-xs text-rose">{customerT("payment_overdue")}</span>
                ) : (
                  customerT(`payment_${child.paymentStatus}`)
                )}
              </dd>
            </div>
          )}
        </dl>
        <div className="mt-auto flex flex-wrap gap-2 pt-3">
          <Link href={`/dashboard/children?child=${child.studentId}`} className={cn(buttonVariants({ size: "sm" }), "grow")}>
            {customerT("goChildDetail")}
          </Link>
          <Link href={`/dashboard/assignments?child=${child.studentId}`} className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "grow")}>
            {customerT("homeworkAction")}
          </Link>
          <Link href={`/dashboard/children?child=${child.studentId}#leave`} className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "grow")}>
            {customerT("leaveAction")}
          </Link>
        </div>
      </>,
    );
  }

  labels.set("bindChild", customerT("bindChildTitle"));
  contents.set(
    "bindChild",
    <>
      <p className="truncate text-sm text-muted">{summaries.length === 0 ? customerT("noChildren") : customerT("parentIntro")}</p>
      <div className="mt-2"><BindCodeForm mode="guardian" /></div>
    </>,
  );

  const childKeys = summaries.map((child) => `${CHILD_TILE_PREFIX}${child.studentId}`);
  const childDef = TILE_REGISTRY.find((def) => def.key === "childCard")!;
  const bindDef = TILE_REGISTRY.find((def) => def.key === "bindChild")!;
  const eligible: EligibleTile[] = [
    ...childKeys.map((key) => ({ key, allowedSizes: childDef.allowedSizes })),
    { key: "bindChild", allowedSizes: bindDef.allowedSizes },
  ];
  const merged = mergeTileLayout(eligible, userTiles, parentDefaultOrder(childKeys));
  const { items, hidden } = buildTileItems(merged, eligible, labels, contents, extras);

  return <TileWorkspace title={customerT("parentTitle")} subtitle={subtitle} items={items} hidden={hidden} />;
}
