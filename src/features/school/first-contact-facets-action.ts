"use server";

import { z } from "zod";
import { actionError } from "@/lib/action-result";
import { staffRpcClient } from "./actions/guards";
import { COMMON_CODES, parse } from "./actions/schemas";
import { getOrganizationTimezoneV2 } from "./organization-locations";
import { loadStudentStageFieldPage } from "./student-stage-table-data";
import type { FollowupServerFields } from "./followup-table-page";

const inputSchema = z.object({ locale: z.enum(["zh", "en"]), fields: z.string().max(16_384) });

/** 按当前登录者的权限读取完整候选，浏览器只接收候选值，不接收额外学生行。 */
export async function getFirstContactFacetsAction(input: z.input<typeof inputSchema>) {
  try {
    const value = parse(inputSchema, input);
    // 与列表相同：先验证登录，RPC 再验证员工身份、查看权限及记录范围。
    const { user } = await staffRpcClient();
    const timeZone = await getOrganizationTimezoneV2();
    const data = await loadStudentStageFieldPage({ stage: "awaiting_first_contact", population: "records", scope: "all",
      q: "", detail: "", page: 1, pageSize: 20, fields: value.fields },
    { locale: value.locale, timeZone, now: Date.now() }, user.id, { includeRecordHints: false });
    return { ok: true as const, data: data.fieldView.facets };
  } catch (error) { return actionError<FollowupServerFields["facets"]>(error, ["FORBIDDEN_SCOPE", ...COMMON_CODES]); }
}
