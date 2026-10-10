import { setRequestLocale } from "next-intl/server";
import { requireAnyPerm } from "@/lib/auth";
import { readLeadBoard } from "@/features/school/lead-board-data";
import { LeadBoardWorkspace } from "@/features/school/LeadBoardWorkspace";

export default async function LeadBoardPage({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<{ unit?: string }>;
}) {
  const [{ locale }, { unit }] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  await requireAnyPerm(locale, ["followup.view", "review.write", "staff.manage"]);
  const unitId = unit && /^[0-9a-f-]{36}$/.test(unit) ? unit : null;
  // 链接里的组织不在查看范围内时回到默认组织。
  const board = await readLeadBoard(unitId).catch(() => readLeadBoard(null));
  return <LeadBoardWorkspace key={board.unitId ?? "default"} locale={locale} initial={board} />;
}
