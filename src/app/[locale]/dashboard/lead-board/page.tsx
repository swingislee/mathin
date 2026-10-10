import { setRequestLocale } from "next-intl/server";
import { requireAnyPerm } from "@/lib/auth";
import { readLeadBoard } from "@/features/school/lead-board-data";
import { LeadBoardWorkspace } from "@/features/school/LeadBoardWorkspace";

export default async function LeadBoardPage({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<{ unit?: string; grain?: string; date?: string }>;
}) {
  const [{ locale }, { unit, grain: grainParam, date }] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  await requireAnyPerm(locale, ["followup.view", "review.write", "staff.manage"]);
  const unitId = unit && /^[0-9a-f-]{36}$/.test(unit) ? unit : null;
  const grain = grainParam === "month" ? "month" : "week", anchor = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  // 链接里的组织不在查看范围内时回到默认组织。
  const board = await readLeadBoard(unitId, grain, anchor).catch(() => readLeadBoard(null, grain, null));
  return <LeadBoardWorkspace key={`${board.unitId ?? "default"}:${board.period.from}`} locale={locale} initial={board} />;
}
