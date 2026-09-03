import "server-only";

import { createClient } from "@/lib/supabase/server";

export type LocationStatus = "active" | "inactive";
export type CampusStatus = "active" | "archived";

export interface OrganizationProfileV2 {
  id: string;
  name: string;
  timezone: string;
  updatedAt: string;
}

export interface CampusRoomV2 {
  id: string;
  name: string;
  capacity: number | null;
  status: LocationStatus;
  updatedAt: string;
}

export interface CampusV2 {
  id: string;
  name: string;
  address: string | null;
  status: CampusStatus;
  updatedAt: string;
  rooms: CampusRoomV2[];
}

export interface LocationImpactV2 {
  entityType: "campus" | "room";
  entityId: string;
  roomCount: number;
  classDefaultCount: number;
  unstartedSessionCount: number;
  historicalSessionCount: number;
}

export interface RoomOptionV2 {
  id: string;
  name: string;
  capacity: number | null;
  campusId: string;
  campusName: string;
}

export interface CampusOptionV2 {
  id: string;
  name: string;
}

export interface ActiveLocationOptionsV2 {
  campuses: CampusOptionV2[];
  rooms: RoomOptionV2[];
}

export interface ScheduleDefaultsV2 {
  defaultDurationMinutes: number;
  conflictPolicy: "warn";
}

function objectValue(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, code: string): string {
  if (typeof value !== "string" || !value) throw new Error(code);
  return value;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function roomValue(value: unknown): CampusRoomV2 {
  const row = objectValue(value, "INVALID_ROOM_DTO");
  const status = stringValue(row.status, "INVALID_ROOM_DTO");
  if (status !== "active" && status !== "inactive") throw new Error("INVALID_ROOM_DTO");
  return {
    id: stringValue(row.id, "INVALID_ROOM_DTO"),
    name: stringValue(row.name, "INVALID_ROOM_DTO"),
    capacity: typeof row.capacity === "number" ? row.capacity : null,
    status,
    updatedAt: stringValue(row.updatedAt, "INVALID_ROOM_DTO"),
  };
}

function campusValue(value: unknown): CampusV2 {
  const row = objectValue(value, "INVALID_CAMPUS_DTO");
  const status = stringValue(row.status, "INVALID_CAMPUS_DTO");
  if (status !== "active" && status !== "archived") throw new Error("INVALID_CAMPUS_DTO");
  return {
    id: stringValue(row.id, "INVALID_CAMPUS_DTO"),
    name: stringValue(row.name, "INVALID_CAMPUS_DTO"),
    address: nullableString(row.address),
    status,
    updatedAt: stringValue(row.updatedAt, "INVALID_CAMPUS_DTO"),
    rooms: Array.isArray(row.rooms) ? row.rooms.map(roomValue) : [],
  };
}

export async function getOrganizationProfileV2(): Promise<OrganizationProfileV2> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_organization_profile_v2");
  if (error) throw new Error(error.message);
  const row = objectValue(data, "ORGANIZATION_PROFILE_NOT_FOUND");
  return {
    id: stringValue(row.id, "ORGANIZATION_PROFILE_NOT_FOUND"),
    name: stringValue(row.name, "ORGANIZATION_PROFILE_NOT_FOUND"),
    timezone: stringValue(row.timezone, "ORGANIZATION_PROFILE_NOT_FOUND"),
    updatedAt: stringValue(row.updatedAt, "ORGANIZATION_PROFILE_NOT_FOUND"),
  };
}

export async function getLocationCatalogV2(includeInactive = false): Promise<CampusV2[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_location_catalog_v2", {
    p_include_inactive: includeInactive,
  });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data.map(campusValue) : [];
}

export async function getCampusV2(campusId: string): Promise<CampusV2> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_campus_v2", { p_campus_id: campusId });
  if (error) throw new Error(error.message);
  return campusValue(data);
}

export async function listActiveLocationOptionsV2(): Promise<ActiveLocationOptionsV2> {
  const campuses = await getLocationCatalogV2(false);
  return {
    campuses: campuses.map((campus) => ({ id: campus.id, name: campus.name })),
    rooms: campuses.flatMap((campus) => campus.rooms.map((room) => ({
      id: room.id,
      name: room.name,
      capacity: room.capacity,
      campusId: campus.id,
      campusName: campus.name,
    }))),
  };
}

export async function listActiveRoomOptionsV2(): Promise<RoomOptionV2[]> {
  return (await listActiveLocationOptionsV2()).rooms;
}

export async function getScheduleDefaultsV2(): Promise<ScheduleDefaultsV2> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_schedule_defaults_v2");
  if (error) throw new Error(error.message);
  const row = objectValue(data, "SCHEDULE_DEFAULTS_NOT_FOUND");
  const duration = Number(row.defaultDurationMinutes);
  if (!Number.isInteger(duration) || duration < 15 || duration > 300 || row.conflictPolicy !== "warn") {
    throw new Error("SCHEDULE_DEFAULTS_NOT_FOUND");
  }
  return { defaultDurationMinutes: duration, conflictPolicy: "warn" };
}

export async function getOrganizationTimezoneV2(): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_organization_timezone_v2");
  if (error) throw new Error(error.message);
  return stringValue(data, "ORGANIZATION_TIMEZONE_NOT_FOUND");
}
