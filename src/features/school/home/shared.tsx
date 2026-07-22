import { Crown, School } from "lucide-react";
import type { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import type { ClassroomMeta } from "@/features/classroom/types";
import { formatMs } from "@/features/games/format";
import { games } from "@/features/games/registry";
import type { PermissionKey } from "@/features/school/permissions";
import { sizeToWH, type TilePlacement } from "@/features/school/tile-layout";
import {
  findTileDef,
  TILE_REGISTRY,
  type EligibleTile,
  type MergedTileLayout,
  type TileAudience,
  type TileTone,
} from "@/features/school/tiles";
import type { TileGridItem } from "@/features/school/TileWorkspace";
import { Link } from "@/i18n/navigation";
import type { getProfile } from "@/lib/auth";
import { cn } from "@/lib/utils";
import type { User } from "@supabase/supabase-js";

/** 三个角色首屏组件共用的 props：locale + 已鉴权 user + 已取的 profile。 */
export interface HomeProps {
  locale: string;
  user: User;
  profile: Awaited<ReturnType<typeof getProfile>>;
}

// dashboard 首屏三角色分支共用的磁贴装配原语（原 dashboard/page.tsx 内联，
// P4G-7 拆巨石时抽出）。取数留服务端，磁贴壳由客户端 TileWorkspace 渲染。
export async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export interface BestRow {
  game_id: string;
  difficulty: string;
  duration_ms: number;
}

export interface RecentPostRow {
  id: string;
  title: string;
  published_at: string;
  like_count: number;
}

export type Translator = Awaited<ReturnType<typeof getTranslations>>;

// ---------------------------------------------------------------------------
// 磁贴装配（P4C-4 §5.3 / P4C-5 §5.4 / P4C-4b §5.8c）：取数留在服务端，磁贴壳
// （图标+眉标签+箭头+tone）由客户端 TileWorkspace 渲染，这里产出三档 body
// （full=contents、compact/minimal 缺省回落 full）与逐贴 extras。
// ---------------------------------------------------------------------------

export interface TileExtra {
  tone?: TileTone;
  href?: string;
  cover?: boolean;
  /** compact 形态（宽或高为 1 的小档）：关键数+一行摘要；缺省回落 full。 */
  compact?: ReactNode;
  /** minimal 形态（1x1）：单关键数；缺省回落 compact → full。 */
  minimal?: ReactNode;
}

export function pickEligible(audience: TileAudience, perms: ReadonlySet<PermissionKey>): EligibleTile[] {
  return TILE_REGISTRY.filter(
    (def) =>
      def.audiences.includes(audience) &&
      (!def.requiredPerm || perms.has(def.requiredPerm)) &&
      (!def.requiredAnyPerm || def.requiredAnyPerm.some((key) => perms.has(key))),
  ).map((def) => ({ key: def.key, allowedSizes: def.allowedSizes }));
}

export function buildTileItems(
  merged: MergedTileLayout,
  eligible: readonly EligibleTile[],
  labels: ReadonlyMap<string, string>,
  contents: ReadonlyMap<string, ReactNode>,
  extras: ReadonlyMap<string, TileExtra>,
): { items: TileGridItem[]; hidden: TileGridItem[] } {
  const sizesByKey = new Map(eligible.map((tile) => [tile.key, tile.allowedSizes]));
  const toItem = (placement: TilePlacement): TileGridItem | null => {
    const allowedSizes = sizesByKey.get(placement.k);
    const def = findTileDef(placement.k);
    if (!allowedSizes || !def || !contents.has(placement.k)) return null;
    const extra = extras.get(placement.k);
    return {
      key: placement.k,
      placement,
      label: labels.get(placement.k) ?? placement.k,
      allowedSizes,
      icon: def.icon,
      tone: extra?.tone ?? def.tone,
      href: extra?.href,
      cover: extra?.cover,
      node: contents.get(placement.k),
      compact: extra?.compact,
      minimal: extra?.minimal,
    };
  };
  return {
    items: merged.result.map(toItem).filter((item): item is TileGridItem => item !== null),
    // hidden 磁贴没有坐标：给默认档占位，重新加入时由客户端 resolve 落位。
    hidden: merged.hidden
      .map((key) => toItem({ k: key, x: 0, y: 0, ...sizeToWH(sizesByKey.get(key)![0]) }))
      .filter((item): item is TileGridItem => item !== null),
  };
}

/** 1x1 统计贴主体：主数垂直居中（标签在壳的眉标行，§5.4）。 */
export function StatBody({ value, tone }: { value: number; tone?: TileTone }) {
  return (
    <p className={cn("flex flex-1 items-center font-display text-4xl tabular-nums", tone === "rose" && value > 0 && "text-rose")}>
      {value}
    </p>
  );
}

/** minimal 形态（§5.8c）：单关键数/短串，1x1 内绝不溢出。 */
export function MinimalBody({ value, rose }: { value: ReactNode; rose?: boolean }) {
  return (
    <p className={cn("flex min-w-0 flex-1 items-center truncate font-display text-3xl tabular-nums", rose && "text-rose")}>
      {value}
    </p>
  );
}

/** compact 形态（§5.8c）：关键数 + 一行摘要。 */
export function CompactBody({ value, line, rose }: { value: ReactNode; line?: string; rose?: boolean }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col justify-center gap-0.5">
      <p className={cn("truncate font-display text-2xl tabular-nums", rose && "text-rose")}>{value}</p>
      {line && <p className="truncate text-xs text-muted">{line}</p>}
    </div>
  );
}

/** 空态：一句话 + 直达按钮（§5.4 禁止只有一行灰字）。 */
export function EmptyBody({ text, href, linkLabel }: { text: string; href?: string; linkLabel?: string }) {
  return (
    <div className="flex flex-1 flex-col items-start justify-center gap-3">
      <p className="text-sm text-muted">{text}</p>
      {href && linkLabel && (
        <Link href={href} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
          {linkLabel}
        </Link>
      )}
    </div>
  );
}

/** 学生/家长共用的成绩/笔记/教室三贴内容（原 CustomerSharedSections 拆磁贴）。 */
export function buildSharedCustomerTiles({
  t,
  gamesT,
  locale,
  bests,
  recentPosts,
  classrooms,
  labels,
  contents,
  extras,
}: {
  t: Translator;
  gamesT: Translator;
  locale: string;
  bests: BestRow[];
  recentPosts: RecentPostRow[];
  classrooms: ClassroomMeta[];
  labels: Map<string, string>;
  contents: Map<string, ReactNode>;
  extras: Map<string, TileExtra>;
}) {
  labels.set("myScores", t("scoresTitle"));
  extras.set("myScores", {
    href: "/games",
    minimal: <MinimalBody value={bests.length} />,
    compact: (
      <CompactBody
        value={bests.length}
        line={bests[0] ? `${gamesT(`items.${bests[0].game_id}.name`)} ${formatMs(bests[0].duration_ms)}` : t("noScores")}
      />
    ),
  });
  contents.set(
    "myScores",
    bests.length === 0 ? (
      <EmptyBody text={t("noScores")} href="/games" linkLabel={t("goPlay")} />
    ) : (
      <ul className="min-h-0 flex-1 divide-y overflow-hidden">
        {games.map((def) =>
          def.difficulties.map((difficulty, i) => {
            const row = bests.find((b) => b.game_id === def.id && b.difficulty === difficulty);
            if (!row) return null;
            return (
              <li key={`${def.id}:${difficulty}`} className="flex items-center gap-3 py-2 text-sm">
                <def.icon size={16} className="text-muted" />
                <span className="min-w-0 flex-1 truncate font-medium">{gamesT(`items.${def.id}.name`)}</span>
                <span className="flex shrink-0 items-center gap-1 text-xs text-muted">
                  {Array.from({ length: i + 1 }, (_, k) => (
                    <Crown key={k} size={10} />
                  ))}
                  {gamesT(`difficulty.${difficulty}`)}
                </span>
                <span className="shrink-0 font-serif tabular-nums">{formatMs(row.duration_ms)}</span>
              </li>
            );
          }),
        )}
      </ul>
    ),
  );

  labels.set("myNotes", t("notesTitle"));
  extras.set("myNotes", {
    href: "/notebook/me",
    minimal: <MinimalBody value={recentPosts.length} />,
    compact: (
      <CompactBody value={recentPosts.length} line={recentPosts[0] ? recentPosts[0].title || t("untitled") : t("noNotes")} />
    ),
  });
  contents.set(
    "myNotes",
    recentPosts.length === 0 ? (
      <EmptyBody text={t("noNotes")} href="/notebook/me" linkLabel={t("goWrite")} />
    ) : (
      <ul className="min-h-0 flex-1 divide-y overflow-hidden">
        {recentPosts.map((post) => (
          <li key={post.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
            <Link href={`/notebook/${post.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
              {post.title || t("untitled")}
            </Link>
            <time className="shrink-0 text-xs text-muted">
              {new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(post.published_at))}
            </time>
          </li>
        ))}
      </ul>
    ),
  );

  labels.set("myClassrooms", t("classroomsTitle"));
  extras.set("myClassrooms", {
    href: "/classroom",
    minimal: <MinimalBody value={classrooms.length} />,
    compact: (
      <CompactBody value={classrooms.length} line={classrooms[0] ? classrooms[0].name || t("untitled") : t("noClassrooms")} />
    ),
  });
  contents.set(
    "myClassrooms",
    classrooms.length === 0 ? (
      <EmptyBody text={t("noClassrooms")} href="/classroom" linkLabel={t("goClassrooms")} />
    ) : (
      <ul className="min-h-0 flex-1 divide-y overflow-hidden">
        {classrooms.map((classroom) => (
          <li key={classroom.id} className="flex items-center gap-3 py-2 text-sm">
            <School size={16} className="shrink-0 text-muted" aria-hidden />
            <Link href={`/classroom/${classroom.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
              {classroom.name || t("untitled")}
            </Link>
            <span className="shrink-0 rounded-full bg-line/50 px-2 py-0.5 text-xs text-muted">
              {classroom.myRole === "teacher" ? t("teaching") : t("studying")}
            </span>
          </li>
        ))}
      </ul>
    ),
  );
}
