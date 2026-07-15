import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { listMyClassrooms } from "@/features/classroom/actions";
import { BindCodeForm } from "@/features/school/BindCodeForm";
import { getMyLearningSummary, getMyPendingAssignments, getMyStudents } from "@/features/school/customer";
import { getWeekSchedule } from "@/features/school/actions/schedule";
import { addDays } from "@/features/school/schedule";
import { mergeTileLayout, STUDENT_ORDER } from "@/features/school/tiles";
import { TileWorkspace } from "@/features/school/TileWorkspace";
import { buttonVariants } from "@/components/ui/button";
import type { PermissionKey } from "@/features/school/permissions";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import {
  buildSharedCustomerTiles,
  buildTileItems,
  CompactBody,
  EmptyBody,
  MinimalBody,
  pickEligible,
  safe,
  type BestRow,
  type HomeProps,
  type RecentPostRow,
  type TileExtra,
} from "./shared";

/** 学生首屏（原 dashboard/page.tsx 的 student/isBound 分支，P4G-7 拆出）。 */
export async function StudentHome({ locale, user, profile }: HomeProps) {
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

  const myStudents = await safe(getMyStudents, []);
  const isBound = myStudents.length > 0;
  const [nextWeekSchedule, myPendingAssignments, mySummaries] = isBound
    ? await Promise.all([
        safe(() => getWeekSchedule(new Date().toISOString(), addDays(new Date(), 7).toISOString()), []),
        safe(getMyPendingAssignments, []),
        safe(getMyLearningSummary, []),
      ])
    : ([[], [], []] as [
        Awaited<ReturnType<typeof getWeekSchedule>>,
        Awaited<ReturnType<typeof getMyPendingAssignments>>,
        Awaited<ReturnType<typeof getMyLearningSummary>>,
      ]);
  const nextSession = nextWeekSchedule[0] ?? null;
  // §0.7 进教室：距开课 ≤30 分钟且本人是该班 classroom_members 成员（非 enrollment）。
  const canEnterClassroom =
    nextSession !== null &&
    new Date(nextSession.scheduledAt).getTime() - new Date().getTime() <= 30 * 60_000 &&
    myClassroomList.some((classroom) => classroom.id === nextSession.classroomId);

  if (isBound) {
    labels.set("mySchedule", customerT("myScheduleTitle"));
    extras.set("mySchedule", {
      href: "/dashboard/schedule",
      minimal: <MinimalBody value={nextWeekSchedule.length} />,
      compact: (
        <CompactBody
          value={nextWeekSchedule.length}
          line={nextSession ? `${shortFmt.format(new Date(nextSession.scheduledAt))} ${nextSession.classroomName}` : customerT("myScheduleEmpty")}
        />
      ),
    });
    contents.set(
      "mySchedule",
      !nextSession ? (
        <EmptyBody text={customerT("myScheduleEmpty")} href="/dashboard/schedule" linkLabel={schoolT("nav.schedule")} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-3 py-1 text-sm">
            <time className="shrink-0 font-mono text-xs text-muted">{shortFmt.format(new Date(nextSession.scheduledAt))}</time>
            <span className="min-w-0 flex-1 truncate font-medium">{nextSession.classroomName}</span>
            <span className="shrink-0 text-xs text-muted">{nextSession.lectureName}</span>
            {canEnterClassroom && (
              <Link href={`/classroom/${nextSession.classroomId}`} className={cn(buttonVariants({ size: "sm" }), "shrink-0")}>
                {customerT("enterClassroom")}
              </Link>
            )}
          </div>
          {nextWeekSchedule.length > 1 && (
            <ul className="min-h-0 flex-1 divide-y overflow-hidden border-t">
              {nextWeekSchedule.slice(1, 5).map((entry) => (
                <li key={entry.sessionId} className="flex items-center gap-3 py-2 text-sm">
                  <time className="shrink-0 font-mono text-xs text-muted">{shortFmt.format(new Date(entry.scheduledAt))}</time>
                  <span className="min-w-0 flex-1 truncate">{entry.classroomName}</span>
                  <span className="shrink-0 text-xs text-muted">{entry.lectureName}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ),
    );

    // §0.7 列表化：最近截止 3 份逐行直达提交页，不再只给计数。
    const nearestDue = myPendingAssignments[0] ?? null;
    labels.set("pendingAssignments", customerT("pendingAssignmentsTitle"));
    extras.set("pendingAssignments", {
      href: "/dashboard/assignments",
      tone: myPendingAssignments.length > 0 ? "rose" : undefined,
      minimal: <MinimalBody value={myPendingAssignments.length} rose={myPendingAssignments.length > 0} />,
      compact: (
        <CompactBody
          value={myPendingAssignments.length}
          rose={myPendingAssignments.length > 0}
          line={
            nearestDue
              ? `${nearestDue.title} · ${nearestDue.dueAt ? shortFmt.format(new Date(nearestDue.dueAt)) : customerT("noDue")}`
              : customerT("pendingAssignmentsEmpty")
          }
        />
      ),
    });
    contents.set(
      "pendingAssignments",
      myPendingAssignments.length === 0 ? (
        <EmptyBody text={customerT("pendingAssignmentsEmpty")} href="/dashboard/assignments" linkLabel={customerT("goSubmit")} />
      ) : (
        <ul className="min-h-0 flex-1 divide-y overflow-hidden">
          {myPendingAssignments.slice(0, 3).map((row) => (
            <li key={row.assignmentId} className="flex items-center gap-3 py-2 text-sm">
              <Link
                href={`/classroom/${row.classroomId}/assignment/${row.assignmentId}`}
                className="min-w-0 flex-1 truncate font-medium hover:underline"
              >
                {row.title}
              </Link>
              <span className="shrink-0 text-xs text-muted">
                {row.dueAt ? shortFmt.format(new Date(row.dueAt)) : customerT("noDue")}
              </span>
            </li>
          ))}
        </ul>
      ),
    );

    // §0.7 myStars：直接吃 get_my_learning_summary 本人行，不另写聚合。
    const myStar = mySummaries[0] ?? null;
    if (myStar) {
      const rateText = myStar.attendanceRate30d !== null ? `${myStar.attendanceRate30d}%` : "—";
      labels.set("myStars", customerT("myStarsTitle"));
      extras.set("myStars", {
        minimal: <MinimalBody value={myStar.starTotal} />,
        compact: <CompactBody value={myStar.starTotal} line={`${customerT("attendanceRate30d")} ${rateText}`} />,
      });
      contents.set(
        "myStars",
        <dl className="grid flex-1 content-center gap-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">{customerT("starTotal")}</dt>
            <dd className="font-display text-2xl tabular-nums">{myStar.starTotal}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">{customerT("attendanceRate30d")}</dt>
            <dd className="tabular-nums">{rateText}</dd>
          </div>
        </dl>,
      );
    }
  }

  const eligible = pickEligible("student", perms).filter(
    (tile) => isBound || (tile.key !== "mySchedule" && tile.key !== "pendingAssignments" && tile.key !== "myStars"),
  );
  const merged = mergeTileLayout(eligible, userTiles, STUDENT_ORDER);
  const { items, hidden } = buildTileItems(merged, eligible, labels, contents, extras);

  return (
    <TileWorkspace
      title={customerT("studentTitle")}
      subtitle={subtitle}
      prelude={
        !isBound ? (
          <section className="rounded-2xl border bg-card p-5">
            <p className="text-sm text-muted">{customerT("notBound")}</p>
            <div className="mt-3">
              <BindCodeForm mode="claim" />
            </div>
          </section>
        ) : undefined
      }
      items={items}
      hidden={hidden}
    />
  );
}
