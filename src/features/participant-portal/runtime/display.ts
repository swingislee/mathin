import "server-only";
import { requireResult } from "@/features/parent-portal/server";
import type { RuntimeLocale } from "../../../../contracts/participant-api/runtime";
import { shanghaiDate, type SourceInput } from "./sources";

/** Data for display blocks. Each source returns the block's content for the current account and child, or `null` for visitors. */
export type DisplayData = {
  card?: { title: string; subtitle: string; fields: { label: string; value: string }[]; image?: string; stamp?: string };
  metrics?: { label: string; value: string; unit: string; hint: string }[];
  progress?: { label: string; value: number; max: number; caption: string }[];
  badges?: { id: string; label: string; image: string; earned: boolean; caption: string }[];
  chart?: { labels: string[]; series: { name: string; values: number[] }[]; max: number };
  table?: { columns: string[]; rows: string[][] };
  tracks?: { id: string; title: string; subtitle: string; src: string }[];
};
type Summary = { student_id: string; student_name: string; grade: number | null; next_session_at: string | null; attendance_rate_30d: number | null;
  star_total: number | null; week_session_count: number | null; pending_assignment_count: number | null };

const copy = (locale: RuntimeLocale) => locale === "zh"
  ? { stars: "星星", week: "本周课次", pending: "待完成任务", attendance: "近 30 天出勤", times: "次", items: "项", next: "下次上课", none: "暂无", name: "姓名", stage: "学习阶段",
    card: "学员卡", checkWeek: "本周打卡", checkTotal: "近 30 天打卡", days: "天" }
  : { stars: "Stars", week: "This week", pending: "To do", attendance: "Attendance (30 days)", times: "", items: "", next: "Next class", none: "None", name: "Name", stage: "Stage",
    card: "Student card", checkWeek: "Check-ins this week", checkTotal: "Check-ins (30 days)", days: "days" };

async function summary(input: SourceInput): Promise<Summary | null> {
  const db = input.identity.db;
  if (!db) return null;
  const rows = (requireResult(await db.rpc("get_my_learning_summary")) ?? []) as Summary[];
  return rows.find(row => row.student_id === input.identity.participant) ?? null;
}
const stageLabel = (input: SourceInput, stage: number | null | undefined) => {
  const row = input.settings.stages.flatMap(group => group.stages).find(value => value.stageNumber === stage);
  return row ? row.label[input.locale] || row.label.zh : "";
};
const dateTime = (value: string) => { const ms = Date.parse(value); return `${shanghaiDate(ms).slice(5).replace("-", ".")} ${new Date(ms + 8 * 3_600_000).toISOString().slice(11, 16)}`; };

export async function readDisplay(source: string, input: SourceInput): Promise<DisplayData | null> {
  const w = copy(input.locale);
  switch (source) {
    case "account.participant": {
      if (!input.identity.signedIn) return null;
      const child = input.identity.participants.find(row => row.id === input.identity.participant);
      if (!child) return { card: { title: w.card, subtitle: "", fields: [] } };
      const row = await summary(input);
      return { card: { title: child.name, subtitle: stageLabel(input, child.stage), fields: [
        { label: w.next, value: row?.next_session_at ? dateTime(row.next_session_at) : w.none },
        { label: w.stars, value: String(row?.star_total ?? 0) },
      ] } };
    }
    case "account.summary": {
      if (!input.identity.signedIn) return null;
      const row = await summary(input);
      return { metrics: [
        { label: w.stars, value: String(row?.star_total ?? 0), unit: "", hint: "" },
        { label: w.week, value: String(row?.week_session_count ?? 0), unit: w.times, hint: "" },
        { label: w.pending, value: String(row?.pending_assignment_count ?? 0), unit: w.items, hint: "" },
        { label: w.attendance, value: row?.attendance_rate_30d == null ? "—" : String(Math.round(Number(row.attendance_rate_30d) * (Number(row.attendance_rate_30d) <= 1 ? 100 : 1))), unit: row?.attendance_rate_30d == null ? "" : "%", hint: "" },
      ] };
    }
    case "account.checkins": {
      const db = input.identity.db;
      if (!db) return null;
      let query = db.from("miniapp_runtime_events").select("created_at").eq("command", "checkin").gte("created_at", new Date(input.now - 30 * 86_400_000).toISOString());
      if (input.identity.participant) query = query.eq("participant_id", input.identity.participant);
      const days = new Set(((requireResult(await query) ?? []) as { created_at: string }[]).map(row => shanghaiDate(Date.parse(row.created_at))));
      const today = Date.parse(shanghaiDate(input.now) + "T00:00:00+08:00"), weekday = (new Date(today + 8 * 3_600_000).getUTCDay() + 6) % 7;
      const week = Array.from({ length: weekday + 1 }, (_, i) => shanghaiDate(today - i * 86_400_000)).filter(day => days.has(day)).length;
      return { progress: [
        { label: w.checkWeek, value: week, max: 7, caption: `${week} / 7 ${w.days}` },
        { label: w.checkTotal, value: days.size, max: 30, caption: `${days.size} ${w.days}` },
      ] };
    }
    default: return {};
  }
}
