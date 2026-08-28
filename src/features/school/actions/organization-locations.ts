"use server";

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import type { LocationImpactV2 } from "../organization-locations";
import { authorizedClient, nullableRpcArg } from "./guards";
import { COMMON_CODES, intInRange, parse, requiredText, text, uuid } from "./schemas";

const LOCATION_CODES = [
  ...COMMON_CODES,
  "INVALID_ORGANIZATION",
  "INVALID_CAMPUS",
  "INVALID_ROOM",
  "CAMPUS_NAME_EXISTS",
  "ROOM_NAME_EXISTS",
  "CAMPUS_ARCHIVED",
  "LOCATION_IMPACT_STALE",
  "NOT_FOUND",
] as const;

function isIanaTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

const timezone = z.string().trim().min(1).max(64).refine(isIanaTimezone);
const campusInput = z.object({ name: requiredText(100), address: text(500) });
const roomInput = z.object({ name: requiredText(100), capacity: intInRange(1, 500).nullable() });

export async function updateOrganizationProfileV2Action(input: {
  name: string;
  timezone: string;
}): Promise<ActionResult> {
  try {
    const value = parse(z.object({ name: requiredText(100), timezone }), input);
    const { supabase } = await authorizedClient("organization.profile.manage");
    const { error } = await supabase.rpc("update_organization_profile_v2", {
      p_name: value.name,
      p_timezone: value.timezone,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, LOCATION_CODES);
  }
}

export async function createCampusV2Action(input: {
  name: string;
  address: string;
}): Promise<ActionResult<string>> {
  try {
    const value = parse(campusInput, input);
    const { supabase } = await authorizedClient("location.manage");
    const { data, error } = await supabase.rpc("create_campus_v2", {
      p_name: value.name,
      p_address: nullableRpcArg(value.address || null),
    });
    if (error) throw new Error(error.message);
    if (!data) throw new Error("INVALID_CAMPUS");
    return { ok: true, data };
  } catch (error) {
    return actionError<string>(error, LOCATION_CODES);
  }
}

export async function updateCampusV2Action(input: {
  campusId: string;
  name: string;
  address: string;
  status: "active" | "archived";
  expectedUnstartedSessionCount: number | null;
}): Promise<ActionResult> {
  try {
    const value = parse(campusInput.extend({
      campusId: uuid,
      status: z.enum(["active", "archived"]),
      expectedUnstartedSessionCount: z.number().int().min(0).nullable(),
    }), input);
    const { supabase } = await authorizedClient("location.manage");
    const { error } = await supabase.rpc("update_campus_v2", {
      p_campus_id: value.campusId,
      p_name: value.name,
      p_address: value.address,
      p_status: value.status,
      p_expected_unstarted_session_count: nullableRpcArg(value.expectedUnstartedSessionCount),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, LOCATION_CODES);
  }
}

export async function createCampusRoomV2Action(input: {
  campusId: string;
  name: string;
  capacity: number | null;
}): Promise<ActionResult<string>> {
  try {
    const value = parse(roomInput.extend({ campusId: uuid }), input);
    const { supabase } = await authorizedClient("location.manage");
    const { data, error } = await supabase.rpc("create_campus_room_v2", {
      p_campus_id: value.campusId,
      p_name: value.name,
      p_capacity: nullableRpcArg(value.capacity),
    });
    if (error) throw new Error(error.message);
    if (!data) throw new Error("INVALID_ROOM");
    return { ok: true, data };
  } catch (error) {
    return actionError<string>(error, LOCATION_CODES);
  }
}

export async function updateCampusRoomV2Action(input: {
  roomId: string;
  name: string;
  capacity: number | null;
}): Promise<ActionResult> {
  try {
    const value = parse(roomInput.extend({ roomId: uuid }), input);
    const { supabase } = await authorizedClient("location.manage");
    const { error } = await supabase.rpc("update_campus_room_v2", {
      p_room_id: value.roomId,
      p_name: value.name,
      p_capacity: nullableRpcArg(value.capacity),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, LOCATION_CODES);
  }
}

export async function getLocationImpactV2Action(
  entityType: "campus" | "room",
  entityId: string,
): Promise<ActionResult<LocationImpactV2>> {
  try {
    const value = parse(z.object({ entityType: z.enum(["campus", "room"]), entityId: uuid }), {
      entityType,
      entityId,
    });
    const { supabase } = await authorizedClient("location.manage");
    const { data, error } = await supabase.rpc("get_location_impact_v2", {
      p_entity_type: value.entityType,
      p_entity_id: value.entityId,
    });
    if (error) throw new Error(error.message);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("NOT_FOUND");
    const row = data as Record<string, unknown>;
    const impact: LocationImpactV2 = {
      entityType: value.entityType,
      entityId: value.entityId,
      roomCount: Number(row.roomCount ?? 0),
      classDefaultCount: Number(row.classDefaultCount ?? 0),
      unstartedSessionCount: Number(row.unstartedSessionCount ?? 0),
      historicalSessionCount: Number(row.historicalSessionCount ?? 0),
    };
    if (Object.values(impact).some((item, index) => index > 1 && (!Number.isInteger(item) || Number(item) < 0))) {
      throw new Error("NOT_FOUND");
    }
    return { ok: true, data: impact };
  } catch (error) {
    return actionError<LocationImpactV2>(error, LOCATION_CODES);
  }
}

export async function setCampusRoomStatusV2Action(input: {
  roomId: string;
  status: "active" | "inactive";
  expectedUnstartedSessionCount: number | null;
}): Promise<ActionResult> {
  try {
    const value = parse(z.object({
      roomId: uuid,
      status: z.enum(["active", "inactive"]),
      expectedUnstartedSessionCount: z.number().int().min(0).nullable(),
    }), input);
    const { supabase } = await authorizedClient("location.manage");
    const { error } = await supabase.rpc("set_campus_room_status_v2", {
      p_room_id: value.roomId,
      p_status: value.status,
      p_expected_unstarted_session_count: nullableRpcArg(value.expectedUnstartedSessionCount),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, LOCATION_CODES);
  }
}
