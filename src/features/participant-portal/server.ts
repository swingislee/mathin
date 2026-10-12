import "server-only";
import { z } from "zod";
import { authPost, failure, mediaGet, mediaPost, portalGet, portalPost, PortalError, readJson } from "@/features/parent-portal/server";
import { learningGet, learningPost } from "@/features/parent-portal/learning-server";
import { assessmentGet, assessmentPost, assessmentSlotsGet } from "@/features/parent-portal/assessment-server";
import { courseGet, coursePost } from "@/features/parent-portal/course-server";
import { parentWechatAuthFailure, parentWechatAuthGet, parentWechatAuthPost } from "@/features/parent-portal/wechat-server";
import { onboardingPost } from "@/features/parent-portal/onboarding-server";
import { GET as contactsGet } from "@/app/api/v1/parent/advisors/route";
import { GET as contactQrGet } from "@/app/api/v1/parent/advisors/qr/route";
import * as project from "./projection";
import { registrationsGet, registrationsPost } from "./registration-server";
import { activityCatalogGet, activityDetailGet, activityImageGet } from "./activity-detail-server";
import { miniappSettingsGet, miniappContentImageGet } from "./settings-server";
import { miniappDocumentGet } from "./document-server";

const object = z.record(z.string(), z.unknown());
const requestId = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const activityCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("apply"), id: requestId, publicationId: requestId,
    kind: z.literal("activity"), revision: z.number().int().positive(), participantId: requestId }).strict(),
  z.object({ action: z.literal("cancel"), id: requestId }).strict(),
]);

/** Renaming happens at the API boundary; every operation still goes through the existing authorization and RLS path. */
function queryRequest(request: Request, changes: Record<string, string>, rename: Record<string, string> = {}) {
  const url = new URL(request.url);
  for (const [from, to] of Object.entries(rename)) {
    if (url.searchParams.has(to)) throw new PortalError("VALIDATION");
    const value = url.searchParams.get(from);
    if (value !== null) { url.searchParams.delete(from); url.searchParams.set(to, value); }
  }
  for (const [key, value] of Object.entries(changes)) url.searchParams.set(key, value);
  return new Request(url, { headers: request.headers, signal: request.signal });
}

function jsonRequest(request: Request, value: unknown) {
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  return new Request(request.url, { method: "POST", headers, body: JSON.stringify(value), signal: request.signal });
}

function renameCommand(value: unknown, names: Record<string, string>) {
  const input = object.parse(value), result: Record<string, unknown> = { ...input };
  for (const [from, to] of Object.entries(names)) {
    // The new endpoint accepts only its own field names; the existing schema checks every value afterwards.
    if (Object.hasOwn(input, to)) throw new PortalError("VALIDATION");
    if (Object.hasOwn(input, from)) { result[to] = input[from]; delete result[from]; }
  }
  return result;
}

async function projected<T>(result: Response, map: (value: T) => unknown) {
  if (!result.ok) return result;
  const headers = new Headers(result.headers);
  headers.delete("content-length");
  return Response.json(map(await result.json() as T), { status: result.status, headers });
}

async function get(request: Request, endpoint: string) {
  switch (endpoint) {
    case "settings": return miniappSettingsGet(request);
    case "settings/image": return miniappContentImageGet(request);
    case "documents": return miniappDocumentGet(request);
    case "auth/wechat": return parentWechatAuthGet(request);
    case "portal": {
      const resource = new URL(request.url).searchParams.get("resource");
      if (!["form", "account", "bookings", "reports", "tasks", "submission"].includes(resource || "")) throw new PortalError("NOT_FOUND");
      return portalGet(resource === "tasks" ? queryRequest(request, { resource: "practices" }) : request);
    }
    case "calendar": return projected(await learningGet(request), project.participantCalendar);
    case "assessments": return projected(await assessmentGet(request), project.assessmentOverview);
    case "registrations": return registrationsGet(request);
    case "activities/detail": return activityDetailGet(request);
    case "activities/image": return activityImageGet(request);
    case "assessment-slots": return projected(await assessmentSlotsGet(queryRequest(request, {}, { topics: "subjects", stageNumber: "grade" })), project.assessmentAvailability);
    case "activities": {
      const resource = new URL(request.url).searchParams.get("resource") || "catalog";
      if (resource === "catalog") return activityCatalogGet();
      const result = await courseGet(request, "participant");
      if (!result.ok) return result;
      if (resource === "applications") return projected(result, project.activityRequests);
      // Explicit short-course publications share this client DTO and retain class applications in storage.
      return projected(result, project.activityOffers);
    }
    case "services": return projected(await contactsGet(request), project.serviceContacts);
    case "services/qr": return contactQrGet(request);
    case "media": return projected(await mediaGet(request), (value: { url: string; expiresIn: number }) => ({
      ...value, url: value.url.replace("/api/v1/parent/media?", "/api/v1/participant/media?") }));
    default: throw new PortalError("NOT_FOUND");
  }
}

async function post(request: Request, endpoint: string) {
  switch (endpoint) {
    case "auth": return authPost(request);
    case "auth/wechat": return parentWechatAuthPost(request);
    case "auth/wechat/onboarding": return onboardingPost(request);
    case "portal": {
      const raw = await readJson(request);
      const input = object.parse(raw);
      return portalPost(jsonRequest(request, input.action === "submit" ? renameCommand(input, { taskId: "assignmentId" }) : input));
    }
    case "calendar": return learningPost(request);
    case "registrations": return registrationsPost(request);
    case "assessments": return projected(await assessmentPost(jsonRequest(request,
      renameCommand(await readJson(request), { topics: "subjects", stageNumber: "grade", facilitatorId: "teacherId", participantTimeOptions: "parentTimeOptions" }))), project.assessmentRequest);
    case "activities": {
      const input = activityCommand.parse(await readJson(request));
      return coursePost(jsonRequest(request, input.action === "apply" ? { ...input, classroomId: null } : input), "participant");
    }
    case "media": {
      const headers = new Headers(request.headers);
      if (headers.has("x-assignment-id")) throw new PortalError("VALIDATION");
      const taskId = headers.get("x-task-id");
      if (taskId !== null) headers.set("x-assignment-id", taskId);
      headers.delete("x-task-id");
      return mediaPost(new Request(request, { headers }));
    }
    default: throw new PortalError("NOT_FOUND");
  }
}

export async function participantGet(request: Request, endpoint: string) {
  try {
    // A signed media download streams binary data and does not pass through JSON projection.
    if (endpoint === "media" && new URL(request.url).searchParams.has("download")) return await mediaGet(request);
    return await get(request, endpoint);
  } catch (error) { return endpoint === "auth/wechat" ? parentWechatAuthFailure(error) : failure(error); }
}

export async function participantPost(request: Request, endpoint: string) {
  try { return await post(request, endpoint); }
  catch (error) { return endpoint === "auth/wechat" || endpoint === "auth/wechat/onboarding" ? parentWechatAuthFailure(error) : failure(error); }
}
