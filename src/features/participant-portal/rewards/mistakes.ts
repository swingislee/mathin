import "server-only";
import { requireResult } from "@/features/parent-portal/server";
import type { RegistrationRpc } from "@/features/parent-portal/course-server";
import { learningStatuses, learningStatusNames, mistakeKey, type MistakePage } from "@/features/school/learning-mistakes/contract";
import { item, dateTimeLabel, type SourceInput, type SourceResult } from "../runtime/sources";

export async function mistakesSource(source: string, input: SourceInput): Promise<SourceResult> {
  const { db, participant } = input.identity;
  if (!db || !participant) return { items: [], facets: [] };
  const detail = source === "learning.mistakeDetail", zh = input.locale === "zh";
  const record = detail ? mistakeKey.safeParse(input.params?.recordId) : null;
  if (detail && !record?.success) return { items: [], facets: [] };
  const kind = ["classroom", "homework"].includes(input.filters.kind) ? input.filters.kind : "";
  const status = [...learningStatuses, "review", "mastered"].find(s => s === input.filters.status) || "";
  const page = requireResult(await (db.rpc as unknown as RegistrationRpc)("read_learning_mistakes", { p_student: participant, p_item: record?.success ? record.data : null,
    p_before: detail ? null : input.cursor || null, p_kind: kind, p_status: status })) as MistakePage;
  if (!page.enabled) return { facets: [], items: [item({ id: "not-enabled", title: zh ? "错题本暂未开放" : "Mistake book is not yet enabled" })] };
  if (detail) return { facets: [], items: page.items.map(r => item({ id: r.id, title: r.title,
    subtitle: `${r.collected_at ? (r.mastered ? (zh ? "已掌握 · " : "Mastered · ") : (zh ? "待回顾 · " : "To review · ")) : ""}${learningStatusNames[r.status][input.locale]} · ${dateTimeLabel(r.marked_at)}`,
    summary: [!r.included ? (zh ? "记录已更新，此题已不在当前收录范围。" : "The record has changed and is no longer included.") : "",
      `${r.classroom_name} · ${r.source_title}`, r.lesson_at ? dateTimeLabel(r.lesson_at) : "",
      r.note ? (zh ? `老师评语：\n${r.note}` : `Teacher note:\n${r.note}`) : "", r.instructions ? (zh ? `任务说明：\n${r.instructions}` : `Task instructions:\n${r.instructions}`) : "",
      zh ? "此逐题登记未保存独立题干，请结合原活动／任务材料回顾。" : "This record has no separate question content. Review it with the original activity or task materials."].filter(Boolean).join("\n\n") })) };
  const rows = page.items.slice(0, input.limit ?? 30), all = zh ? "全部" : "All";
  const options = [{ value: "", label: all, group: "" }, ...(page.rules.history_mode === "retain" ? [{ value: "review", label: zh ? "待回顾" : "To review", group: "" }, { value: "mastered", label: zh ? "已掌握" : "Mastered", group: "" }] : []), ...learningStatuses.map(s => ({ value: s, label: learningStatusNames[s][input.locale], group: "" }))];
  return { next: rows.length && (page.next || page.items.length > rows.length) ? rows.at(-1)!.id : "", facets: [
    { id: "kind", label: zh ? "来源" : "Source", hint: "", value: kind, valueLabel: kind === "classroom" ? (zh ? "活动" : "Activity") : kind === "homework" ? (zh ? "任务" : "Task") : all,
      options: [{ value: "", label: all, group: "" }, { value: "classroom", label: zh ? "活动" : "Activity", group: "" }, { value: "homework", label: zh ? "任务" : "Task", group: "" }] },
    { id: "status", label: zh ? "记录状态" : "Status", hint: "", value: status, valueLabel: options.find(o => o.value === status)?.label || all, options },
  ], items: rows.map(r => item({ id: r.id, title: r.title, subtitle: dateTimeLabel(r.marked_at), summary: r.note, meta: [r.classroom_name, r.source_title],
    tags: [r.kind === "classroom" ? (zh ? "活动" : "Activity") : (zh ? "任务" : "Task"), ...(r.collected_at && page.rules.history_mode === "retain" ? [r.mastered ? (zh ? "已掌握" : "Mastered") : (zh ? "待回顾" : "To review")] : [])], status: { label: learningStatusNames[r.status][input.locale], tone: r.mastered ? "positive" : "neutral" },
    actionLabel: zh ? "查看记录" : "View record", action: { type: "screen", screen: "learning-mistake", params: { recordId: r.id } } })) };
}
