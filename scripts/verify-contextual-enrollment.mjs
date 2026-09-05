// Run: node --experimental-strip-types scripts/verify-contextual-enrollment.mjs
// 本机 API 合同与页面启动检查；视觉、悬浮、侧栏与拖动由产品负责人验收。
import fs from "node:fs";
import { createServerClient } from "@supabase/ssr";
import { z } from "zod";
import { loadFixedAccount } from "../e2e/support/fixed-accounts.ts";
import { activityEnrollmentContextSchema, enrollmentWorkflowOptionsSchema, placementMemberSchema } from "../src/features/school/enrollment-workflow-contract.ts";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/)
  .filter((line) => /^[A-Z_]+=/.test(line)).map((line) => {
    const at = line.indexOf("=");
    return [line.slice(0, at), line.slice(at + 1).trim().replace(/^(["'])(.*)\1$/, "$2")];
  }));
if (env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:35421") throw new Error("Expected isolated local Supabase");
const account = loadFixedAccount("principal");
if (!account) throw new Error("Fixed development principal unavailable");
const cookies = new Map();
const client = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  cookies: { getAll: () => [...cookies].map(([name, value]) => ({ name, value })), setAll: (items) => items.forEach(({ name, value }) => cookies.set(name, value)) },
});
const { error } = await client.auth.signInWithPassword(account);
if (error) throw new Error(`Fixed principal login failed: ${error.code}`);
try {
  const results = await Promise.all([
    client.rpc("get_enrollment_placement_board"), client.rpc("get_post_activity_followups"),
  ]);
  for (const result of results) if (result.error) throw new Error(result.error.message);
  const board = results[0].data;
  enrollmentWorkflowOptionsSchema.parse(board.options);
  z.array(placementMemberSchema).parse(board.members);
  const followups = z.array(activityEnrollmentContextSchema).parse(results[1].data);
  const source = followups.find((item) => item.eligible);
  if (source) {
    const result = await client.rpc("get_activity_enrollment_context", { p_registration_id: source.registrationId, p_invitation_id: null });
    if (result.error) throw new Error(result.error.message);
    activityEnrollmentContextSchema.parse(result.data);
  }
  console.log(JSON.stringify({ api: "PASS", enrollments: board.enrollments.length, assignedMembers: board.members.length, followups: followups.length, sourceContext: source ? "PASS" : "NO_EXISTING_SOURCE" }));
  const paths = ["/dashboard/enrollments", "/dashboard/invitations?queue=post_activity", "/dashboard/assessments"];
  const publicClass = await client.from("activities").select("id").eq("kind", "public_class").is("deleted_at", null).limit(1).maybeSingle();
  if (publicClass.error) throw new Error(publicClass.error.message);
  if (publicClass.data) paths.push(`/dashboard/activities/${publicClass.data.id}?view=review`);
  if (source) paths.push(`/dashboard/activities/${source.activityId}?node=assessment&view=review`);
  for (const locale of ["zh", "en"]) {
    const checked = [];
    for (const path of (process.argv.includes("--assessment-only") ? ["/dashboard/assessments"] : paths)) {
      const response = await fetch(`http://192.168.5.213:3130/${locale}${path}`, {
        headers: { cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; ") },
        redirect: "manual", signal: AbortSignal.timeout(45000),
      });
      const html = await response.text();
      if (response.status !== 200 || /Could not find|schema cache|MISSING_MESSAGE|NEXT_REDIRECT|__next_error__/.test(html)) {
        const issue = html.replaceAll('\\"', '"').match(/"message"\s*:\s*"([^"\n]{1,300})"/);
        console.error(JSON.stringify({ pageError: issue?.[1], location: response.headers.get("location")?.split("?")[0] }));
        throw new Error(`Page did not render: ${locale}${path}, HTTP ${response.status}`);
      }
      checked.push({ path: `/${locale}${path}`, status: response.status });
    }
    console.log(JSON.stringify({ pages: checked, scope: "authenticated startup only; human interaction acceptance pending" }));
  }
} finally {
  await client.auth.signOut({ scope: "local" });
}
