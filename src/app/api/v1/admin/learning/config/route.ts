import { z } from "zod";
import { authorizedClient } from "@/features/school/actions/guards";
import type { RegistrationRpc } from "@/features/parent-portal/course-server";
import { parseLearningPolicyConfig, policyKeySchema } from "@/features/school/learning-rewards/policy";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
async function handle(request: Request, write: boolean) {
  try {
    const { supabase } = await authorizedClient("organization.profile.manage");
    if (write) {
      const target = new URL(request.url), origin = request.headers.get("origin");
      // Next can use its listening address internally; Host preserves the browser's destination.
      let source: URL | null = null; try { source = origin ? new URL(origin) : null; } catch { /* Invalid origins are denied. */ }
      if (!source || source.protocol !== target.protocol || source.host !== (request.headers.get("host") || target.host) || request.headers.get("sec-fetch-site") === "cross-site") {
        return Response.json({ code: "FORBIDDEN" }, { status: 403, headers });
      }
    }
    const key = policyKeySchema.parse(new URL(request.url).searchParams.get("key"));
    let name = "read_learning_policy", args: Record<string, unknown> = { p_key: key };
    if (write) {
      if (Number(request.headers.get("content-length")) > 100000) throw new Error("VALIDATION");
      const text = await request.text(); if (text.length > 100000) throw new Error("VALIDATION");
      const body = z.object({ operation: z.enum(["saveDraft", "publish"]), draftVersion: z.number().int().nonnegative(), baseVersion: z.number().int().nonnegative().optional(), config: z.unknown().optional() }).strict().parse(JSON.parse(text));
      if (body.operation === "publish") { name = "publish_learning_policy"; args.p_draft_version = body.draftVersion; }
      else { name = "save_learning_policy_draft"; args = { ...args, p_draft_version: body.draftVersion, p_base_version: z.number().int().nonnegative().parse(body.baseVersion), p_config: parseLearningPolicyConfig(key, body.config) }; }
    }
    const result = await (supabase.rpc as unknown as RegistrationRpc)(name, args);
    if (result.error) throw new Error(result.error.message);
    return Response.json(result.data, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = ["FORBIDDEN", "UNAUTHENTICATED", "FORM_CHANGED", "VALIDATION", "NOT_FOUND"].find(c => message.includes(c)) || (error instanceof z.ZodError || error instanceof SyntaxError ? "VALIDATION" : "UNAVAILABLE");
    return Response.json({ code }, { status: code === "UNAUTHENTICATED" ? 401 : code === "FORBIDDEN" ? 403 : code === "FORM_CHANGED" ? 409 : code === "VALIDATION" ? 400 : code === "NOT_FOUND" ? 404 : 503, headers });
  }
}
export const GET = (request: Request) => handle(request, false);
export const PUT = (request: Request) => handle(request, true);
