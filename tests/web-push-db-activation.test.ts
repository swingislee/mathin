import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadFixedAccount } from "../e2e/support/fixed-accounts";
import { assertNonProductionWriteTarget } from "../scripts/lib/r1-write-target-policy.mjs";

// 使用明确登记的 loopback Docker 目标和固定开发账号；整个候选迁移及行为断言均回滚。
const enabled = process.env.MATHIN_WEB_PUSH_LOCAL_DB_TEST === "1";
function docker(args: string[], input?: string) {
  const result = spawnSync("docker", args, { input, encoding: "utf8", timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    const diagnostic = String(result.stderr || result.error?.message || "failure")
      .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "[id]").replace(/[^\s@]+@[^\s]+/g, "[account]").slice(0, 1200);
    throw new Error(`LOCAL_PUSH_DB_CHECK_FAILED: ${diagnostic}`);
  }
  return result.stdout.trim();
}
function sql(input: string) {
  return docker(["exec", "-i", "supabase-db", "psql", "-U", "supabase_admin", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], input);
}
const quoted = (value: string) => "'" + value.replaceAll("'", "''") + "'";

describe.skipIf(!enabled)("loopback-only employee push activation migration", () => {
  it("rolls back the migration and fixed-account behavior with independent zero-residue verification", () => {
    const origin = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    assertNonProductionWriteTarget({ operation: "web-push:activation-db-test", supabaseUrl: origin });
    const originUrl = new URL(origin);
    expect(originUrl.hostname).toBe("127.0.0.1");
    expect(docker(["context", "show"])).toBe("desktop-linux");
    expect(docker(["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"])).toMatch(/^npipe:\/\//);
    expect(docker(["port", "supabase-envoy", "8000/tcp"])).toBe(`127.0.0.1:${originUrl.port}`);
    const fingerprint = sql("begin read only; select encode(sha256(system_identifier::text::bytea),'hex') from pg_control_system(); rollback;");
    expect(fingerprint).toBe(process.env.MATHIN_WRITE_TARGET_FINGERPRINT);
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    const admin = loadFixedAccount("admin");
    const teacher = loadFixedAccount("teacher");
    if (!admin || !teacher) throw new Error("FIXED_DEVELOPMENT_ACCOUNTS_REQUIRED");
    const snapshot = `begin isolation level repeatable read read only;
      select jsonb_build_object(
        'profiles', (select md5(coalesce(string_agg(row_to_json(p)::text, '|' order by p.id), '')) from public.profiles p),
        'rollout', (select md5(coalesce(string_agg(row_to_json(r)::text, '|' order by r.recipient_id), '')) from public.notification_push_rollout_members r),
        'subscriptions', (select count(*) from public.web_push_subscriptions),
        'jobs', (select count(*) from public.jobs), 'events', (select count(*) from public.domain_events),
        'deliveries', (select count(*) from public.notification_deliveries),
        'flags', (select md5(coalesce(string_agg(row_to_json(f)::text, '|' order by f.id), '')) from public.feature_flag_versions f),
        'integration', (select md5(row_to_json(c)::text) from public.integration_channels c where channel='web_push'),
        'eligibility', md5(pg_get_functiondef('public.is_web_push_recipient_eligible(uuid,timestamptz)'::regprocedure)),
        'register', md5(pg_get_functiondef('public.register_my_web_push_subscription(text,text,integer,integer,text,text,text,text,text)'::regprocedure)),
        'sendTest', md5(pg_get_functiondef('public.send_my_web_push_test(uuid)'::regprocedure)),
        'newRpc', to_regprocedure('public.claim_web_push_jobs(text,integer,integer)')::text);
      rollback;`;
    const before = sql(snapshot);
    const migration = readFileSync("supabase/migrations/20260909009000_employee_web_push_activation_safety.sql", "utf8");
    const assertions = readFileSync("supabase/tests/web_push_activation_assertions.sql", "utf8");
    let result: string | undefined;
    try {
      result = sql(`begin isolation level serializable; set local statement_timeout='45s';
        do $$ begin
          perform set_config('push_test.admin_email', ${quoted(admin.email)}, true);
          perform set_config('push_test.teacher_email', ${quoted(teacher.email)}, true);
        end $$;
        ${migration}
        ${assertions}
        rollback;`);
    } finally {
      expect(sql(snapshot), "independent post-rollback snapshot").toBe(before);
    }
    expect(result).toContain("web_push_activation_assertions_passed");
  }, 60000);
});
