import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getWhiteboard } from "@/features/whiteboard/actions";
import { BoardClient } from "@/features/whiteboard/BoardClient";
import { requireUser } from "@/lib/auth";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function WhiteboardBoardPage({ params }: { params: Promise<{ locale: string; boardId: string }> }) {
  const { locale, boardId } = await params;
  setRequestLocale(locale);
  await requireUser(locale);
  if (!UUID_PATTERN.test(boardId)) notFound();
  const board = await getWhiteboard(boardId);
  if (!board) notFound();
  return <BoardClient board={board} />;
}
