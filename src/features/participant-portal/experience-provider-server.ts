import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorize, PortalError, readJson, requireResult, response } from "@/features/parent-portal/server";
import type { RegistrationRpc } from "@/features/parent-portal/course-server";
import { readPublishedDocument } from "@/features/parent-portal/policy-documents";
import { contentDocumentSchema, experienceFormSchema, experienceId } from "@/features/school/miniapp-settings/experience-schema";
import { experienceAnswerErrors, type BookingFlow, type ContentDocument, type ExperienceConnection, type ExperienceForm, type ExperienceService, type SchedulingPolicy } from "../../../contracts/participant-api/miniapp-experience";
import { readPublishedSettings } from "./settings-server";
import { experienceDocument, experienceImages } from "./experience-server";
import { experienceAnswersSchema } from "./experience-requests-server";
import { callProvider, connectedProvider, providerActor, providerBindingKey, providerConfiguration } from "./provider-transport";

const slot = z.object({ id: z.string().min(1).max(200), startsAt: z.string().datetime({ offset: true }), endsAt: z.string().datetime({ offset: true }), remaining: z.number().int().nonnegative().nullable(), resourceIds: z.array(z.string().max(200)).max(30) }).strict();
const booking = z.object({ id: z.string().min(1).max(200), version: z.number().int().positive(), actor: z.string().min(1).max(128), status: z.enum(["requested", "confirmed", "cancelled", "completed", "noShow", "waitlisted"]),
  startsAt: z.string().datetime({ offset: true }).nullable(), endsAt: z.string().datetime({ offset: true }).nullable(), note: z.string().max(4000), canCancel: z.boolean(), canReschedule: z.boolean() }).strict();
const readCommand = z.object({ action: z.literal("availability"), serviceId: experienceId, bookingId: z.string().uuid().optional(), from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) }).strict();
const createCommand = z.object({ action: z.enum(["create", "waitlist"]), id: z.string().uuid(), serviceId: experienceId, revision: z.number().int().positive(),
  slotId: z.string().max(200), startsAt: z.string().datetime({ offset: true }).nullable(), participantIds: z.array(z.string().uuid()).max(10),
  answers: experienceAnswersSchema, consents: z.record(experienceId, z.string().max(100)) }).strict();
const modifyCommand = z.object({ action: z.enum(["read", "cancel", "reschedule", "leaveWaitlist"]), id: z.string().uuid(), bookingId: z.string().uuid(), slotId: z.string().max(200).optional(), startsAt: z.string().datetime({ offset: true }).optional() }).strict();
const commandSchema = z.union([readCommand, createCommand, modifyCommand]);
type Snapshot = { connection: ExperienceConnection; bindingKey: string; actor: string; service: ExperienceService; flow: BookingFlow; policy: SchedulingPolicy | null; form: ExperienceForm | null;
  command: z.infer<typeof createCommand>; confirmation: ContentDocument | null; resources: { id: string; externalId: string; capacity: number }[] };
type Stored = { id: string; service_id: string; created_at: string; snapshot: Snapshot; result: z.infer<typeof booking> | null };
const uuid = z.string().uuid();
function canonical(value: unknown): string { if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]"; if (value && typeof value === "object") return "{" + Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ":" + canonical(v)).join(",") + "}"; return JSON.stringify(value); }
function adminRpc(name: string, args: Record<string, unknown>) { return (createAdminClient().rpc as unknown as RegistrationRpc)(name, args).then(requireResult); }
async function currentContext(request: Request, serviceId: string) {
  const publication = await readPublishedSettings(), e = publication.config?.experience, service = e?.services.find(s => s.id === serviceId && s.enabled && s.binding.adapter === "remote");
  const flow = e?.flows.find(f => f.id === service?.flowId), connection = e?.connections.find(c => c.id === service?.binding.connectionId && c.enabled);
  if (!service || !flow || !connection) throw new PortalError("NOT_FOUND");
  if (service.price.mode === "online") throw new PortalError("BOOKING_CLOSED");
  const formResult = flow.formId ? await experienceDocument(request, "form", flow.formId) : null;
  if (formResult && formResult.value.revision !== publication.revision) throw new PortalError("FORM_CHANGED");
  const form = formResult ? experienceFormSchema.parse(formResult.value.document) : null;
  const confirmationResult = flow.confirmationPageId ? await experienceDocument(request, "page", flow.confirmationPageId) : null;
  if (confirmationResult && confirmationResult.value.revision !== publication.revision) throw new PortalError("FORM_CHANGED");
  const confirmation = confirmationResult ? contentDocumentSchema.parse(confirmationResult.value.document) : null;
  return { service, flow, connection, form, confirmation, policy: e!.policies.find(p => p.id === flow.policyId) || null, revision: publication.revision,
    resources: e!.resources.filter(r => service.resourceIds.includes(r.id) && r.enabled).map(r => ({ id: r.id, externalId: r.externalId, capacity: r.capacity })) };
}
export function slotWithinPolicy(s: z.infer<typeof slot>, policy: SchedulingPolicy | null, duration: number, now = Date.now()) {
  const start = Date.parse(s.startsAt), end = Date.parse(s.endsAt);
  if (end <= start || start <= now || duration > 0 && end - start !== duration * 60_000 || s.remaining === 0) return false;
  if (!policy) return true;
  if (start < now + policy.minimumNoticeMinutes * 60_000 || start > now + policy.windowDays * 86400000) return false;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: policy.timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(start);
  const part = (key: string) => parts.find(p => p.type === key)?.value || "";
  const day = `${part("year")}-${part("month")}-${part("day")}`, time = `${part("hour")}:${part("minute")}`, weekday = new Date(day + "T12:00:00Z").getUTCDay();
  const endParts = new Intl.DateTimeFormat("en-CA", { timeZone: policy.timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(end);
  const ep = (key: string) => endParts.find(p => p.type === key)?.value || "";
  const endDay = `${ep("year")}-${ep("month")}-${ep("day")}`, endTime = `${ep("hour")}:${ep("minute")}`;
  if (day !== endDay) return false;
  const exception = policy.exceptions.find(e => e.date === day);
  if (exception) return !exception.closed && time >= exception.start && endTime <= exception.end;
  return !policy.weekdays.length || policy.weekdays.some(p => p.day === weekday && time >= p.start && endTime <= p.end);
}
async function availability(context: Pick<Snapshot, "service" | "flow" | "connection" | "policy" | "resources">, actorId: string, from: string, to: string, includeFull = false) {
  if (Date.parse(to) <= Date.parse(from) || Date.parse(to) - Date.parse(from) > 31 * 86400000) throw new PortalError("VALIDATION");
  const config = await connectedProvider(context.connection, "availability.read", ["booking.v1", "policy.v1"]);
  const value = z.object({ slots: z.array(slot).max(1000) }).strict().parse(await callProvider(config, "availability.read", { actor: providerActor(config, actorId), serviceId: context.service.binding.target,
    from, to, policy: context.policy, durationMinutes: context.service.durationMinutes, resources: context.resources }));
  return value.slots.filter(s => Date.parse(s.startsAt) >= Date.parse(from) && Date.parse(s.endsAt) <= Date.parse(to)
    && slotWithinPolicy(includeFull ? { ...s, remaining: null } : s, context.policy, context.service.durationMinutes));
}
function permittedActions(row: Stored) {
  const booking = row.result, policy = row.snapshot.policy, capabilities = row.snapshot.connection.capabilities;
  const remainingMinutes = booking?.startsAt ? (Date.parse(booking.startsAt) - Date.now()) / 60000 : Infinity;
  const active = !!booking && ["requested", "confirmed", "waitlisted"].includes(booking.status);
  return {
    canCancel: active && !!booking?.canCancel && capabilities.includes(booking.status === "waitlisted" ? "waitlist.leave" : "booking.cancel")
      && (!policy || policy.cancellation === "self" && remainingMinutes >= policy.cancellationCutoffMinutes),
    canReschedule: active && booking?.status !== "waitlisted" && !!booking?.canReschedule && capabilities.includes("booking.reschedule")
      && (!policy || policy.reschedule === "self" && remainingMinutes >= policy.rescheduleCutoffMinutes),
  };
}
function publicBooking(row: Stored) { return { id: row.id, serviceId: row.service_id, serviceName: row.snapshot.service.name, createdAt: row.created_at,
  status: row.result?.status || "requested", startsAt: row.result?.startsAt || row.snapshot.command.startsAt, endsAt: row.result?.endsAt || null,
  note: row.result?.note || "", ...permittedActions(row), pending: !row.result }; }
async function bookingReceipt(db: Awaited<ReturnType<typeof authorize>>["db"], row: Stored) {
  return { ...publicBooking(row), confirmation: row.snapshot.confirmation || null, completionAction: row.snapshot.flow.completionAction,
    images: await experienceImages(db, [row.snapshot.confirmation]) };
}
function checkedBinding(snapshot: Snapshot) { const config = providerConfiguration(snapshot.connection.id); if (!config || providerBindingKey(config) !== snapshot.bindingKey) throw new PortalError("UNAVAILABLE"); return config; }
export async function experienceBookingDetailGet(request: Request) {
  const { db } = await authorize(request), id = uuid.parse(new URL(request.url).searchParams.get("id"));
  const rows = requireResult(await (db.rpc as unknown as RegistrationRpc)("miniapp_remote_bookings_read", { p_id: id, p_page: 1 })) as Stored[];
  if (!rows[0]) throw new PortalError("NOT_FOUND"); const row = rows[0];
  return response({ booking: await bookingReceipt(db, row), service: row.snapshot.service, policy: row.snapshot.policy, flow: row.snapshot.flow,
    retryCommand: row.result ? null : row.snapshot.command });
}
export async function experienceBookingsGet(request: Request) {
  const { db } = await authorize(request), page = z.coerce.number().int().min(1).max(1000).parse(new URL(request.url).searchParams.get("page") || 1);
  const rows = requireResult(await (db.rpc as unknown as RegistrationRpc)("miniapp_remote_bookings_read", { p_page: page, p_id: null })) as Stored[];
  return response(rows.map(publicBooking));
}
export async function experienceProviderPost(request: Request) {
  const input = commandSchema.parse(await readJson(request)), { db, user } = await authorize(request);
  if (input.action === "availability") {
    let context: Awaited<ReturnType<typeof currentContext>> | Snapshot;
    if (input.bookingId) { const rows = requireResult(await (db.rpc as unknown as RegistrationRpc)("miniapp_remote_bookings_read", { p_id: input.bookingId, p_page: 1 })) as Stored[]; if (!rows[0]) throw new PortalError("NOT_FOUND"); context = rows[0].snapshot; checkedBinding(context); }
    else context = await currentContext(request, input.serviceId);
    return response({ slots: await availability(context, user.id, input.from, input.to, !input.bookingId && !!context.policy?.waitlist) });
  }
  let stored: Stored, operation: "booking.create" | "waitlist.join" | "booking.read" | "booking.cancel" | "booking.reschedule" | "waitlist.leave";
  if (input.action === "create" || input.action === "waitlist") {
    const previous = requireResult(await (db.rpc as unknown as RegistrationRpc)("miniapp_remote_bookings_read", { p_id: input.id, p_page: 1 })) as Stored[];
    const hash = createHash("sha256").update(canonical(input)).digest("hex");
    if (previous[0]) {
      stored = previous[0]; if (JSON.stringify(stored.snapshot.command) !== JSON.stringify(input)) {
        // JSONB key order is not significant; compare canonical command fields.
        const previousCommand = createCommand.parse(stored.snapshot.command);
        if (createHash("sha256").update(canonical(previousCommand)).digest("hex") !== hash) throw new PortalError("CONFLICT");
      }
      if (stored.result) return response(await bookingReceipt(db, stored));
    } else {
      const context = await currentContext(request, input.serviceId); if (context.revision !== input.revision) throw new PortalError("FORM_CHANGED");
      requireResult(await (db.rpc as unknown as RegistrationRpc)("miniapp_assert_experience_participants", { p_ids: input.participantIds }));
      if (context.flow.requireParticipant && !input.participantIds.length || !context.flow.allowMultipleParticipants && input.participantIds.length > 1
        || context.form && experienceAnswerErrors(context.form, input.answers).length || !context.form && Object.keys(input.answers).length) throw new PortalError("VALIDATION");
      for (const id of context.flow.consentDocumentIds) if ((await readPublishedDocument(id)).version !== input.consents[id]) throw new PortalError("FORM_CHANGED");
      if (input.action === "waitlist" && !context.policy?.waitlist) throw new PortalError("BOOKING_CLOSED");
      if (context.flow.mode === "appointment") {
        if (!input.startsAt || !input.slotId) throw new PortalError("VALIDATION");
        const slots = await availability(context, user.id, input.startsAt, new Date(Date.parse(input.startsAt) + 86400000).toISOString(), input.action === "waitlist");
        if (!slots.some(s => s.id === input.slotId && s.startsAt === input.startsAt)) throw new PortalError("BOOKING_CLOSED");
      }
      const config = await connectedProvider(context.connection, input.action === "create" ? "booking.create" : "waitlist.join", ["booking.v1", "policy.v1", "idempotency.v1"]);
      const snapshot: Snapshot = { ...context, bindingKey: providerBindingKey(config), actor: providerActor(config, user.id), command: input };
      stored = await adminRpc("miniapp_remote_booking_reserve", { p_id: input.id, p_owner: user.id, p_service_id: input.serviceId, p_hash: hash, p_snapshot: snapshot, p_limit: context.policy?.maxActiveBookings || 10 }) as Stored;
      if (stored.result) return response(await bookingReceipt(db, stored));
    }
    operation = input.action === "create" ? "booking.create" : "waitlist.join";
  } else {
    if (!("bookingId" in input)) throw new PortalError("VALIDATION");
    const rows = requireResult(await (db.rpc as unknown as RegistrationRpc)("miniapp_remote_bookings_read", { p_id: uuid.parse(input.bookingId), p_page: 1 })) as Stored[];
    if (!rows[0]?.result) throw new PortalError("NOT_FOUND"); stored = rows[0];
    checkedBinding(stored.snapshot);
    operation = input.action === "cancel" ? "booking.cancel" : input.action === "reschedule" ? "booking.reschedule" : input.action === "leaveWaitlist" ? "waitlist.leave" : "booking.read";
    const before = stored.result!, allowed = permittedActions(stored);
    if ((operation === "booking.cancel" || operation === "waitlist.leave") && (!allowed.canCancel || (operation === "waitlist.leave") !== (before.status === "waitlisted"))) throw new PortalError("BOOKING_CLOSED");
    if (operation === "booking.reschedule") {
      if (!allowed.canReschedule || !input.slotId || !input.startsAt) throw new PortalError("BOOKING_CLOSED");
      const slots = await availability(stored.snapshot, user.id, input.startsAt, new Date(Date.parse(input.startsAt) + 86400000).toISOString());
      if (!slots.some(s => s.id === input.slotId && s.startsAt === input.startsAt)) throw new PortalError("BOOKING_CLOSED");
    }
  }
  const snapshot = stored.snapshot, config = checkedBinding(snapshot);
  if (operation !== "booking.read") requireResult(await (db.rpc as unknown as RegistrationRpc)("miniapp_assert_experience_participants", { p_ids: snapshot.command.participantIds }));
  await connectedProvider(snapshot.connection, operation, ["booking.v1", "idempotency.v1"]);
  const result = booking.parse(await callProvider(config, operation, { actor: snapshot.actor, requestId: input.id, bookingId: stored.result?.id,
    serviceId: snapshot.service.binding.target, slotId: "slotId" in input ? input.slotId : undefined, startsAt: "startsAt" in input ? input.startsAt : undefined,
    participantIds: snapshot.command.participantIds.map(id => providerActor(config, id)), form: snapshot.form, answers: snapshot.command.answers,
    consents: snapshot.command.consents, policy: snapshot.policy, resources: snapshot.resources, price: snapshot.service.price }));
  if (result.actor !== snapshot.actor || stored.result && result.id !== stored.result.id) throw new PortalError("UNAVAILABLE");
  const saved = await adminRpc("miniapp_remote_booking_store", { p_id: stored.id, p_owner: user.id, p_result: result }) as Stored;
  return response(await bookingReceipt(db, saved));
}
