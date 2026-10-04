#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const input = process.argv[2] ?? "docs/manifests/production-admin.example.json";
const target = path.resolve(process.cwd(), input);
const failures = [];
const fail = (message) => failures.push(message);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const date = (value) => typeof value === "string" && !Number.isNaN(Date.parse(value));

if (!fs.existsSync(target)) {
  console.error(`Production admin manifest not found: ${input}`);
  process.exit(2);
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(target, "utf8"));
} catch (error) {
  console.error(`Invalid JSON: ${error.message}`);
  process.exit(2);
}

if (manifest.version !== 1) fail("version must be 1");
if (manifest.environment !== "production") fail("environment must be production");
for (const key of ["projectId", "databaseId"]) if (typeof manifest[key] !== "string" || manifest[key].length < 3) fail(`${key} is required`);
if (!date(manifest.generatedAt)) fail("generatedAt must be an ISO date-time");
if (!Array.isArray(manifest.approvedBy) || new Set(manifest.approvedBy).size < 2) fail("approvedBy must contain two distinct approvers");

const admin = manifest.admin ?? {};
if (!uuid.test(admin.authUserId ?? "")) fail("admin.authUserId must be a UUID");
if (!uuid.test(admin.profileId ?? "")) fail("admin.profileId must be a UUID");
if (admin.authUserId !== admin.profileId) fail("admin auth/profile IDs must match the one-profile-per-user contract");
if (!email.test(admin.email ?? "")) fail("admin.email must be valid");
if (admin.role !== "admin") fail("admin.role must be admin");
if (!Array.isArray(admin.staffPermissions)) fail("admin.staffPermissions must be an array");
if (admin.mfa?.required !== true || !Number.isInteger(admin.mfa?.verifiedFactorCount) || admin.mfa.verifiedFactorCount < 1 || !date(admin.mfa?.verifiedAt)) fail("admin MFA must be required and have at least one verified factor");
if (!admin.recovery?.primaryContact || !admin.recovery?.secondaryContact || admin.recovery.primaryContact === admin.recovery.secondaryContact) fail("recovery contacts must be two distinct people");
if (!admin.recovery?.offlineCredentialEnvelopeId || !date(admin.recovery?.lastTestedAt)) fail("offline envelope ID and last recovery test are required");

const forbiddenKeys = /password|secret|token|recoverycode|service.?role/i;
function scan(value, trail = "root") {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (forbiddenKeys.test(key)) fail(`${trail}.${key} must not store credentials`);
    scan(nested, `${trail}.${key}`);
  }
}
scan(manifest);

if (failures.length) {
  console.error("Production admin manifest validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Production admin manifest valid: one admin, MFA=${admin.mfa.verifiedFactorCount}, dual approval present.`);
