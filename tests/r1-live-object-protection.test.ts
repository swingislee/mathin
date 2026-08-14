import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");
const migration = read(
  "supabase",
  "migrations",
  "20260815000100_r1_live_object_protection_manifest.sql",
);

describe("R1-Live protected-object manifest and purge fail-closed contract", () => {
  it("binds every active manifest to the database system identifier fingerprint", () => {
    expect(migration).toContain("pg_catalog.pg_control_system()");
    expect(migration).toContain("public.r1_current_database_fingerprint()");
    expect(migration).toContain("PROTECTION_MANIFEST_TARGET_MISMATCH");
    expect(migration).toContain("database_fingerprint = current_fingerprint");
  });

  it("stores explicit protected and purge-allowed keys behind RLS without API grants", () => {
    expect(migration).toContain("create table public.r1_object_protection_manifests");
    expect(migration).toContain("create table public.r1_object_protection_entries");
    expect(migration).toContain("classification in ('protected', 'purge_allowed')");
    expect(migration).toContain("alter table public.r1_object_protection_manifests enable row level security");
    expect(migration).toContain("alter table public.r1_object_protection_entries enable row level security");
    expect(migration).toContain("revoke all on table public.r1_object_protection_manifests from public, anon, authenticated, service_role");
    expect(migration).toContain("revoke all on table public.r1_object_protection_entries from public, anon, authenticated, service_role");
  });

  it("does not seed or activate Xiaomi object classifications in a schema migration", () => {
    expect(migration).not.toMatch(/insert\s+into\s+public\.r1_object_protection_manifests/i);
    expect(migration).not.toMatch(/insert\s+into\s+public\.r1_object_protection_entries/i);
    expect(migration).not.toContain("10e3f97e32b018403c9074efa4e258d699530a487c47de89b5d307ab7ff21a0c");
    expect(migration).not.toContain("799d6a9c5d2a6fd5ec8d5ff3bef7f36a251d3488a7b387ce01d057b096463e39");
  });

  it("makes activation and every destructive call revalidate counts and the canonical entry hash", () => {
    expect(migration).toContain("public.r1_object_protection_entries_sha256");
    expect(migration).toContain("PROTECTION_MANIFEST_COUNT_MISMATCH");
    expect(migration).toContain("PROTECTION_MANIFEST_HASH_MISMATCH");
    expect(migration).toContain("PURGE_MANIFEST_COUNT_MISMATCH");
    expect(migration).toContain("public.r1_classroom_purge_footprint");
    expect(migration).toContain("public.r1_course_family_purge_footprint");
  });

  it("requires one protected active admin identity with a matching protected profile", () => {
    expect(migration).toContain("PROTECTION_MANIFEST_ADMIN_INVARIANT");
    expect(migration).toContain("PROTECTION_MANIFEST_IDENTITY_INCOMPLETE");
    expect(migration).toContain("entry_row.metadata ->> 'recoveryOwnerRef'");
    expect(migration).toContain("join public.profiles profile_row on profile_row.id = entry_row.object_key::uuid");
    expect(migration).toContain("from auth.users auth_row");
    expect(migration).toContain("actual_profile.role = identity_row.metadata ->> 'role'");
    expect(migration).toContain("profile_row.object_key = identity_row.object_key");
  });

  it("keeps purpose, soft-delete, typed-name and relationship checks as defense in depth", () => {
    expect(migration).toContain("family_row.purpose <> 'test'");
    expect(migration).toContain("classroom_row.purpose <> 'test'");
    expect(migration).toContain("VARIANT_NOT_TRASHED");
    expect(migration).toContain("CLASSROOM_NOT_TRASHED");
    expect(migration).toContain("p_confirm_name <> family_row.title");
    expect(migration).toContain("p_confirm_name <> classroom_row.name");
    expect(migration).toContain("COURSE_HAS_REPLACEMENT_HISTORY");
    expect(migration).toContain("CLASSROOM_HAS_HISTORY");
  });

  it("blocks protected roots and descendants and only lists explicitly allowlisted targets", () => {
    expect(migration).toContain("PROTECTED_OBJECT_IN_PURGE_SET");
    expect(migration).toContain("PURGE_MANIFEST_TARGET_NOT_ALLOWED");
    expect(migration).toContain("public.r1_classroom_purge_has_protected_object");
    expect(migration).toContain("public.r1_course_family_purge_has_protected_object");
    expect(migration).toMatch(/join public\.r1_object_protection_entries entry_row[\s\S]*entry_row\.classification = 'purge_allowed'/);
  });

  it("registers the transaction-rollback SQL assertions in the R1 database audit", () => {
    const runner = read("scripts", "run-r1-db-audit.mjs");
    expect(runner).toContain('"r1_live_object_protection_assertions.sql"');
  });

  it("returns manifest-specific failures through the existing purge actions", () => {
    const actions = read("src", "features", "school", "actions", "testdata.ts");
    expect(actions).toContain("PROTECTION_MANIFEST_REQUIRED");
    expect(actions).toContain("PURGE_MANIFEST_TARGET_NOT_ALLOWED");
    expect(actions).toContain("PROTECTED_OBJECT_IN_PURGE_SET");
  });
});
