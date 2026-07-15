import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { listMyClassrooms } from "@/features/classroom/actions";
import { BindCodeForm } from "@/features/school/BindCodeForm";
import { getMyLearningSummary, getMySessionReviews } from "@/features/school/customer";
import { getWeekSchedule } from "@/features/school/actions/schedule";
import { addDays } from "@/features/school/schedule";
import {
  CHILD_TILE_PREFIX,
  mergeTileLayout,
  parentDefaultOrder,
  TILE_REGISTRY,
  type EligibleTile,
} from "@/features/school/tiles";
import { TileWorkspace } from "@/features/school/TileWorkspace";
import type { PermissionKey } from "@/features/school/permissions";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import {
  buildSharedCustomerTiles,
  buildTileItems,
  CompactBody,
  MinimalBody,
  pickEligible,
  safe,
  type BestRow,
  type HomeProps,
  type RecentPostRow,
  type TileExtra,
} from "./shared";

/** 家长首屏（原 dashboard/page.tsx 的 parent 分支，P4G-7 拆出）。 */
export async function ParentHome({ locale, user, profile }: HomeProps) {
  const supabase = await createClient();
  const [t, gamesT, schoolT, customerT, bestsRes, recentRes, myClassroomList, layoutRow] = await Promise.all([
    getTranslations("dashboard"),
    getTranslations("games"),
    getTranslations("school"),
    getTranslations("school.customer"),
    supabase.from("game_leaderboard").select("game_id, difficulty, duration_ms").eq("user_id", user.id).returns<BestRow[]>(),
    supabase.from("posts").select("id,title,published_at,like_count").eq("author_id", user.id).order("published_at", { ascending: false }).limit(3).returns<RecentPostRow[]>(),
    listMyClassrooms(),
    supabase.from("dashboard_layouts").select("tiles").eq("user_id", user.id).maybeSingle<{ tiles: unknown }>(),
  ]);
  const bests = bestsRes.data ?? [];
  const recentPosts = recentRes.data ?? [];
  const classrooms = myClassroomList.slice(0, 5);
  const userTiles = layoutRow.data?.tiles ?? null;
  const perms = new Set<PermissionKey>();
  const dateLine = new Intl.DateTimeFormat(locale, { dateStyle: "full" }).format(new Date());
  const subtitle = `${schoolT("home.staffGreeting", { name: profile?.displayName || "" })} · ${dateLine}`;
  const shortFmt = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });
  const labels = new Map<string, string>();
  const contents = new Map<string, ReactNode>();
  const extras = new Map<string, TileExtra>();
  buildSharedCustomerTiles({ t, gamesT, locale, bests, recentPosts, classrooms, labels, contents, extras });

    const studentsT = await getTranslations("school.students");
    const [summaries, parentWeekSchedule, parentReviews] = await Promise.all([
      safe(getMyLearningSummary, []),
      safe(() => getWeekSchedule(new Date().toISOString(), addDays(new Date(), 7).toISOString()), []),
      safe(()=>getMySessionReviews(addDays(new Date(),-180).toISOString(),new Date().toISOString()),[]),
    ]);
    const weekFmt = new Intl.DateTimeFormat(locale, { weekday: "short", hour: "2-digit", minute: "2-digit" });

    for (const child of summaries) {
      const key = `${CHILD_TILE_PREFIX}${child.studentId}`;
      const nextAt = child.nextSessionAt ? shortFmt.format(new Date(child.nextSessionAt)) : "-";
      // §0.8：本周 N 节 + 首两个时刻（时刻串按课表在 TS 侧拼，RPC 只给数）。
      const childTimes = parentWeekSchedule
        .filter((entry) => entry.studentName === child.studentName)
        .slice(0, 2)
        .map((entry) => weekFmt.format(new Date(entry.scheduledAt)))
        .join(locale === "zh" ? "、" : ", ");
      const weekLine =
        child.weekSessionCount > 0 && childTimes
          ? customerT("weekSessionsValue", { count: child.weekSessionCount, times: childTimes })
          : customerT("weekSessionsCount", { count: child.weekSessionCount });
      const recentReview=parentReviews.find(review=>review.studentId===child.studentId);
      labels.set(key, child.studentName);
      extras.set(key, {
        href: `/dashboard/children?child=${child.studentId}`,
        // §5.8c：childCard 的 minimal 关键数 = 下次上课时间。
        minimal: <MinimalBody value={nextAt} />,
        compact: <CompactBody value={nextAt} line={`${customerT("paymentStatus")} · ${customerT(`payment_${child.paymentStatus}`)}`} />,
      });
      contents.set(
        key,
        <>
          {child.grade !== null && <p className="shrink-0 text-xs text-muted">{studentsT("grade", { grade: child.grade })}</p>}
          <dl className="mt-2 grid flex-1 content-start gap-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{customerT("nextSession")}</dt>
              <dd>{child.nextSessionAt ? shortFmt.format(new Date(child.nextSessionAt)) : "-"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="shrink-0 text-muted">{customerT("weekSessions")}</dt>
              <dd className="min-w-0 truncate text-right">{weekLine}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{customerT("pendingAssignmentsTitle")}</dt>
              <dd className={cn("tabular-nums", (child.pendingAssignmentCount ?? 0) > 0 && "text-rose")}>
                {child.pendingAssignmentCount ?? "—"}
              </dd>
            </div>
            {recentReview?<div className="flex justify-between gap-3"><dt className="text-muted">{customerT("recentReview")}</dt><dd className="min-w-0 truncate text-right">{customerT("recentReviewValue",{entry:recentReview.entryScore??"—",exit:recentReview.exitScore??"—"})}</dd></div>:<div className="flex justify-between gap-3"><dt className="text-muted">{customerT("starTotal")}</dt><dd className="tabular-nums">{child.starTotal}</dd></div>}
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
          </dl>
        </>,
      );
    }

    // 家长大欢迎卡删除（§5.6）：parentIntro 收进绑定贴一句话。
    labels.set("bindChild", customerT("bindChildTitle"));
    contents.set(
      "bindChild",
      <>
        <p className="truncate text-sm text-muted">{summaries.length === 0 ? customerT("noChildren") : customerT("parentIntro")}</p>
        <div className="mt-2">
          <BindCodeForm mode="guardian" />
        </div>
      </>,
    );

    const childKeys = summaries.map((child) => `${CHILD_TILE_PREFIX}${child.studentId}`);
    const childDef = TILE_REGISTRY.find((def) => def.key === "childCard")!;
    const eligible: EligibleTile[] = [
      ...childKeys.map((key) => ({ key, allowedSizes: childDef.allowedSizes })),
      ...pickEligible("parent", perms).filter((tile) => tile.key !== "childCard"),
    ];
    const merged = mergeTileLayout(eligible, userTiles, parentDefaultOrder(childKeys));
    const { items, hidden } = buildTileItems(merged, eligible, labels, contents, extras);

    return <TileWorkspace title={customerT("parentTitle")} subtitle={subtitle} items={items} hidden={hidden} />;
}
