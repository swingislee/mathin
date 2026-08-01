"use server";

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import type { Json } from "@/lib/database.types";
import {
  ORGANIZATION_FEATURE_KEYS,
  ORGANIZATION_RULE_DOMAINS,
  type OrganizationFeatureKey,
  type OrganizationRuleDomain,
} from "../organization-settings-contract";
import { authorizedClient, nullableRpcArg } from "./guards";
import { COMMON_CODES, dateOnly, datetime, intInRange, parse, requiredText, text, uuid } from "./schemas";

const SETTINGS_CODES = [
  ...COMMON_CODES,
  "INVALID_ORGANIZATION",
  "INVALID_CAMPUS",
  "INVALID_ROOM",
  "INVALID_HOLIDAY",
  "INVALID_RULE",
  "INVALID_FEATURE_FLAG",
  "FINANCE_RELEASE_CLOSED",
  "INVALID_TERM",
  "DEFAULT_CAMPUS_REQUIRED",
  "NOT_FOUND",
] as const;

const timezone = z.string().trim().min(1).max(64);
const campusCode = z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9-]{1,39}$/);
const roomCode = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/);
const optionalTimezone = timezone.nullable();
const effectiveInput = z.object({ effectiveAt: datetime, reason: requiredText(200) });

export async function updateOrganizationProfileAction(input: {
  name: string;
  timezone: string;
  defaultLocale: "zh" | "en";
}): Promise<ActionResult> {
  try {
    const value = parse(z.object({ name: requiredText(100), timezone, defaultLocale: z.enum(["zh", "en"]) }), input);
    const { supabase } = await authorizedClient("organization.settings.manage");
    const { error } = await supabase.rpc("update_organization_profile", {
      p_name: value.name,
      p_timezone: value.timezone,
      p_default_locale: value.defaultLocale,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, SETTINGS_CODES);
  }
}

export async function createCampusAction(input: { code: string; name: string; timezone: string | null }): Promise<ActionResult> {
  try {
    const value = parse(z.object({ code: campusCode, name: requiredText(100), timezone: optionalTimezone }), input);
    const { supabase } = await authorizedClient("organization.settings.manage");
    const { error } = await supabase.rpc("create_campus", {
      p_code: value.code,
      p_name: value.name,
      p_timezone: nullableRpcArg(value.timezone),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, SETTINGS_CODES);
  }
}

export async function updateCampusAction(input: {
  campusId: string;
  name: string;
  timezone: string | null;
  status: "active" | "archived";
  isDefault: boolean;
}): Promise<ActionResult> {
  try {
    const value = parse(z.object({ campusId: uuid, name: requiredText(100), timezone: optionalTimezone, status: z.enum(["active", "archived"]), isDefault: z.boolean() }), input);
    const { supabase } = await authorizedClient("organization.settings.manage");
    const { error } = await supabase.rpc("update_campus", {
      p_campus_id: value.campusId,
      p_name: value.name,
      p_timezone: value.timezone ?? "",
      p_status: value.status,
      p_is_default: value.isDefault,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, SETTINGS_CODES);
  }
}

export async function createCampusRoomAction(input: {
  campusId: string;
  code: string;
  name: string;
  capacity: number | null;
}): Promise<ActionResult> {
  try {
    const value = parse(z.object({ campusId: uuid, code: roomCode, name: requiredText(100), capacity: intInRange(1, 500).nullable() }), input);
    const { supabase } = await authorizedClient("organization.settings.manage");
    const { error } = await supabase.rpc("create_campus_room", {
      p_campus_id: value.campusId,
      p_code: value.code,
      p_name: value.name,
      p_capacity: nullableRpcArg(value.capacity),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, SETTINGS_CODES);
  }
}

export async function setCampusRoomActiveAction(roomId: string, isActive: boolean): Promise<ActionResult> {
  try {
    const value = parse(z.object({ roomId: uuid, isActive: z.boolean() }), { roomId, isActive });
    const { supabase } = await authorizedClient("organization.settings.manage");
    const { error } = await supabase.rpc("set_campus_room_active", { p_room_id: value.roomId, p_is_active: value.isActive });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, SETTINGS_CODES);
  }
}

const holidaySchema = z.object({
  campusId: uuid.nullable(),
  name: requiredText(100),
  kind: z.enum(["closed", "teaching", "makeup"]),
  startsOn: dateOnly,
  endsOn: dateOnly,
}).refine((value) => value.endsOn >= value.startsOn);

export async function createSchoolHolidayAction(input: {
  campusId: string | null;
  name: string;
  kind: "closed" | "teaching" | "makeup";
  startsOn: string;
  endsOn: string;
}): Promise<ActionResult> {
  try {
    const value = parse(holidaySchema, input);
    const { supabase } = await authorizedClient("organization.settings.manage");
    const { error } = await supabase.rpc("create_school_holiday", {
      p_campus_id: nullableRpcArg(value.campusId),
      p_name: value.name,
      p_kind: value.kind,
      p_starts_on: value.startsOn,
      p_ends_on: value.endsOn,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, SETTINGS_CODES);
  }
}

export async function archiveSchoolHolidayAction(holidayId: string): Promise<ActionResult> {
  try {
    const id = parse(uuid, holidayId);
    const { supabase } = await authorizedClient("organization.settings.manage");
    const { error } = await supabase.rpc("archive_school_holiday", { p_holiday_id: id });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, SETTINGS_CODES);
  }
}

const termSchema = z.object({
  campusId: uuid,
  year: intInRange(2020, 2100),
  term: z.union([z.literal(1), z.literal(2)]),
  name: requiredText(100),
  startsOn: dateOnly,
  endsOn: dateOnly,
}).refine((value) => value.endsOn >= value.startsOn);

export async function createCampusSchoolTermAction(input: {
  campusId: string;
  year: number;
  term: 1 | 2;
  name: string;
  startsOn: string;
  endsOn: string;
}): Promise<ActionResult> {
  try {
    const value = parse(termSchema, input);
    const { supabase } = await authorizedClient("organization.settings.manage");
    const { error } = await supabase.rpc("create_campus_school_term", {
      p_campus_id: value.campusId,
      p_year: value.year,
      p_term: value.term,
      p_name: value.name,
      p_starts_on: value.startsOn,
      p_ends_on: value.endsOn,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, SETTINGS_CODES);
  }
}

export async function activateCampusSchoolTermAction(termId: string): Promise<ActionResult> {
  try {
    const id = parse(uuid, termId);
    const { supabase } = await authorizedClient("organization.settings.manage");
    const { error } = await supabase.rpc("activate_school_term", { p_term_id: id });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, SETTINGS_CODES);
  }
}

const ruleSchemas = {
  calendar: z.object({ teachingWeekStartsOn: intInRange(1, 7), weekendDays: z.array(intInRange(0, 6)).max(7) }),
  lesson: z.object({ defaultDurationMinutes: intInRange(15, 300), billingUnitLessons: z.number().min(0.25).max(10) }),
  scheduling: z.object({ minBreakMinutes: intInRange(0, 180), conflictPolicy: z.enum(["block", "warn"]) }),
  notification: z.object({ inAppEnabled: z.boolean(), emailEnabled: z.boolean(), smsEnabled: z.boolean(), wechatEnabled: z.boolean() }),
  finance: z.object({ currency: z.literal("CNY"), refundRequiresApproval: z.boolean() }),
  public_publishing: z.object({ defaultLocale: z.enum(["zh", "en"]), requiresReview: z.boolean() }),
} satisfies Record<OrganizationRuleDomain, z.ZodType>;

function parseRuleValue(domain: OrganizationRuleDomain, valueText: string): Record<string, unknown> {
  let raw: unknown;
  try {
    raw = JSON.parse(valueText);
  } catch {
    throw new Error("VALIDATION");
  }
  return parse(ruleSchemas[domain], raw) as Record<string, unknown>;
}

export async function setOrganizationRuleAction(input: {
  domain: OrganizationRuleDomain;
  campusId: string | null;
  valueText: string;
  effectiveAt: string;
  reason: string;
}): Promise<ActionResult> {
  try {
    const base = parse(z.object({ domain: z.enum(ORGANIZATION_RULE_DOMAINS), campusId: uuid.nullable(), valueText: text(16384), ...effectiveInput.shape }), input);
    const value = parseRuleValue(base.domain, base.valueText);
    const { supabase } = await authorizedClient("organization.settings.manage");
    const { error } = await supabase.rpc("set_organization_rule", {
      p_domain: base.domain,
      p_campus_id: nullableRpcArg(base.campusId),
      p_value: value as Json,
      p_effective_from: base.effectiveAt,
      p_reason: base.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, SETTINGS_CODES);
  }
}

export async function rollbackOrganizationRuleAction(versionId: string, effectiveAt: string, reason: string): Promise<ActionResult> {
  try {
    const value = parse(z.object({ versionId: uuid, ...effectiveInput.shape }), { versionId, effectiveAt, reason });
    const { supabase } = await authorizedClient("organization.settings.manage");
    const { error } = await supabase.rpc("rollback_organization_rule", {
      p_version_id: value.versionId,
      p_effective_from: value.effectiveAt,
      p_reason: value.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, SETTINGS_CODES);
  }
}

export async function setFeatureFlagAction(input: {
  flagKey: OrganizationFeatureKey;
  campusId: string | null;
  enabled: boolean;
  effectiveAt: string;
  reason: string;
}): Promise<ActionResult> {
  try {
    const value = parse(z.object({ flagKey: z.enum(ORGANIZATION_FEATURE_KEYS), campusId: uuid.nullable(), enabled: z.boolean(), ...effectiveInput.shape }), input);
    const { supabase } = await authorizedClient("organization.settings.manage");
    const { error } = await supabase.rpc("set_feature_flag", {
      p_flag_key: value.flagKey,
      p_campus_id: nullableRpcArg(value.campusId),
      p_enabled: value.enabled,
      p_effective_from: value.effectiveAt,
      p_reason: value.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, SETTINGS_CODES);
  }
}

export async function rollbackFeatureFlagAction(versionId: string, effectiveAt: string, reason: string): Promise<ActionResult> {
  try {
    const value = parse(z.object({ versionId: uuid, ...effectiveInput.shape }), { versionId, effectiveAt, reason });
    const { supabase } = await authorizedClient("organization.settings.manage");
    const { error } = await supabase.rpc("rollback_feature_flag", {
      p_version_id: value.versionId,
      p_effective_from: value.effectiveAt,
      p_reason: value.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, SETTINGS_CODES);
  }
}
