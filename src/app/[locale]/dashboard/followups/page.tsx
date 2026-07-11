import { getTranslations, setRequestLocale } from "next-intl/server";
import { FollowUpBoardList } from "@/features/school/FollowUpBoardList";
import {
  BOARD_BUCKETS,
  listFollowUpBoard,
  parseBoardParams,
  type BoardBucket,
  type FollowUpBoard,
} from "@/features/school/followups";
import { NewStudentDialog } from "@/features/school/NewStudentDialog";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import { FOLLOW_UP_STATUSES } from "@/features/school/students";
import { Link } from "@/i18n/navigation";
import { getMyPerms, requirePerm } from "@/lib/auth";
import { cn } from "@/lib/utils";

const EMPTY_BOARD: FollowUpBoard = {
  counts: { overdue: 0, today: 0, week: 0, unscheduled: 0, trialToday: 0 },
  groups: FOLLOW_UP_STATUSES.map((status) => ({ status, rows: [] })),
};

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export default async function FollowUpsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, rawSearchParams] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const user = await requirePerm(locale, "followup.view");
  const t = await getTranslations("school.followups");
  const perms = await getMyPerms(user.id);
  const canScopeAll = perms.has("student.view.all");
  const canCreate = perms.has("student.create");
  const canEditStatus = perms.has("student.edit");
  const canOrder = perms.has("finance.order.create");

  const { scope, bucket } = parseBoardParams(rawSearchParams, canScopeAll);
  const board = await safe(() => listFollowUpBoard(user.id, scope, bucket), EMPTY_BOARD);

  const boardHref = (next: { scope?: typeof scope; bucket?: BoardBucket | undefined }) => {
    const query = new URLSearchParams();
    const nextScope = "scope" in next ? next.scope : scope;
    const nextBucket = "bucket" in next ? next.bucket : bucket;
    if (nextScope === "all") query.set("scope", "all");
    if (nextBucket) query.set("bucket", nextBucket);
    const qs = query.toString();
    return `/dashboard/followups${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="mx-auto w-full max-w-6xl">
      <SchoolPageHeader
        title={t("title")}
        actions={
          <>
            {canScopeAll && (
              <div className="flex overflow-hidden rounded-lg border border-line text-xs" role="group" aria-label={t("scopeLabel")}>
                {(["mine", "all"] as const).map((value) => (
                  <Link
                    key={value}
                    href={boardHref({ scope: value })}
                    className={cn(
                      "px-3 py-1.5 transition",
                      scope === value ? "bg-crater/10 font-medium text-ink" : "text-muted hover:text-ink",
                    )}
                  >
                    {t(value === "mine" ? "scopeMine" : "scopeAll")}
                  </Link>
                ))}
              </div>
            )}
            {canCreate && <NewStudentDialog />}
          </>
        }
      >
        <p className="mt-1 max-w-3xl text-sm text-muted">{t("intro")}</p>
      </SchoolPageHeader>

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        {BOARD_BUCKETS.map((key) => {
          const active = bucket === key;
          const rose = key === "overdue" && board.counts[key] > 0;
          return (
            <Link
              key={key}
              href={boardHref({ bucket: active ? undefined : key })}
              aria-current={active ? "true" : undefined}
              className={cn(
                "rounded-xl border p-3 transition",
                active ? "border-crater bg-crater/10" : "border-line bg-card hover:border-crater/50",
              )}
            >
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted">{t(`bucket_${key}`)}</p>
              <p className={cn("font-display text-2xl tabular-nums", rose ? "text-rose" : "")}>{board.counts[key]}</p>
            </Link>
          );
        })}
      </div>

      <FollowUpBoardList groups={board.groups} canEditStatus={canEditStatus} canOrder={canOrder} />
    </div>
  );
}
