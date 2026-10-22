import "server-only";
import { requireResult } from "@/features/parent-portal/server";
import type { RegistrationRpc } from "@/features/parent-portal/course-server";
import { learningStatusNames, type RewardAccount } from "@/features/school/learning-rewards/contract";
import { item, dateTimeLabel, type SourceInput, type SourceResult } from "../runtime/sources";
import type { DisplayData } from "../runtime/display";

async function account(input: SourceInput, cursor = false): Promise<RewardAccount | null> {
  if (!input.identity.db || !input.identity.participant) return null;
  return requireResult(await (input.identity.db.rpc as unknown as RegistrationRpc)("read_learning_points", {
    p_student: input.identity.participant, p_before: cursor && input.cursor ? input.cursor : null,
  })) as RewardAccount;
}
export async function pointsDisplay(input: SourceInput): Promise<DisplayData | null> {
  const data = await account(input);
  if (!data) return input.identity.db ? { metrics: [] } : null;
  const zh = input.locale === "zh";
  return { metrics: [{ label: zh ? "可用积分" : "Available points", value: String(data.available), unit: "",
    hint: data.balance < 0 ? (zh ? `待抵扣 ${-data.balance} 积分，后续奖励先抵扣。` : `${-data.balance} points to offset from future rewards.`) : "" }] };
}
export async function pointsSource(source: string, input: SourceInput): Promise<SourceResult> {
  const data = await account(input, source === "rewards.ledger"), zh = input.locale === "zh";
  if (!data) return { items: [], facets: [] };
  if (source === "rewards.rules") {
    const r = data.rules;
    const levels = r.homeworkStatuses.map(s => learningStatusNames[s]?.[input.locale] || s).join(zh ? "、" : ", ");
    return { facets: [], items: [
      item({ id: "stars", title: zh ? "活动星星" : "Activity stars", summary: r.starsEnabled
        ? (zh ? `每颗星奖励 ${r.pointsPerStar} 积分；撤销星星会冲回原奖励。` : `${r.pointsPerStar} points per star. Revocations reverse the original reward.`)
        : (zh ? "暂未开启星星转换" : "Star rewards are off") }),
      item({ id: "homework", title: zh ? "任务奖励" : "Task reward", summary: r.homeworkEnabled
        ? (zh ? `主理人登记的全部题目达到 ${levels} 中的任一档位，每份任务奖励 ${r.homeworkPoints} 积分，只奖励一次。` : `All questions must be host-recorded at one of: ${levels}. ${r.homeworkPoints} points once per task.`)
        : (zh ? "暂未开启任务奖励" : "Task rewards are off") }),
      item({ id: "history", title: zh ? "积分说明" : "About points", summary: zh ? "规则变更只影响后续奖励。历史流水保留原值，已有星星不自动折算。" : "Rule changes apply to future rewards. History keeps original amounts; existing stars are not converted." }),
    ] };
  }
  const entries = data.entries.slice(0, input.limit ?? 30);
  return { facets: [], next: entries.length && (data.next || data.entries.length > entries.length) ? entries.at(-1)!.id : "",
    items: entries.map(e => item({ id: e.id, title: e.note, subtitle: dateTimeLabel(e.created_at),
      status: { label: `${e.amount > 0 ? "+" : ""}${e.amount}`, tone: e.amount > 0 ? "positive" : "neutral" },
      meta: [zh ? `变动后余额 ${e.balance_after}` : `Balance after: ${e.balance_after}`] })) };
}
