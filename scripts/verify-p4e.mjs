import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const migrations = fs.readdirSync(path.join(root, "supabase", "migrations"))
  .filter((name) => name.includes("p4e_"))
  .sort()
  .map((name) => read(path.join("supabase", "migrations", name)))
  .join("\n");

const sources = {
  migrations,
  rls: read("supabase/tests/p4e_security_assertions.sql"),
  backup: read("scripts/infra/p4e-backup.sh") + read("scripts/infra/p4e-disk-check.sh"),
  offline:
    read("src/features/classroom/sync/eventlog.ts") +
    read("src/features/classroom/live/LiveShell.tsx") +
    read("scripts/p4e-offline-fixture.mjs") +
    read("tests/p4e-offline.test.ts"),
  observability: read("src/instrumentation.ts"),
  operations: read("src/instrumentation.ts") + read("src/app/[locale]/dashboard/operations/page.tsx"),
  phone: read("src/components/phone-auth-form.tsx") + read("src/features/school/actions.ts"),
  video: read("src/features/school/video-actions.ts"),
  privacy: read("src/features/notebook/actions.ts") + read("src/features/school/customer-actions.ts"),
};

const assertions = [
  ["backup database and Storage", "backup", /pg_dump[\s\S]*storage\.tar\.gz/],
  ["backup checksum and disk thresholds", "backup", /SHA256SUMS[\s\S]*CRITICAL_PERCENT/],
  ["bind claim rate limit", "migrations", /RATE_LIMITED/],
  ["one-time guardian invitation", "migrations", /guardian_bind_invitations/],
  ["authoritative teacher topic", "migrations", /session_broadcast_send_authoritative_teacher/],
  ["whiteboard optimistic lock", "migrations", /VERSION_CONFLICT/],
  ["domain event append-only", "migrations", /DOMAIN_EVENTS_APPEND_ONLY/],
  ["school term axis", "migrations", /create table public\.school_terms/],
  ["state transition guard", "migrations", /INVALID_STATUS_TRANSITION/],
  ["migration checksum ledger", "migrations", /schema_migrations[\s\S]*checksum/],
  ["attendance reversal ledger", "migrations", /reverses_id/],
  ["leave and makeup workflow", "migrations", /get_session_change_options/],
  ["student merge audit", "migrations", /student\.merged/],
  ["runtime RLS denial assertions", "rls", /ANON_PRIVATE_NOTE_WAS_VISIBLE[\s\S]*FOREIGN_LIKE_WAS_ACCEPTED[\s\S]*CROSS_SCOPE_STORAGE_INSERT_WAS_ACCEPTED/],
  ["offline outbox and restart test", "offline", /STORE_OUTBOX[\s\S]*resumes the sequence after restart/],
  ["repeatable ten-minute offline drill", "offline", /offlineDrill[\s\S]*verifyFixture/],
  ["server error sink", "observability", /MATHIN_ERROR_REPORT_URL[\s\S]*observability\.delivery_failed/],
  ["append-only operational error dashboard", "operations", /operational_errors[\s\S]*requirePerm\(locale, "audit\.view"\)/],
  ["guardian consent and requests", "migrations", /guardian_consents[\s\S]*account_requests/],
  ["platform post moderation", "privacy", /moderate_post/],
  ["private signed video URL", "video", /session-videos[\s\S]*createSignedUrl/],
  ["phone OTP and account provisioning", "phone", /signInWithOtp[\s\S]*provisionStudentPhoneAccountAction/],
  ["staff deactivation", "migrations", /staff\.deactivated/],
  ["substitute teacher override", "migrations", /assign_session_substitute/],
  ["guardian visibility scopes", "migrations", /set_guardian_scope/],
];

const missing = assertions
  .filter(([, source, pattern]) => !pattern.test(sources[source]))
  .map(([label]) => label);
if (missing.length) {
  console.error(`P4E audit missing: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`P4E static audit passed (${assertions.length} controls)`);
