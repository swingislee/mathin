import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getMyDisplayName, getWhiteboard, joinWhiteboard } from "@/features/whiteboard/actions";
import { BoardClient } from "@/features/whiteboard/BoardClient";
import { requireUser } from "@/lib/auth";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function WhiteboardBoardPage({ params, searchParams }: {
  params: Promise<{ locale: string; boardId: string }>;
  searchParams: Promise<{ invite?: string }>;
}) {
  const [{ locale, boardId }, { invite }] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  await requireUser(locale);
  if (!UUID_PATTERN.test(boardId)) notFound();

  // 带邀请码则先幂等加入再查询。注意不能「查→加入→再查」：同一渲染内两次
  // 相同的 Supabase GET 会被 Next 的请求记忆化去重，第二次拿到的还是第一次的 null。
  if (invite) await joinWhiteboard(boardId, invite).catch(() => false);
  const board = await getWhiteboard(boardId);
  if (!board) notFound();

  const selfName = await getMyDisplayName();
  return <BoardClient board={board} selfName={selfName} />;
}
