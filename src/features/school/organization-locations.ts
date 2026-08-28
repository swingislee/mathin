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
