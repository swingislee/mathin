import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const migrations = fs.readdirSync(path.join(root, "supabase", "migrations"))
  .filter((name) => name.includes("p4e_")).sort().map((name) => read(path.join("supabase", "migrations", name))).join("\n");
const assertions = [
  ["bind claim rate limit", /RATE_LIMITED/],
  ["one-time guardian invitation", /guardian_bind_invitations/],
  ["authoritative teacher topic", /session_broadcast_send_authoritative_teacher/],
  ["whiteboard optimistic lock", /VERSION_CONFLICT/],
  ["domain event append-only", /DOMAIN_EVENTS_APPEND_ONLY/],
  ["school term axis", /create table public\.school_terms/],
  ["state transition guard", /INVALID_STATUS_TRANSITION/],
  ["attendance reversal ledger", /reverses_id/],
  ["student merge audit", /student\.merged/],
  ["guardian consent", /guardian_consents/],
  ["staff deactivation", /staff\.deactivated/]
];
const missing = assertions.filter(([, pattern]) => !pattern.test(migrations)).map(([label]) => label);
if (missing.length) {
  console.error(`P4E audit missing: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`P4E static audit passed (${assertions.length} controls)`);
