"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { actionError, type ActionResult } from "@/lib/action-result";
import type { Json } from "@/lib/database.types";
import { authorizedClient, staffRpcClient } from "./actions/guards";
import { COMMON_CODES, parse, requiredText, uuid } from "./actions/schemas";
import { homeworkScopeSchema, homeworkDocumentSchema, homeworkWorkspaceSchema, type HomeworkScope, type HomeworkWorkspace } from "./homework-document-contract";
import { resolveHomeworkWorkspace, trustedHomeworkDocument } from "./homework-interactive-assets";

const targetSchema = z.object({ scope: homeworkScopeSchema, targetId: uuid });
const saveSchema = targetSchema.extend({ revision: requiredText(100), document: homeworkDocumentSchema });
export async function readHomeworkDocument(scope: HomeworkScope, targetId: string): Promise<ActionResult<HomeworkWorkspace>> {
  try {
    const value = parse(targetSchema, { scope, targetId });
    const { supabase } = await staffRpcClient();
    const { data, error } = await supabase.rpc("get_homework_document", { p_scope: value.scope, p_target_id: value.targetId });
    if (error) throw new Error(error.message);
    return { ok: true, data: await resolveHomeworkWorkspace(supabase, homeworkWorkspaceSchema.parse(data)) };
  } catch (error) { return actionError(error, COMMON_CODES); }
}
export async function saveHomeworkDocument(input: z.infer<typeof saveSchema>): Promise<ActionResult<HomeworkWorkspace>> {
  try {
    const value = parse(saveSchema, input);
    const { supabase } = await authorizedClient(value.scope === "lecture" ? "courseware.review" : "review.write");
    const document = JSON.parse(JSON.stringify(trustedHomeworkDocument(value.document))) as Json;
    const { data, error } = await supabase.rpc("save_homework_document", { p_scope: value.scope, p_target_id: value.targetId, p_revision: value.revision, p_document: document });
    if (error) throw new Error(error.message);
    revalidatePath("/[locale]/dashboard/classes", "layout");
    revalidatePath("/[locale]/dashboard/sessions", "layout");
    revalidatePath("/[locale]/dashboard/courseware", "layout");
    // 保存成功后返回已提交版本；临时资源签名失败不能把一次成功写入报告为失败。
    return { ok: true, data: homeworkWorkspaceSchema.parse(data) };
  } catch (error) { return actionError(error, [...COMMON_CODES, "CONFLICT", "QUESTION_LIMIT", "QUESTION_IN_USE"]); }
}
