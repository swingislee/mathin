import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { interactiveBindingKeys } from "@/features/interactive-questions/contract";
import { trustedQuestionComposition } from "@/features/interactive-questions/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { HomeworkDocument, HomeworkWorkspace } from "./homework-document-contract";

export function trustedHomeworkDocument(document: HomeworkDocument): HomeworkDocument {
  return { ...document, questions: document.questions.map(q => ({ ...q,
    composition: q.composition ? trustedQuestionComposition(q.composition) : q.composition,
    answerComposition: q.answerComposition ? trustedQuestionComposition(q.answerComposition) : q.answerComposition,
  })), overrides: document.overrides.map(row => ({ ...row, composition: row.composition ? trustedQuestionComposition(row.composition) : row.composition })) };
}
export function homeworkAssetLocation(asset: { kind: string; binding_key: string; sha256: string }) {
  return asset.kind === "h5" ? { bucket: "cw-h5-drafts", path: `homework/${asset.binding_key}/index.html` }
    : { bucket: "cw-objects", path: `sha256/${asset.sha256.slice(0, 2)}/${asset.sha256}` };
}
export async function resolveHomeworkWorkspace(supabase: SupabaseClient<Database>, workspace: HomeworkWorkspace): Promise<HomeworkWorkspace> {
  const data = { ...workspace, document: trustedHomeworkDocument(workspace.document),
    classTemplate: workspace.classTemplate ? trustedHomeworkDocument(workspace.classTemplate) : null,
    lectureTemplate: workspace.lectureTemplate ? trustedHomeworkDocument(workspace.lectureTemplate) : null };
  const keys = interactiveBindingKeys([data.document, data.classTemplate, data.lectureTemplate]);
  if (!keys.length) return { ...data, bindingUrls: {} };
  const { data: assets, error } = await supabase.from("homework_assets").select("binding_key,kind,sha256").in("binding_key", keys);
  if (error || assets.length !== keys.length) throw new Error("ASSET_UNAVAILABLE");
  const admin = createAdminClient();
  const urls = await Promise.all(assets.map(async asset => {
    const location = homeworkAssetLocation(asset);
    const { data: signed, error: signError } = await admin.storage.from(location.bucket).createSignedUrl(location.path, 3600);
    if (signError || !signed) throw new Error("ASSET_UNAVAILABLE");
    return [asset.binding_key, signed.signedUrl];
  }));
  return { ...data, bindingUrls: Object.fromEntries(urls) };
}
